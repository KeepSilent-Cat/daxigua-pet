using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Text;
using System.Text.Json;

namespace AutoSplit;

/// <summary>
/// 把「一张整身图」自动拆成 surfpet 分层皮套（尽力而为，会给出置信度）。
///
/// 思路：整身图里眼睛是唯一「低饱和 + 极亮」的大块（动漫眼白），
/// 用它做连通域搜索找两只眼睛；再按「白 / 有色 / 暗」把眼睛区域切成三份，
/// 三份叠起来和原图完全一致（静止时零差异），眨眼就是「淡出白+有色、暗层下移」。
///
/// 用法:
///   AutoSplit --img 图.png --canvas 1280 --report
///   AutoSplit --img 图.png --canvas 1280 --out 皮肤目录 --id xi-young --name 夕·少女
/// </summary>
internal static class Program
{
    static int Main(string[] argv)
    {
        try
        {
            var a = Args(argv);
            if (argv.Length > 0 && argv[0] == "--match") return Match(argv);
            string img = Get(a, "img") ?? throw new ArgumentException("需要 --img");
            int canvas = int.TryParse(Get(a, "canvas"), out var c) ? c : 1280;

            // 模式二：用「点三下」给的坐标直接分层
            string ptsArg = Get(a, "points");
            if (!string.IsNullOrWhiteSpace(ptsArg))
                return FromPoints(img, canvas, ptsArg, Get(a, "out") ?? throw new ArgumentException("需要 --out"),
                                  Get(a, "id") ?? "auto", Get(a, "name") ?? "自动分层");

            var src = LoadBgra(img);
            var (px, w, h, _, _, _) = Normalize(src, canvas);
            src.Dispose();

            var report = new StringBuilder();
            void L(string s) { Console.WriteLine(s); report.AppendLine(s); }

            L($"源      : {img}");
            L($"画布    : {w}x{h}");
            var eyes = FindEyes(px, w, h, L);
            var mouth = eyes == null ? null : FindMouth(px, w, h, eyes, L);

            bool ok = eyes != null;
            L("");
            L(ok ? "结论: 找到双眼，可以做分层" : "结论: 没找到可信的双眼 —— 只能做单层");

            if (ok)
            {
                L($"  左眼(画面右): ({eyes.Left.X},{eyes.Left.Y}) {eyes.Left.Width}x{eyes.Left.Height}  中心 ({eyes.LeftCx},{eyes.LeftCy})");
                L($"  右眼(画面左): ({eyes.Right.X},{eyes.Right.Y}) {eyes.Right.Width}x{eyes.Right.Height}  中心 ({eyes.RightCx},{eyes.RightCy})");
                L($"  两眼间距 {Math.Abs(eyes.LeftCx - eyes.RightCx)} px   眼高 {eyes.EyeH} px");
                if (mouth.HasValue)
                    L($"  嘴       : ({mouth.Value.X},{mouth.Value.Y}) {mouth.Value.Width}x{mouth.Value.Height}");
                else
                    L("  嘴       : 没找到（嘴型动画将不可用）");
            }

            string outDir = Get(a, "out");
            if (!string.IsNullOrEmpty(outDir))
            {
                if (!ok) { L("没有 --out 输出：检测没过关，不生成半成品"); return 2; }
                Emit(px, w, h, eyes, mouth, outDir, Get(a, "id") ?? "auto", Get(a, "name") ?? "自动拆分", L);
            }

            var rep = Get(a, "report");
            if (!string.IsNullOrEmpty(rep)) File.WriteAllText(rep, report.ToString(), new UTF8Encoding(false));
            return ok ? 0 : 2;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("失败: " + ex.Message);
            return 1;
        }
    }

    // ---------------- 模板匹配：图层到底该放在哪 ----------------

