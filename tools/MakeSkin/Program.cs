using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace MakeSkin;

/// <summary>
/// 把「一张（或几张）透明背景 PNG」做成 surfpet 能直接加载的皮肤包（schema 2）。
///
/// 为什么需要它：surfpet 的皮肤是「同画布、同位置的分层图 + manifest.json」，
/// 手搓要算画布对齐、包围盒、锚点、命中区、缩放。这个工具全自动算好，
/// 你只管出图。单层皮肤完全合法（规范里写明「新皮肤可以只给 art 先跑起来」），
/// 只是没有眨眼 / 视线跟随——想要那些效果再按角色拆层。
///
/// 用法:
///   dotnet run --project tools/MakeSkin -- --src D:\我的图\角色.png --out D:\...\skins\my-01 --id my-01 --name "我的角色"
///   dotnet run --project tools/MakeSkin -- --src D:\我的分层目录 --out ... --id my-02 --name "我的角色2"
/// </summary>
internal static class Program
{
    const int DefaultCanvas = 1024;
    const int BottomMargin = 24;      // 角色底部离画布底边留一点，避免被窗口边裁掉
    const double TargetScreenHeight = 400; // 期望在屏幕上大约多高（px）

    static int Main(string[] argv)
    {
        if (argv.Length >= 2 && argv[0] == "--report") return Report(argv[1]);
        if (argv.Length >= 2 && argv[0] == "--inspect") return Inspect(argv[1]);
        if (argv.Length >= 1 && argv[0] == "--punch") return Punch(argv);
        if (argv.Length >= 1 && argv[0] == "--ico") return MakeIco(argv);
        if (argv.Length >= 1 && argv[0] == "--icon") return MakeIcon(argv);

        try
        {
            var a = ParseArgs(argv);
            string src = Get(a, "src") ?? throw new ArgumentException("缺少 --src（一张图，或一个装分层图的目录）");
            string outDir = Path.GetFullPath(Get(a, "out") ?? throw new ArgumentException("缺少 --out"));
            string id = Get(a, "id") ?? Path.GetFileName(outDir.TrimEnd('\\', '/'));
            string name = Get(a, "name") ?? id;
            int canvas = int.TryParse(Get(a, "canvas"), out var c) && c >= 256 ? c : DefaultCanvas;

            var files = CollectFiles(src);
            if (files.Count == 0) throw new InvalidOperationException("没找到任何图片");

            // 1. 读图 + 各自的 alpha 包围盒
            var images = new List<(string Path, Bitmap Bmp, string Role)>();
            foreach (var f in files)
            {
                var bmp = LoadBgra(f);
                images.Add((f, bmp, GuessRole(Path.GetFileNameWithoutExtension(f))));
            }

            var boxes = images.Select(i => AlphaBounds(i.Bmp)).Where(b => b.Width > 0).ToList();
            if (boxes.Count == 0) throw new InvalidOperationException("所有图都是全透明，没有内容可裁");

            var union = Union(boxes);

            // 2. 一套变换，所有层共用（关键：分层必须严格对齐，不能逐层裁边）
            double byHeight = TargetCharHeight(canvas) / union.Height;
            double byWidth = (canvas - 2.0 * BottomMargin) / union.Width;
            double scale = Math.Min(byHeight, byWidth);
            double offX = canvas / 2.0 - (union.X + union.Width / 2.0) * scale;
            double offY = (canvas - BottomMargin) - (union.Y + union.Height) * scale;

            Console.WriteLine($"源      : {src}  （{images.Count} 张）");
            Console.WriteLine($"输出    : {outDir}");
            Console.WriteLine($"皮套    : {id} / {name} / 画布 {canvas}²");
            Console.WriteLine($"并集    : {union.Width}x{union.Height} @ ({union.X},{union.Y})  缩放 {scale:0.0000}  偏移 ({offX:0.0},{offY:0.0})");
            Console.WriteLine();

            Directory.CreateDirectory(Path.Combine(outDir, "art"));

            // 3. 出图 + 组 manifest
            var layersJson = new JsonArray();
            var usedRoles = new HashSet<string>();
            var composite = new Bitmap(canvas, canvas, PixelFormat.Format32bppArgb);
            using (var cg = Graphics.FromImage(composite))
                cg.Clear(Color.Transparent);

            int index = 0;
            foreach (var (path, bmp, role) in images)
            {
                index++;
                string fileName = $"{index:00}_{SafeName(role)}.png";
                string dest = Path.Combine(outDir, "art", fileName);
                Render(bmp, dest, canvas, scale, offX, offY);

                using (var layerImg = Image.FromFile(dest))
                using (var cg = Graphics.FromImage(composite))
                    cg.DrawImageUnscaled(layerImg, 0, 0);

                string group = IsHeadRole(role) ? "head" : "body";
                // 同一个 role 出现两次要加后缀，避免 id 重复
                string layerId = role;
                int dup = 2;
                while (!usedRoles.Add(layerId)) layerId = $"{role}.{dup++}";

                layersJson.Add(new JsonObject
                {
                    ["id"] = layerId,
                    ["file"] = "art/" + fileName,
                    ["group"] = group,
                    ["role"] = role,
                });
                Console.WriteLine($"  {Path.GetFileName(path),-32} -> art/{fileName,-26} role={role,-12} group={group}");
            }

            // 4. 预览图
            SavePreview(composite, Path.Combine(outDir, "preview.png"), 128);

            // 5. manifest
            var manifest = new JsonObject
            {
                ["schema"] = 2,
                ["id"] = id,
                ["name"] = name,
                ["author"] = "you",
                ["version"] = "0.1.0",
                ["rig"] = "layered",
                ["canvas"] = new JsonObject { ["w"] = canvas, ["h"] = canvas },
                ["display"] = new JsonObject
                {
                    // 角色在画布里的高度是 TargetCharHeight，再乘这个 scale 就是屏幕高度
                    ["scale"] = Math.Round(TargetScreenHeight / TargetCharHeight(canvas), 3),
                },
                ["hitbox"] = HitboxJson(union, scale, offX, offY),
                ["interaction"] = new JsonObject
                {
                    ["cursor"] = "pointer",
                    ["regions"] = RegionsJson(union, scale, offX, offY),
                    ["menu"] = new JsonArray("pat", "poke", "hop", "separator", "recenter", "hide", "quit"),
                    ["hoverCloseEyes"] = false,
                },
                ["layers"] = layersJson,
            };

            File.WriteAllText(Path.Combine(outDir, "manifest.json"),
                manifest.ToJsonString(new JsonSerializerOptions
                {
                    WriteIndented = true,
                    Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
                }), new UTF8Encoding(false));

            composite.Dispose();
            foreach (var (_, bmp, _) in images) bmp.Dispose();

            Console.WriteLine();
            Console.WriteLine("完成。把这个目录放进桌宠的 skins/ 下，然后右键菜单里就能选到它。");
            Console.WriteLine($"  {outDir}");
            Console.WriteLine();
            Console.WriteLine("注意：单层皮肤有呼吸/摇摆/拖拽/摸头，但没有眨眼和视线跟随；");
            Console.WriteLine("      想要那些效果，把眼睛（眼白/虹膜/睫毛）、嘴、头发分别出图后再跑一次。");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("失败: " + ex.Message);
            return 1;
        }
    }

