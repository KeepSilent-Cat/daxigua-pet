using System.Diagnostics;
using System.Text;
using System.Windows.Forms;

namespace PetLauncher;

/// <summary>
/// 双击就能用的桌宠启动器。
///
/// 为什么不用 .cmd / .vbs：
///   - .cmd 会闪黑框，而且 cmd 一退出子进程可能被连带收掉（实测你那边就是这个现象）
///   - .vbs 用 WScript.Run 起进程，窗口样式 0 会把 Electron 的主窗口也藏起来
/// 这个 exe 直接 CreateProcess 拉 electron，并**一直等它退出**，所以父进程始终在，
/// 进程树不会被清；全程无窗口，失败会弹窗告诉你原因。
///
/// 目录约定（exe 放在工程根目录）：
///   <exe 所在目录>\surfpet\runtime\electron.exe
///   <exe 所在目录>\surfpet\app\dist\main.js
/// </summary>
internal static class Program
{
    [STAThread]
    static void Main()
    {
        string baseDir = AppContext.BaseDirectory.TrimEnd('\\');
        string petDir = Path.Combine(baseDir, "surfpet");
        string electron = Path.Combine(petDir, "runtime", "electron.exe");
        string appDir = Path.Combine(petDir, "app");
        string logFile = Path.Combine(baseDir, "state", "launcher.log");

        try { Directory.CreateDirectory(Path.Combine(baseDir, "state")); } catch { /* 没权限就算了 */ }

        void Log(string s)
        {
            try { File.AppendAllText(logFile, $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {s}{Environment.NewLine}"); } catch { }
        }

        Log($"==== start  base={baseDir}");

        if (!File.Exists(electron))
        {
            Fail($"找不到 Electron 运行库：\n\n{electron}\n\n请确认 surfpet\\runtime\\electron.exe 还在。", logFile);
            return;
        }
        if (!File.Exists(Path.Combine(appDir, "dist", "main.js")))
        {
            Fail($"找不到桌宠本体：\n\n{Path.Combine(appDir, "dist", "main.js")}\n\n请确认 surfpet\\app 目录完整。", logFile);
            return;
        }

        int running = Process.GetProcessesByName("electron").Length;
        if (running > 0)
        {
            Log($"electron 已有 {running} 个进程在跑，本次跳过");
            return;
        }

        Process proc = null;
        try
        {
            var psi = new ProcessStartInfo(electron)
            {
                WorkingDirectory = petDir,
                UseShellExecute = false,
            };
            psi.ArgumentList.Add(appDir);
            psi.ArgumentList.Add("--no-sandbox");

            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            var sw = Stopwatch.StartNew();
            proc = Process.Start(psi);
            Log($"electron 已启动 pid={proc?.Id}");
            if (proc != null)
            {
                proc.OutputDataReceived += (_, ev) => { if (ev.Data != null) Log("out: " + ev.Data); };
                proc.ErrorDataReceived += (_, ev) => { if (ev.Data != null) Log("err: " + ev.Data); };
                proc.BeginOutputReadLine();
                proc.BeginErrorReadLine();
            }
            proc?.WaitForExit();
            sw.Stop();
            Log($"electron 退出 code={proc?.ExitCode} 存活 {sw.Elapsed.TotalSeconds:0.0}s");

            // 秒退 = 有问题，别让用户对着空桌面猜
            if (sw.Elapsed.TotalSeconds < 5)
            {
                Fail($"桌宠启动后 {sw.Elapsed.TotalSeconds:0.0} 秒就退出了（退出码 {proc?.ExitCode}）。\n\n" +
                     $"日志：{logFile}\n\n可以把这个日志发给我，我按里面的错误定位。", logFile, showLogTail: true);
            }
        }
        catch (Exception ex)
        {
            Log("启动异常: " + ex);
            Fail($"启动失败：\n\n{ex.Message}\n\n日志：{logFile}", logFile);
        }
    }

    static void Fail(string message, string logFile, bool showLogTail = false)
    {
        Console.Error.WriteLine(message);
        string tail = "";
        if (showLogTail)
        {
            try
            {
                var lines = File.ReadAllLines(logFile);
                tail = string.Join(Environment.NewLine, lines.TakeLast(12));
            }
            catch { }
        }

        string body = string.IsNullOrEmpty(tail)
            ? message
            : message + "\n\n——— 日志尾部 ———\n" + tail;

        MessageBox.Show(body, "小肥鱼桌宠", MessageBoxButtons.OK, MessageBoxIcon.Warning);
    }
}