    /// <summary>把图层在参照图上滑动，找误差最小的位置，用来诊断「坐标不对」。</summary>
    static int Match(string[] argv)
    {
        var a = Args(argv);
        string layerPath = Get(a, "layer"), refPath = Get(a, "ref");
        if (layerPath == null || refPath == null) throw new ArgumentException("需要 --layer 和 --ref");
        int refSize = int.TryParse(Get(a, "refsize"), out var rs) ? rs : 1280;
        int range = int.TryParse(Get(a, "range"), out var rg) ? rg : 160;
        int step = int.TryParse(Get(a, "step"), out var st) ? st : 2;

        // 参照图：整张缩放到 refSize×refSize（假设是"把原图拉进 1280 画布"）
        var refBmp = new Bitmap(refSize, refSize, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(refBmp))
        using (var src = Image.FromFile(refPath))
        {
            g.Clear(Color.Transparent);
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.CompositingQuality = CompositingQuality.HighQuality;
            g.DrawImage(src, new Rectangle(0, 0, refSize, refSize));
        }
        var rd = refBmp.LockBits(new Rectangle(0,0,refSize,refSize), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        var rp = new byte[Math.Abs(rd.Stride) * refSize];
        System.Runtime.InteropServices.Marshal.Copy(rd.Scan0, rp, 0, rp.Length);
        refBmp.UnlockBits(rd);

        var lb = LoadBgra(layerPath);
        int lw = lb.Width, lh = lb.Height;
        var ld = lb.LockBits(new Rectangle(0,0,lw,lh), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        var lp = new byte[Math.Abs(ld.Stride) * lh];
        System.Runtime.InteropServices.Marshal.Copy(ld.Scan0, lp, 0, lp.Length);
        lb.UnlockBits(ld);

        var samples = new List<(int x, int y, int r, int g, int b)>();
        for (int y = 0; y < lh; y += 3)
            for (int x = 0; x < lw; x += 3)
            {
                int p = (y * lw + x) * 4;
                if (lp[p + 3] < 200) continue;
                samples.Add((x, y, lp[p + 2], lp[p + 1], lp[p]));
            }
        Console.WriteLine($"图层 {Path.GetFileName(layerPath)}  采样点 {samples.Count}");
        if (samples.Count < 50) { Console.WriteLine("采样太少，放弃"); return 1; }

        var results = new List<(int dx, int dy, double err, int cnt)>();
        int need = (int)(samples.Count * 0.5);
        for (int dy = -range; dy <= range; dy += step)
            for (int dx = -range; dx <= range; dx += step)
            {
                long sum = 0; int cnt = 0;
                foreach (var s in samples)
                {
                    int x = s.x + dx, y = s.y + dy;
                    if (x < 0 || y < 0 || x >= refSize || y >= refSize) continue;
                    int q = (y * refSize + x) * 4;
                    if (rp[q + 3] < 200) continue;
                    sum += Math.Abs(s.r - rp[q + 2]) + Math.Abs(s.g - rp[q + 1]) + Math.Abs(s.b - rp[q]);
                    cnt++;
                }
                if (cnt < need) continue;
                results.Add((dx, dy, sum / (double)cnt, cnt));
            }
        var best = results.OrderBy(r => r.err).Take(5).ToList();
        Console.WriteLine("最匹配的偏移（dx, dy = 图层需要平移多少）:");
        foreach (var r in best)
            Console.WriteLine($"   dx={r.dx,4} dy={r.dy,4}  平均色差 {r.err:0.0}  覆盖 {r.cnt}");
        var at0 = results.FirstOrDefault(r => r.dx == 0 && r.dy == 0);
        Console.WriteLine($"当前位置 (0,0) 的误差: {at0.err:0.0}（覆盖 {at0.cnt}）");
        return 0;
    }
    // ---------------- 由人工坐标生成分层 ----------------

    /// <summary>--points "L:688,345 R:537,295 M:587,406 r:48"</summary>
    static int FromPoints(string img, int canvas, string pts, string outDir, string id, string name)
    {
        var mL = System.Text.RegularExpressions.Regex.Match(pts, @"L:(\d+),(\d+)");
        var mR = System.Text.RegularExpressions.Regex.Match(pts, @"R:(\d+),(\d+)");
        var mM = System.Text.RegularExpressions.Regex.Match(pts, @"M:(\d+),(\d+)");
        var mRad = System.Text.RegularExpressions.Regex.Match(pts, @"r:(\d+)");
        if (!mL.Success && !mR.Success) throw new ArgumentException("points 里至少要 L:x,y 或 R:x,y 之一");
        int r = mRad.Success ? int.Parse(mRad.Groups[1].Value) : 48;

        bool hasL = mL.Success, hasR = mR.Success;
        int lx = hasL ? int.Parse(mL.Groups[1].Value) : 0;
        int ly = hasL ? int.Parse(mL.Groups[2].Value) : 0;
        int rx = hasR ? int.Parse(mR.Groups[1].Value) : 0;
        int ry = hasR ? int.Parse(mR.Groups[2].Value) : 0;

        var src = LoadBgra(img);
        var (px, w, h, sc, ddx, ddy) = Normalize(src, canvas);
        src.Dispose();

        // 坐标是在原图上点的，要按 Normalize 的同一套变换换算到画布坐标
        int MapX(int x) => (int)Math.Round(x * sc + ddx);
        int MapY(int y) => (int)Math.Round(y * sc + ddy);
        int MapR(int v) => Math.Max(4, (int)Math.Round(v * sc));
        lx = MapX(lx); ly = MapY(ly);
        rx = MapX(rx); ry = MapY(ry);
        r = MapR(r);

        Rectangle EyeBox(int cx, int cy) =>
            new Rectangle(cx - r, cy - (int)(r * 0.8), r * 2, (int)(r * 1.6));

        var e = new Eyes
        {
            Left = hasL ? EyeBox(lx, ly) : Rectangle.Empty,
            Right = hasR ? EyeBox(rx, ry) : Rectangle.Empty,
            LeftCx = lx, LeftCy = ly, RightCx = rx, RightCy = ry,
            EyeH = (int)(r * 1.6),
            FaceLeft = 0, FaceRight = 0,
        };
        Rectangle? mouth = null;
        if (mM.Success)
        {
            int mx = MapX(int.Parse(mM.Groups[1].Value)), my = MapY(int.Parse(mM.Groups[2].Value));
            int mr = Math.Max(12, (int)(r * 0.85));
            mouth = new Rectangle(mx - mr, my - (int)(mr * 0.8), mr * 2, (int)(mr * 1.6));
        }

        Action<string> log = Console.WriteLine;
        log($"源      : {img}");
        log($"画布    : {w}x{h}");
        log($"左眼框  : {e.Left}");
        log($"右眼框  : {e.Right}");
        log($"嘴框    : {(mouth.HasValue ? mouth.Value.ToString() : "无")}");
        Emit(px, w, h, e, mouth, outDir, id, name, log);
        return 0;
    }

    // ---------------- 检测 ----------------

    sealed class Eyes
    {
        public Rectangle Left, Right;   // Left = 画面右侧那只（role 里的 l）
        public int LeftCx, LeftCy, RightCx, RightCy, EyeH;
        public int FaceLeft, FaceRight;
    }

    static Eyes FindEyes(byte[] px, int w, int h, Action<string> log)
    {
        // 眼白候选：alpha 实、极亮、低饱和
        var mask = new bool[w * h];
        int n = 0;
        for (int i = 0, p = 0; i < mask.Length; i++, p += 4)
        {
            if (px[p + 3] < 200) continue;
            int b = px[p], g = px[p + 1], r = px[p + 2];
            int mx = Math.Max(b, Math.Max(g, r)), mn = Math.Min(b, Math.Min(g, r));
            if (mx < 215) continue;
            double sat = mx == 0 ? 0 : (double)(mx - mn) / mx;
            if (sat > 0.13) continue;
            mask[i] = true; n++;
        }
        log($"眼白候选像素: {n} ({100.0 * n / mask.Length:0.00}%)");
        if (n == 0) return null;

        var comps = Components(mask, w, h, Math.Max(30, w * h / 4000));
        log($"连通域: {comps.Count} 个（已按面积过滤）");
        foreach (var c in comps.Take(6))
            log($"    {c.Width}x{c.Height} @({c.X},{c.Y}) area={c.Area}");

        // 找一对：同高、左右分开、面积相近
        Eyes best = null;
        double bestScore = double.MaxValue;
        for (int i = 0; i < comps.Count; i++)
        for (int j = i + 1; j < comps.Count; j++)
        {
            var A = comps[i]; var B = comps[j];
            double dy = Math.Abs((A.Y + A.Height / 2.0) - (B.Y + B.Height / 2.0));
            if (dy > h * 0.10) continue;
            int sep = Math.Abs((A.X + A.Width / 2) - (B.X + B.Width / 2));
            if (sep < w * 0.05 || sep > w * 0.45) continue;
            double ar = Math.Max(A.Area, B.Area) / (double)Math.Max(1, Math.Min(A.Area, B.Area));
            if (ar > 3.0) continue;
            double dh = Math.Abs(A.Height - B.Height) / (double)Math.Max(1, Math.Max(A.Height, B.Height));
            if (dh > 0.5) continue;

            double score = dy * 2 + (ar - 1) * 20 + dh * 30 - (A.Area + B.Area) / 2000.0;
            if (score < bestScore)
            {
                bestScore = score;
                // 画面左右：x 大的记为 l（角色左眼在画面右侧）
                bool aIsLeft = A.X + A.Width / 2 > B.X + B.Width / 2;
                var l = aIsLeft ? A : B;
                var r = aIsLeft ? B : A;
                best = new Eyes
                {
                    Left = new Rectangle(l.X, l.Y, l.Width, l.Height),
                    Right = new Rectangle(r.X, r.Y, r.Width, r.Height),
                    LeftCx = l.X + l.Width / 2,
                    LeftCy = l.Y + l.Height / 2,
                    RightCx = r.X + r.Width / 2,
                    RightCy = r.Y + r.Height / 2,
                    EyeH = (l.Height + r.Height) / 2,
                    FaceLeft = Math.Min(l.X, r.X),
                    FaceRight = Math.Max(l.X + l.Width, r.X + r.Width),
                };
            }
        }
        return best;
    }

    static Rectangle? FindMouth(byte[] px, int w, int h, Eyes e, Action<string> log)
    {
        int eyeBottom = Math.Max(e.Left.Y + e.Left.Height, e.Right.Y + e.Right.Height);
        int y0 = eyeBottom + (int)(e.EyeH * 0.15);
        int y1 = Math.Min(h, eyeBottom + (int)(e.EyeH * 2.2));
        int cx = (e.LeftCx + e.RightCx) / 2;
        int halfW = (int)(Math.Abs(e.LeftCx - e.RightCx) * 0.75);
        int x0 = Math.Max(0, cx - halfW), x1 = Math.Min(w, cx + halfW);
        if (y1 <= y0 || x1 <= x0) return null;

        var mask = new bool[w * h];
        for (int y = y0; y < y1; y++)
            for (int x = x0; x < x1; x++)
            {
                int p = (y * w + x) * 4;
                if (px[p + 3] < 200) continue;
                int b = px[p], g = px[p + 1], r = px[p + 2];
                int mx = Math.Max(b, Math.Max(g, r));
                if (mx > 175) continue;          // 暗
                if (r < g + 6) continue;         // 偏红
                mask[y * w + x] = true;
            }

        var comps = Components(mask, w, h, Math.Max(25, w * h / 6000));
        if (comps.Count == 0) { log($"嘴区域({x0},{y0})-({x1},{y1}) 没有暗红块"); return null; }
        var best = comps.OrderByDescending(c => c.Area).First();
        return new Rectangle(best.X, best.Y, best.Width, best.Height);
    }

    struct Comp
    {
        public int X, Y, W, H, Area;
        public int Width => W;
        public int Height => H;
        public int Right => X + W;
        public int Bottom => Y + H;
    }

    static List<Comp> Components(bool[] mask, int w, int h, int minArea)
    {
        var seen = new bool[mask.Length];
        var list = new List<Comp>();
        var stack = new Stack<int>();
        for (int i = 0; i < mask.Length; i++)
        {
            if (!mask[i] || seen[i]) continue;
            stack.Clear(); stack.Push(i);
            seen[i] = true;
            int minX = i % w, maxX = minX, minY = i / w, maxY = minY, area = 0;
            while (stack.Count > 0)
            {
                int c = stack.Pop(); area++;
                int x = c % w, y = c / w;
                if (x < minX) minX = x; if (x > maxX) maxX = x;
                if (y < minY) minY = y; if (y > maxY) maxY = y;
                if (x > 0 && mask[c - 1] && !seen[c - 1]) { seen[c - 1] = true; stack.Push(c - 1); }
                if (x < w - 1 && mask[c + 1] && !seen[c + 1]) { seen[c + 1] = true; stack.Push(c + 1); }
                if (y > 0 && mask[c - w] && !seen[c - w]) { seen[c - w] = true; stack.Push(c - w); }
                if (y < h - 1 && mask[c + w] && !seen[c + w]) { seen[c + w] = true; stack.Push(c + w); }
            }
            if (area >= minArea)
                list.Add(new Comp { X = minX, Y = minY, W = maxX - minX + 1, H = maxY - minY + 1, Area = area });
        }
        return list.OrderByDescending(c => c.Area).ToList();
    }

    // ---------------- 输出 ----------------

    static void Emit(byte[] px, int w, int h, Eyes e, Rectangle? mouth, string outDir, string id, string name, Action<string> log)
    {
        string art = Path.Combine(outDir, "art");
        Directory.CreateDirectory(art);
        WritePng(Path.Combine(outDir, "_normalized.png"), px, w, h);   // 归一化后的原图，用于验收比对

        var eyeL = e.Left.Width > 0 ? Grow(e.Left, 3) : Rectangle.Empty;
        var eyeR = e.Right.Width > 0 ? Grow(e.Right, 3) : Rectangle.Empty;
        if (eyeL.Width <= 0) log("左眼：跳过（未给坐标或被头发遮挡）");
        if (eyeR.Width <= 0) log("右眼：跳过（未给坐标或被头发遮挡）");
        var mouthBox = mouth.HasValue ? Grow(mouth.Value, 3) : Rectangle.Empty;

        // 肤色：眼框外一圈的中位色
        var skin = SampleSkin(px, w, h, eyeL, eyeR);
        log($"肤色采样: RGB({skin.R},{skin.G},{skin.B})");

        // 分区：白 / 有色 / 暗
        var whiteL = new byte[w * h * 4]; var irisL = new byte[w * h * 4]; var lashL = new byte[w * h * 4];
        var whiteR = new byte[w * h * 4]; var irisR = new byte[w * h * 4]; var lashR = new byte[w * h * 4];
        var mouthPx = new byte[w * h * 4];

        for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++)
            {
                int p = (y * w + x) * 4;
                byte a = px[p + 3];
                if (a < 16) continue;
                int b = px[p], g = px[p + 1], r = px[p + 2];
                int mx = Math.Max(b, Math.Max(g, r)), mn = Math.Min(b, Math.Min(g, r));
                double sat = mx == 0 ? 0 : (double)(mx - mn) / mx;

                bool inL = eyeL.Width > 0 && eyeL.Contains(x, y), inR = eyeR.Width > 0 && eyeR.Contains(x, y);
                if (inL || inR)
                {
                    // 接近肤色的像素留在 body，不参与眼睛分层（否则眨眼时皮肤会跟着动）
                    int dr = Math.Abs(r - skin.R), dg = Math.Abs(g - skin.G), db = Math.Abs(b - skin.B);
                    if (dr + dg + db < 45) continue;
                    var dst = inL ? (sat < 0.13 && mx >= 215 ? whiteL : sat > 0.22 ? irisL : lashL)
                                  : (sat < 0.13 && mx >= 215 ? whiteR : sat > 0.22 ? irisR : lashR);
                    Array.Copy(px, p, dst, p, 4);
                    continue;
                }
                if (mouthBox.Width > 0 && mouthBox.Contains(x, y))
                    Array.Copy(px, p, mouthPx, p, 4);
            }

        // body：眼、嘴区域补肤色
        var body = (byte[])px.Clone();
        void Fill(Rectangle box)
        {
            if (box.Width <= 0) return;
            int shift = box.Height + 2;
            for (int y = box.Top; y < box.Bottom; y++)
                for (int x = box.Left; x < box.Right; x++)
                {
                    if (x < 0 || x >= w || y < 0 || y >= h) continue;
                    int p = (y * w + x) * 4;
                    if (body[p + 3] < 16) continue;
                    int rr = body[p + 2], gg = body[p + 1], bb2 = body[p];
                    if (Math.Abs(rr - skin.R) + Math.Abs(gg - skin.G) + Math.Abs(bb2 - skin.B) < 45) continue;
                    // 优先取正下方同列的皮肤（保留原有明暗），取不到才用采样色
                    int sy = Math.Min(h - 1, y + shift);
                    int q = (sy * w + x) * 4;
                    if (px[q + 3] >= 200)
                    {
                        body[p] = px[q]; body[p + 1] = px[q + 1]; body[p + 2] = px[q + 2];
                    }
                    else
                    {
                        body[p] = skin.B; body[p + 1] = skin.G; body[p + 2] = skin.R;
                    }
                    body[p + 3] = 255;
                }
        }
        Fill(eyeL); Fill(eyeR); if (mouthBox.Width > 0) Fill(mouthBox);

        void Save(string file, byte[] data) => WritePng(Path.Combine(art, file), data, w, h);
        Save("01_body.png", body);
        if (eyeL.Width > 0) { Save("04_eyewhite-l.png", whiteL); Save("08_iris-l.png", irisL); Save("06_lash-l.png", lashL); }
        if (eyeR.Width > 0) { Save("05_eyewhite-r.png", whiteR); Save("09_iris-r.png", irisR); Save("07_lash-r.png", lashR); }
        if (mouthBox.Width > 0) Save("03_mouth.png", mouthPx);

        // manifest
        double charH = 0;
        var bb = AlphaBounds(px, w, h);
        if (bb.Height > 0) charH = bb.Height;
        double scale = charH > 0 ? Math.Round(400.0 / charH, 3) : 0.32;
        int blink = Math.Max(6, (int)(e.EyeH * 0.45));

        var layers = new List<object>
        {
            new { id = "body", file = "art/01_body.png", group = "body", role = "body" },
        };
        if (mouthBox.Width > 0) layers.Add(new { id = "mouth", file = "art/03_mouth.png", group = "head", role = "mouth" });
        if (eyeL.Width > 0)
        {
            layers.Add(new { id = "eye.white.l", file = "art/04_eyewhite-l.png", group = "head", role = "eye.white.l" });
            layers.Add(new { id = "eye.iris.l", file = "art/08_iris-l.png", group = "head", role = "eye.iris.l" });
            layers.Add(new { id = "eye.lash.l", file = "art/06_lash-l.png", group = "head", role = "eye.lash.l" });
        }
        if (eyeR.Width > 0)
        {
            layers.Add(new { id = "eye.white.r", file = "art/05_eyewhite-r.png", group = "head", role = "eye.white.r" });
            layers.Add(new { id = "eye.iris.r", file = "art/09_iris-r.png", group = "head", role = "eye.iris.r" });
            layers.Add(new { id = "eye.lash.r", file = "art/07_lash-r.png", group = "head", role = "eye.lash.r" });
        }

        var m = new
        {
            schema = 2, id, name, author = "you", version = "0.1.0", rig = "layered",
            canvas = new { w, h },
            display = new { scale },
            hitbox = new { x = bb.X, y = bb.Y, w = bb.Width, h = bb.Height },
            rigOptions = new
            {
                headPivot = new[] { (e.LeftCx + e.RightCx) / 2, e.LeftCy + e.EyeH * 3 },
                mouthPivot = mouth.HasValue ? new[] { mouth.Value.X + mouth.Value.Width / 2, mouth.Value.Y } : new[] { (e.LeftCx + e.RightCx) / 2, e.LeftCy + e.EyeH * 2 },
                gazeCenter = new[] { (e.LeftCx + e.RightCx) / 2, (e.LeftCy + e.RightCy) / 2 },
                eyeCenters = new { l = new[] { e.LeftCx, e.LeftCy }, r = new[] { e.RightCx, e.RightCy } },
                motion = new { breath = 0.011, sway = 0.008, headTurn = 0, gazeMax = new[] { 4, 3 }, backHairSway = 0.02 },
                blinkLash = new { l = new[] { 0, blink }, r = new[] { 0, blink } },
            },
            interaction = new
            {
                cursor = "pointer",
                regions = new object[]
                {
                    new { id = "head", gesture = "pat", cursor = "pointer",
                          shape = new { type = "ellipse", cx = (e.LeftCx + e.RightCx) / 2, cy = e.LeftCy,
                                        rx = Math.Max(40, Math.Abs(e.LeftCx - e.RightCx) / 2 + (int)(e.EyeH * 1.6)),
                                        ry = (int)(e.EyeH * 2.4) },
                          hoverCloseEyes = true },
                    new { id = "body", gesture = "poke", cursor = "pointer",
                          shape = new { type = "rect", x = bb.X, y = e.LeftCy + e.EyeH * 2, w = bb.Width, h = Math.Max(20, bb.Y + bb.Height - (e.LeftCy + e.EyeH * 2)) } }
                },
                menu = new[] { "pat", "poke", "hop", "blink", "talk", "separator", "resize", "recenter", "hide", "quit" },
                hoverCloseEyes = false,
            },
            layers = layers.ToArray(),
        };
        File.WriteAllText(Path.Combine(outDir, "manifest.json"),
            JsonSerializer.Serialize(m, new JsonSerializerOptions
            {
                WriteIndented = true,
                Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
            }), new UTF8Encoding(false));

        log($"已输出: {outDir}  （blinkLash={blink}px, display.scale={scale}）");
    }

    static Rectangle Grow(Rectangle r, int n) =>
        new Rectangle(r.X - n, r.Y - n, r.Width + n * 2, r.Height + n * 2);

    static Color SampleSkin(byte[] px, int w, int h, Rectangle a, Rectangle b)
    {
        var list = new List<(int r, int g, int b)>();
        void Scan(Rectangle box)
        {
            for (int y = Math.Max(0, box.Top - 6); y < Math.Min(h, box.Bottom + 6); y++)
                for (int x = Math.Max(0, box.Left - 6); x < Math.Min(w, box.Right + 6); x++)
                {
                    if (box.Contains(x, y)) continue;
                    int p = (y * w + x) * 4;
                    if (px[p + 3] < 200) continue;
                    int bb = px[p], g = px[p + 1], r = px[p + 2];
                    int mx = Math.Max(bb, Math.Max(g, r)), mn = Math.Min(bb, Math.Min(g, r));
                    if (mx < 90) continue;
                    double sat = mx == 0 ? 0 : (double)(mx - mn) / mx;
                    if (sat > 0.45) continue;
                    list.Add((r, g, bb));
                }
        }
        Scan(a); Scan(b);
        if (list.Count == 0) return Color.FromArgb(255, 240, 220, 205);
        list.Sort((x, y) => (x.r + x.g + x.b).CompareTo(y.r + y.g + y.b));
        var mid = list[(int)(list.Count * 0.7)];
        return Color.FromArgb(255, mid.r, mid.g, mid.b);
    }

    // ---------------- 基础图像 ----------------

    static Bitmap LoadBgra(string path)
    {
        using var src = Image.FromFile(path);
        var bmp = new Bitmap(src.Width, src.Height, PixelFormat.Format32bppArgb);
        using var g = Graphics.FromImage(bmp);
        g.Clear(Color.Transparent);
        g.CompositingMode = CompositingMode.SourceCopy;
        g.DrawImage(src, new Rectangle(0, 0, src.Width, src.Height));
        return bmp;
    }

    static (byte[] px, int w, int h, double scale, double dx, double dy) Normalize(Bitmap src, int canvas)
    {
        var bb = AlphaBoundsOf(src);
        if (bb.Width <= 0) throw new InvalidOperationException("源图全透明");

        double usable = canvas * 0.94;
        double scale = Math.Min(usable / bb.Width, usable / bb.Height);
        double dw = bb.Width * scale, dh = bb.Height * scale;
        double dx = (canvas - dw) / 2 - bb.X * scale;
        double dy = (canvas - 24) - (bb.Y + bb.Height) * scale;

        using var dst = new Bitmap(canvas, canvas, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(dst))
        {
            g.Clear(Color.Transparent);
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.CompositingQuality = CompositingQuality.HighQuality;
            using var mx = new Matrix();
            mx.Scale((float)scale, (float)scale, MatrixOrder.Append);
            mx.Translate((float)dx, (float)dy, MatrixOrder.Append);
            g.Transform = mx;
            g.DrawImage(src, 0, 0);
        }
        var data = dst.LockBits(new Rectangle(0, 0, canvas, canvas), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        var px = new byte[Math.Abs(data.Stride) * canvas];
        System.Runtime.InteropServices.Marshal.Copy(data.Scan0, px, 0, px.Length);
        dst.UnlockBits(data);
        return (px, canvas, canvas, scale, dx, dy);
    }

    static Rectangle AlphaBoundsOf(Bitmap b)
    {
        var data = b.LockBits(new Rectangle(0, 0, b.Width, b.Height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        var px = new byte[Math.Abs(data.Stride) * b.Height];
        System.Runtime.InteropServices.Marshal.Copy(data.Scan0, px, 0, px.Length);
        b.UnlockBits(data);
        return AlphaBounds(px, b.Width, b.Height);
    }

    static Rectangle AlphaBounds(byte[] px, int w, int h)
    {
        int minX = w, minY = h, maxX = -1, maxY = -1;
        for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++)
            {
                if (px[(y * w + x) * 4 + 3] < 16) continue;
                if (x < minX) minX = x; if (x > maxX) maxX = x;
                if (y < minY) minY = y; if (y > maxY) maxY = y;
            }
        if (maxX < 0) return Rectangle.Empty;
        return new Rectangle(minX, minY, maxX - minX + 1, maxY - minY + 1);
    }

    static void WritePng(string path, byte[] px, int w, int h)
    {
        using var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        var data = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        System.Runtime.InteropServices.Marshal.Copy(px, 0, data.Scan0, px.Length);
        bmp.UnlockBits(data);
        using var ms = new MemoryStream();
        bmp.Save(ms, ImageFormat.Png);
        File.WriteAllBytes(path, ms.ToArray());
    }

    // ---------------- 参数 ----------------

    static Dictionary<string, string> Args(string[] argv)
    {
        var d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        for (int i = 0; i < argv.Length - 1; i++)
            if (argv[i].StartsWith("--")) d[argv[i][2..]] = argv[i + 1];
        return d;
    }

    static string Get(Dictionary<string, string> d, string k) => d.TryGetValue(k, out var v) ? v : null;
}