    static double TargetCharHeight(int canvas) => canvas - BottomMargin - 40;

    // ---------------- 图标：裁边 → 方形 → PNG / 多尺寸 ICO ----------------

    /// <summary>
    /// 用法:
    ///   --icon --src 应用图标.png --out 512.png --size 512 --margin 0.04
    ///   --ico  --src 512.png --out icon.ico --sizes 16,24,32,48,64,128,256
    /// 把任意图标源规范化成「内容居中、正方形、指定边距」的 PNG，再打包成 ICO。
    /// 小尺寸用 BMP(DIB) 条目、大尺寸用 PNG 条目（兼容性最好）。
    /// </summary>
    static int MakeIcon(string[] argv)
    {
        var a = ParseArgs(argv);
        string src = Get(a, "src"), outPath = Get(a, "out");
        if (src == null || outPath == null) throw new ArgumentException("需要 --src 和 --out");
        int size = int.TryParse(Get(a, "size"), out var s) ? s : 512;
        double margin = double.TryParse(Get(a, "margin"), out var m) ? m : 0.04;

        SaveIconPng(src, outPath, size, margin);
        Console.WriteLine($"图标 -> {outPath}  ({size}x{size}，边距 {margin * 100:0}%)");
        return 0;
    }

    static void SaveIconPng(string src, string outPath, int size, double margin)
    {
        var bmp = LoadBgra(src);
        var box = AlphaBounds(bmp);
        double usable = size * (1 - 2 * margin);
        double scale = Math.Min(usable / box.Width, usable / box.Height);
        double w = box.Width * scale, h = box.Height * scale;
        double ox = (size - w) / 2 - box.X * scale;
        double oy = (size - h) / 2 - box.Y * scale;
        using var c = new Bitmap(size, size, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(c))
        {
            g.Clear(Color.Transparent);
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.CompositingQuality = CompositingQuality.HighQuality;
            using var mx = new Matrix();
            mx.Scale((float)scale, (float)scale, MatrixOrder.Append);
            mx.Translate((float)ox, (float)oy, MatrixOrder.Append);
            g.Transform = mx;
            g.DrawImage(bmp, 0, 0);
        }
        bmp.Dispose();
        using var ms = new MemoryStream();
        c.Save(ms, ImageFormat.Png);
        File.WriteAllBytes(outPath, ms.ToArray());
    }

    static int MakeIco(string[] argv)
    {
        var a = ParseArgs(argv);
        string src = Get(a, "src"), outPath = Get(a, "out");
        if (src == null || outPath == null) throw new ArgumentException("需要 --src 和 --out");
        var sizes = (Get(a, "sizes") ?? "16,24,32,48,64,128,256")
            .Split(',').Select(x => int.Parse(x.Trim())).OrderBy(x => x).ToArray();

        var blobs = new List<(int Size, byte[] Data)>();
        foreach (var sz in sizes)
        {
            using var b = new Bitmap(sz, sz, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(b))
            {
                g.Clear(Color.Transparent);
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                g.CompositingQuality = CompositingQuality.HighQuality;
                using var img = Image.FromFile(src);
                g.DrawImage(img, 0, 0, sz, sz);
            }
            byte[] data = sz >= 64 ? EncodePng(b) : EncodeDib(b);
            blobs.Add((sz, data));
        }

        using var fs = File.Create(outPath);
        using var bw = new BinaryWriter(fs);
        bw.Write((ushort)0); bw.Write((ushort)1); bw.Write((ushort)blobs.Count);
        int offset = 6 + 16 * blobs.Count;
        foreach (var (sz, data) in blobs)
        {
            bw.Write((byte)(sz >= 256 ? 0 : sz));
            bw.Write((byte)(sz >= 256 ? 0 : sz));
            bw.Write((byte)0); bw.Write((byte)0);
            bw.Write((ushort)1); bw.Write((ushort)32);
            bw.Write(data.Length); bw.Write(offset);
            offset += data.Length;
        }
        foreach (var (_, data) in blobs) bw.Write(data);

        Console.WriteLine($"ICO -> {outPath}  尺寸 {string.Join(",", sizes)}  {new FileInfo(outPath).Length} 字节");
        return 0;
    }

    static byte[] EncodePng(Bitmap b)
    {
        using var ms = new MemoryStream();
        b.Save(ms, ImageFormat.Png);
        return ms.ToArray();
    }

    /// <summary>32bit BGRA DIB + AND mask（小尺寸用这个，老接口也认）</summary>
    static byte[] EncodeDib(Bitmap b)
    {
        int w = b.Width, h = b.Height;
        using var ms = new MemoryStream();
        using var bw = new BinaryWriter(ms);
        bw.Write(40);              // biSize
        bw.Write(w);               // biWidth
        bw.Write(h * 2);           // biHeight (XOR + AND)
        bw.Write((ushort)1);       // biPlanes
        bw.Write((ushort)32);      // biBitCount
        bw.Write(0);               // biCompression = BI_RGB
        bw.Write(w * h * 4);       // biSizeImage
        bw.Write(0); bw.Write(0); bw.Write(0); bw.Write(0);
        // 像素：自下而上
        for (int y = h - 1; y >= 0; y--)
            for (int x = 0; x < w; x++)
            {
                var c = b.GetPixel(x, y);
                bw.Write(c.B); bw.Write(c.G); bw.Write(c.R); bw.Write(c.A);
            }
        // AND 掩码：全 0（用 alpha 通道即可），1bpp，按 4 字节对齐
        int rowBytes = ((w + 31) / 32) * 4;
        for (int i = 0; i < rowBytes * h; i++) bw.Write((byte)0);
        bw.Flush();
        return ms.ToArray();
    }

    // ---------------- 打洞模式：把 body 上被单独拆出去的部分擦成透明 ----------------

    /// <summary>
    /// 用法:
    ///   --punch --body 01_body.png --out 01_body_new.png --dilate 3 --mask 12_eyewhite-l.png --mask 13_eyewhite-r.png ...
    /// 用若干「已单独拆出的层」的 alpha 形状当模板，在 body 上把这些位置擦成透明。
    /// 只清 alpha、保留 RGB，这样遮挡边缘的抗锯齿不会出现黑边。
    /// </summary>
    static int Punch(string[] argv)
    {
        try
        {
            string body = null, outPath = null;
            int dilate = 0;
            var masks = new List<string>();
            for (int i = 1; i < argv.Length - 1; i++)
            {
                switch (argv[i])
                {
                    case "--body": body = argv[++i]; break;
                    case "--out": outPath = argv[++i]; break;
                    case "--dilate": dilate = int.Parse(argv[++i]); break;
                    case "--mask": masks.Add(argv[++i]); break;
                }
            }
            if (body == null || outPath == null) throw new ArgumentException("需要 --body 和 --out");
            if (masks.Count == 0) throw new ArgumentException("至少给一个 --mask");

            var bmp = LoadBgra(body);
            int w = bmp.Width, h = bmp.Height, stride = w * 4;
            var data = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
            var px = new byte[stride * h];
            System.Runtime.InteropServices.Marshal.Copy(data.Scan0, px, 0, px.Length);

            var mask = new bool[w * h];
            foreach (var m in masks)
            {
                var mb = LoadBgra(m);
                var md = mb.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
                var mp = new byte[stride * h];
                System.Runtime.InteropServices.Marshal.Copy(md.Scan0, mp, 0, mp.Length);
                mb.UnlockBits(md);
                mb.Dispose();
                for (int i = 0; i < mask.Length; i++) if (mp[i * 4 + 3] >= 16) mask[i] = true;
            }

            // 先横向膨胀再纵向膨胀（可分离，快）
            if (dilate > 0)
            {
                var tmp = new bool[w * h];
                for (int y = 0; y < h; y++)
                    for (int x = 0; x < w; x++)
                    {
                        if (!mask[y * w + x]) continue;
                        int x0 = Math.Max(0, x - dilate), x1 = Math.Min(w - 1, x + dilate);
                        for (int k = x0; k <= x1; k++) tmp[y * w + k] = true;
                    }
                Array.Clear(mask, 0, mask.Length);
                for (int y = 0; y < h; y++)
                    for (int x = 0; x < w; x++)
                    {
                        if (!tmp[y * w + x]) continue;
                        int y0 = Math.Max(0, y - dilate), y1 = Math.Min(h - 1, y + dilate);
                        for (int k = y0; k <= y1; k++) mask[k * w + x] = true;
                    }
            }

            int cleared = 0, total = 0;
            for (int i = 0; i < mask.Length; i++)
            {
                if (!mask[i]) continue;
                total++;
                if (px[i * 4 + 3] > 0) { px[i * 4 + 3] = 0; cleared++; }
            }

            System.Runtime.InteropServices.Marshal.Copy(px, 0, data.Scan0, px.Length);
            bmp.UnlockBits(data);

            // 先写内存再落盘：GDI+ 的 Save(string) 在部分中文路径上会抛 "generic error"
            using (var ms = new MemoryStream())
            {
                bmp.Save(ms, ImageFormat.Png);
                File.WriteAllBytes(outPath, ms.ToArray());
            }
            bmp.Dispose();

            Console.WriteLine($"掩膜覆盖 {total} px，其中擦掉 {cleared} px（膨胀 {dilate}px）");
            Console.WriteLine($"输出 {outPath}");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("punch failed: " + ex.Message);
            return 1;
        }
    }

    // ---------------- 清点模式：看一堆图能不能直接做皮套 ----------------

    /// <summary>检查一个目录/文件：尺寸、是否真透明、内容包围盒、可见像素占比。</summary>
    static int Inspect(string src)
    {
        try
        {
            var files = CollectFiles(src, includeOpaque: true);
            if (files.Count == 0) { Console.WriteLine("没找到图片（.png / .webp / .jpg）"); return 1; }

            Console.WriteLine($"# 共 {files.Count} 个图片  源: {Path.GetFullPath(src)}");
            Console.WriteLine("file\tw\th\talphaMin\tvisiblePct\tbbox\tcornerA\thasAlpha");

            int withAlpha = 0;
            var boxes = new List<Rectangle>();

            foreach (var f in files)
            {
                var bmp = LoadBgra(f);
                var box = AlphaBounds(bmp);
                boxes.Add(box);

                var data = bmp.LockBits(new Rectangle(0, 0, bmp.Width, bmp.Height),
                                        ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
                var px = new byte[Math.Abs(data.Stride) * bmp.Height];
                System.Runtime.InteropServices.Marshal.Copy(data.Scan0, px, 0, px.Length);
                bmp.UnlockBits(data);

                int alphaMin = 255, visible = 0;
                int total = bmp.Width * bmp.Height;
                for (int i = 3; i < px.Length; i += 4)
                {
                    int a = px[i];
                    if (a < alphaMin) alphaMin = a;
                    if (a >= 16) visible++;
                }

                int cornerA = px[3];
                bool hasAlpha = box.Width > 0 && alphaMin < 240;
                if (hasAlpha) withAlpha++;

                Console.WriteLine(string.Join("\t",
                    Path.GetFileName(f), bmp.Width, bmp.Height,
                    alphaMin, (100.0 * visible / total).ToString("0.0"),
                    box.Width > 0 ? $"{box.X},{box.Y} {box.Width}x{box.Height}" : "-",
                    cornerA, hasAlpha ? "是" : "否"));
                bmp.Dispose();
            }

            var valid = boxes.Where(b => b.Width > 0).ToList();
            Console.WriteLine();
            if (valid.Count > 0)
            {
                int x1 = valid.Min(b => b.X), y1 = valid.Min(b => b.Y);
                int x2 = valid.Max(b => b.Right), y2 = valid.Max(b => b.Bottom);
                Console.WriteLine($"# 并集包围盒 x={x1} y={y1} w={x2 - x1} h={y2 - y1}");
            }

            // 边缘剖面：看是否真的顶到边被裁（逐行/逐列可见像素数）
            if (files.Count >= 1)
            {
                Console.WriteLine("# 阈值扫描（哪一档开始收紧 = 边缘有多少飘散像素/阴影）:");
                foreach (var f in files)
                {
                    var b = LoadBgra(f);
                    var parts = new List<string>();
                    foreach (var t in new[] { 8, 32, 64, 128 })
                    {
                        var bx = AlphaBounds(b, t);
                        parts.Add($"t{t}=({bx.X},{bx.Y}) {bx.Width}x{bx.Height}");
                    }
                    Console.WriteLine($"#   {Path.GetFileName(f)}");
                    Console.WriteLine($"#     {string.Join("  ", parts)}");
                    b.Dispose();
                }

                var bmp = LoadBgra(files[^1]);
                var data = bmp.LockBits(new Rectangle(0, 0, bmp.Width, bmp.Height),
                                        ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
                var px = new byte[Math.Abs(data.Stride) * bmp.Height];
                System.Runtime.InteropServices.Marshal.Copy(data.Scan0, px, 0, px.Length);
                int stride = Math.Abs(data.Stride);
                bmp.UnlockBits(data);

                int RowCount(int y)
                {
                    int c = 0;
                    for (int x = 0; x < bmp.Width; x++) if (px[y * stride + x * 4 + 3] >= 16) c++;
                    return c;
                }

                Console.WriteLine($"# 顶部各行可见像素数（{Path.GetFileName(files[^1])}）:");
                for (int y = 0; y < Math.Min(8, bmp.Height); y++)
                    Console.WriteLine($"#   y={y,-3} {RowCount(y)} px");
                Console.WriteLine("# 底部各行可见像素数:");
                for (int y = Math.Max(0, bmp.Height - 5); y < bmp.Height; y++)
                    Console.WriteLine($"#   y={y,-3} {RowCount(y)} px");
                bmp.Dispose();
            }
            Console.WriteLine($"# 带透明通道的图: {withAlpha}/{files.Count}");
            if (withAlpha == 0)
                Console.WriteLine("# ⚠ 全是实底（没有透明背景）→ 做不了桌宠皮套，需要先抠图");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("inspect failed: " + ex.Message);
            return 1;
        }
    }

    // ---------------- 报告模式：量一套现成皮肤每层的实际位置 ----------------

    /// <summary>把一套皮肤的每层包围盒、锚点、命中区全部量出来，供做美术时对位置。</summary>
    static int Report(string skinDir)
    {
        try
        {
            var manifest = JsonNode.Parse(File.ReadAllText(Path.Combine(skinDir, "manifest.json")));
            int cw = manifest["canvas"]["w"].GetValue<int>();
            int ch = manifest["canvas"]["h"].GetValue<int>();

            Console.WriteLine($"# skin={manifest["id"]}  name={manifest["name"]}");
            Console.WriteLine($"# canvas={cw}x{ch}  display.scale={manifest["display"]?["scale"]}");

            var union = Rectangle.Empty;
            var boxes = new List<Rectangle>();

            Console.WriteLine("layer\trole\tgroup\tfile\tw\th\tbx\tby\tbw\tbh\tpctOfCanvas");
            foreach (var l in manifest["layers"].AsArray())
            {
                string file = l["file"].GetValue<string>();
                var bmp = LoadBgra(Path.Combine(skinDir, file));
                var box = AlphaBounds(bmp);
                boxes.Add(box);
                Console.WriteLine(string.Join("\t",
                    l["id"], l["role"], l["group"],
                    Path.GetFileName(file), bmp.Width, bmp.Height,
                    box.X, box.Y, box.Width, box.Height,
                    (100.0 * box.Width / cw).ToString("0.0")));
                bmp.Dispose();
            }

            var valid = boxes.Where(b => b.Width > 0).ToList();
            if (valid.Count > 0)
            {
                int x1 = valid.Min(b => b.X), y1 = valid.Min(b => b.Y);
                int x2 = valid.Max(b => b.Right), y2 = valid.Max(b => b.Bottom);
                union = new Rectangle(x1, y1, x2 - x1, y2 - y1);
                Console.WriteLine();
                Console.WriteLine($"# UNION  x={union.X} y={union.Y} w={union.Width} h={union.Height}  " +
                                  $"占画布 {100.0 * union.Width / cw:0.0}% x {100.0 * union.Height / ch:0.0}%");
            }

            var ro = manifest["rigOptions"] as JsonObject;
            if (ro != null)
            {
                Console.WriteLine();
                Console.WriteLine("# rigOptions");
                foreach (var kv in ro)
                {
                    if (kv.Value is JsonObject || kv.Value is JsonArray)
                        Console.WriteLine($"#   {kv.Key} = {kv.Value.ToJsonString()}");
                }
            }

            var hb = manifest["hitbox"];
            if (hb != null)
                Console.WriteLine($"# hitbox  x={hb["x"]} y={hb["y"]} w={hb["w"]} h={hb["h"]}");

            var regions = manifest["interaction"]?["regions"] as JsonArray;
            if (regions != null)
            {
                Console.WriteLine("# regions");
                foreach (var r in regions)
                    Console.WriteLine($"#   {r["id"]} {r["gesture"]} {r["shape"]?.ToJsonString()}");
            }
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("report failed: " + ex.Message);
            return 1;
        }
    }

    // ---------------- 角色判定 ----------------

    static string GuessRole(string baseName)
    {
        string n = baseName.ToLowerInvariant();

        // 眼白 / 虹膜 / 睫毛 / 眉：左右要分开，图层 role 是有约定的
        string side = n.Contains("-l") || n.EndsWith("l") || n.Contains("left") ? "l"
                    : n.Contains("-r") || n.EndsWith("r") || n.Contains("right") ? "r"
                    : null;

        if (n.Contains("eyewhite") || n.Contains("eye_white") || n.Contains("白目")) return side is null ? "eye.white.l" : $"eye.white.{side}";
        if (n.Contains("iris") || n.Contains("irides") || n.Contains("虹膜") || n.Contains("pupil")) return side is null ? "eye.iris.l" : $"eye.iris.{side}";
        if (n.Contains("lash") || n.Contains("睫毛")) return side is null ? "eye.lash.l" : $"eye.lash.{side}";
        if (n.Contains("brow") || n.Contains("眉")) return side is null ? "brow.l" : $"brow.{side}";

        if (n.Contains("mouth") || n.Contains("嘴")) return "mouth";
        if (n.Contains("nose") || n.Contains("鼻")) return "nose";
        if (n.Contains("face") || n.Contains("脸")) return "face";
        if (n.Contains("front") && (n.Contains("hair") || n.Contains("发"))) return "hair.front";
        if (n.Contains("back") && (n.Contains("hair") || n.Contains("发"))) return "hair.back";
        if (n.Contains("hair") || n.Contains("发")) return "hair.front";
        if (n.Contains("tail") || n.Contains("尾")) return "tail";
        return "body";
    }

    static bool IsHeadRole(string role) =>
        role.StartsWith("eye.") || role.StartsWith("brow.") ||
        role is "mouth" or "nose" or "face" or "hair.front" or "headwear" or "hair.back";

    static string SafeName(string role) => role.Replace('.', '-').Replace(' ', '-');

    // ---------------- 几何 ----------------

    static JsonObject HitboxJson(Rectangle union, double scale, double offX, double offY)
    {
        int x = (int)Math.Floor(union.X * scale + offX);
        int y = (int)Math.Floor(union.Y * scale + offY);
        int w = (int)Math.Ceiling(union.Width * scale);
        int h = (int)Math.Ceiling(union.Height * scale);
        return new JsonObject { ["x"] = x, ["y"] = y, ["w"] = w, ["h"] = h };
    }

    /// <summary>头部椭圆 + 身体矩形，按包围盒比例粗分；不精确但足够让「摸头」和「戳身体」分开。</summary>
    static JsonArray RegionsJson(Rectangle union, double scale, double offX, double offY)
    {
        double left = union.X * scale + offX;
        double top = union.Y * scale + offY;
        double w = union.Width * scale;
        double h = union.Height * scale;

        double headH = h * 0.42;
        double cx = left + w / 2;

        var regions = new JsonArray
        {
            new JsonObject
            {
                ["id"] = "head",
                ["gesture"] = "pat",
                ["cursor"] = "pointer",
                ["shape"] = new JsonObject
                {
                    ["type"] = "ellipse",
                    ["cx"] = (int)Math.Round(cx),
                    ["cy"] = (int)Math.Round(top + headH / 2),
                    ["rx"] = (int)Math.Round(w * 0.46),
                    ["ry"] = (int)Math.Round(headH / 2),
                },
                ["hoverCloseEyes"] = false,
            },
            new JsonObject
            {
                ["id"] = "body",
                ["gesture"] = "poke",
                ["cursor"] = "pointer",
                ["shape"] = new JsonObject
                {
                    ["type"] = "rect",
                    ["x"] = (int)Math.Round(left),
                    ["y"] = (int)Math.Round(top + headH * 0.6),
                    ["w"] = (int)Math.Round(w),
                    ["h"] = (int)Math.Round(h - headH * 0.6),
                },
            },
        };
        return regions;
    }

    // ---------------- 图像 ----------------

    static List<string> CollectFiles(string src, bool includeOpaque = false)
    {
        var ext = includeOpaque
            ? new[] { ".png", ".webp", ".jpg", ".jpeg", ".bmp" }
            : new[] { ".png", ".webp" };
        if (File.Exists(src)) return new List<string> { Path.GetFullPath(src) };

        return Directory.GetFiles(src, "*", SearchOption.AllDirectories)
            .Where(f => ext.Contains(Path.GetExtension(f).ToLowerInvariant()))
            .OrderBy(f => f, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

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

    static Rectangle AlphaBounds(Bitmap bmp, int threshold = 8)
    {
        var rect = new Rectangle(0, 0, bmp.Width, bmp.Height);
        var data = bmp.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        try
        {
            int stride = data.Stride;
            var buf = new byte[stride * bmp.Height];
            System.Runtime.InteropServices.Marshal.Copy(data.Scan0, buf, 0, buf.Length);

            int minX = bmp.Width, minY = bmp.Height, maxX = -1, maxY = -1;
            for (int y = 0; y < bmp.Height; y++)
            {
                int row = y * stride;
                for (int x = 0; x < bmp.Width; x++)
                {
                    if (buf[row + x * 4 + 3] < threshold) continue;
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
            if (maxX < 0) return Rectangle.Empty;
            return new Rectangle(minX, minY, maxX - minX + 1, maxY - minY + 1);
        }
        finally { bmp.UnlockBits(data); }
    }

    static Rectangle Union(List<Rectangle> boxes)
    {
        int x1 = boxes.Min(b => b.X), y1 = boxes.Min(b => b.Y);
        int x2 = boxes.Max(b => b.Right), y2 = boxes.Max(b => b.Bottom);
        return new Rectangle(x1, y1, x2 - x1, y2 - y1);
    }

    static void Render(Bitmap src, string outPath, int canvas, double scale, double offX, double offY)
    {
        using var c = new Bitmap(canvas, canvas, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(c))
        {
            g.Clear(Color.Transparent);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.CompositingQuality = CompositingQuality.HighQuality;

            using var m = new Matrix();
            m.Scale((float)scale, (float)scale, MatrixOrder.Append);
            m.Translate((float)offX, (float)offY, MatrixOrder.Append);
            g.Transform = m;
            g.DrawImage(src, 0, 0);
        }
        c.Save(outPath, ImageFormat.Png);
    }

    static void SavePreview(Bitmap composite, string outPath, int size)
    {
        using var small = new Bitmap(size, size, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(small))
        {
            g.Clear(Color.Transparent);
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.DrawImage(composite, new Rectangle(0, 0, size, size));
        }
        small.Save(outPath, ImageFormat.Png);
    }

    // ---------------- 参数 ----------------

    static Dictionary<string, string> ParseArgs(string[] argv)
    {
        var d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        for (int i = 0; i < argv.Length - 1; i++)
            if (argv[i].StartsWith("--")) d[argv[i][2..]] = argv[i + 1];
        return d;
    }

    static string Get(Dictionary<string, string> d, string k) => d.TryGetValue(k, out var v) ? v : null;
}
