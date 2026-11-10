using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace VoiceBridge;

/// <summary>
/// 本地离线 TTS 服务，给 SurfCore 的语音对话用。默认监听 127.0.0.1:8765。
///
/// 接口（对齐 surfcore 的 src/voice-tts.js）：
///   POST /v1/speak/file   {"text":"...","format":"wav","sr":24000,"cache":true,"voice":"..."}
///                         → 200 + WAV 字节，带 x-duration-ms
///   GET  /health          → {"ok":true}
///
/// 合成走 Windows 自带的 SAPI（COM 接口，不用 System.Speech 封装）：
/// 封装层在 .NET 9 里拿不到引擎，直接 COM 调 SAPI.SpVoice 反而稳。
/// 中文音色用 Microsoft Huihui。无窗口运行，日志写 state\voice-bridge.log。
/// </summary>
internal static class Program
{
    const int Port = 8765;
    static string _logPath;
    static string _stateDir;

    [STAThread]
    static void Main()
    {
        string baseDir = AppContext.BaseDirectory;
        _stateDir = Path.Combine(baseDir, "state");
        try { Directory.CreateDirectory(_stateDir); } catch { _stateDir = Path.GetTempPath(); }
        _logPath = Path.Combine(_stateDir, "voice-bridge.log");

        Log($"==== start {DateTime.Now:yyyy-MM-dd HH:mm:ss} 端口 {Port}");
        Log("可用音色: " + string.Join(" | ", ListVoices()));

        bool isNew;
        using var mutex = new Mutex(true, @"Local\DaiXiGuaVoiceBridge", out isNew);
        if (!isNew) { Log("已在运行，退出"); return; }

        var listener = new TcpListener(IPAddress.Loopback, Port);
        try { listener.Start(); }
        catch (Exception ex) { Log("端口被占用，退出：" + ex.Message); return; }
        Log("监听中 http://127.0.0.1:" + Port);

        while (true)
        {
            try
            {
                var client = listener.AcceptTcpClient();   // 由 Handle 释放
                ThreadPool.QueueUserWorkItem(_ => Handle(client));
            }
            catch (Exception ex) { Log("accept 异常: " + ex.Message); }
        }
    }

    // ---------------- HTTP ----------------

    static void Handle(TcpClient client)
    {
        try
        {
            using var stream = client.GetStream();
            stream.ReadTimeout = 20000;

            var head = new StringBuilder();
            var one = new byte[1];
            while (!head.ToString().EndsWith("\r\n\r\n"))
            {
                if (stream.Read(one, 0, 1) <= 0) return;
                head.Append((char)one[0]);
                if (head.Length > 65536) return;
            }
            var lines = head.ToString().Split("\r\n");
            var parts = (lines.Length > 0 ? lines[0] : "").Split(' ');
            if (parts.Length < 2) return;
            string path = parts[1].Split('?')[0];

            int len = 0;
            foreach (var l in lines)
                if (l.StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase))
                    int.TryParse(l.Substring(15).Trim(), out len);

            var body = new byte[len];
            int read = 0;
            while (read < len)
            {
                int n = stream.Read(body, read, len - read);
                if (n <= 0) break;
                read += n;
            }

            if (path.Equals("/health", StringComparison.OrdinalIgnoreCase))
            {
                Respond(stream, 200, "application/json", Encoding.UTF8.GetBytes("{\"ok\":true}"), null);
                return;
            }
            if (!path.Equals("/v1/speak/file", StringComparison.OrdinalIgnoreCase))
            {
                Respond(stream, 404, "application/json", Encoding.UTF8.GetBytes("{\"error\":\"not found\"}"), null);
                return;
            }

            string text = "", voice = "";
            try
            {
                using var doc = JsonDocument.Parse(body);
                if (doc.RootElement.TryGetProperty("text", out var t)) text = t.GetString() ?? "";
                if (doc.RootElement.TryGetProperty("voice", out var v)) voice = v.GetString() ?? "";
            }
            catch
            {
                Respond(stream, 400, "application/json", Encoding.UTF8.GetBytes("{\"error\":\"bad json\"}"), null);
                return;
            }

            text = text.Trim();
            if (text.Length == 0)
            {
                Respond(stream, 400, "application/json", Encoding.UTF8.GetBytes("{\"error\":\"text 为空\"}"), null);
                return;
            }

            byte[] wav = Synthesize(text, voice);
            if (wav == null || wav.Length <= 44)
            {
                Respond(stream, 500, "application/json", Encoding.UTF8.GetBytes("{\"error\":\"合成失败\"}"), null);
                return;
            }
            Respond(stream, 200, "audio/wav", wav, new Dictionary<string, string>
            {
                ["x-duration-ms"] = WavDurationMs(wav).ToString(),
                ["x-cached"] = "0",
            });
            Log($"合成 {text.Length} 字 → {wav.Length / 1024} KB");
        }
        catch (Exception ex) { Log("处理异常: " + ex.Message); }
        finally { try { client.Close(); } catch { } }
    }

    static void Respond(NetworkStream stream, int code, string type, byte[] body, Dictionary<string, string> extra)
    {
        var sb = new StringBuilder();
        sb.Append($"HTTP/1.1 {code} {StatusText(code)}\r\n");
        sb.Append($"Content-Type: {type}\r\nContent-Length: {body.Length}\r\nConnection: close\r\n\r\n");
        var head = Encoding.ASCII.GetBytes(sb.ToString());
        stream.Write(head, 0, head.Length);
        stream.Write(body, 0, body.Length);
        stream.Flush();
    }

    static string StatusText(int c) => c switch { 200 => "OK", 400 => "Bad Request", 404 => "Not Found", 500 => "Internal Server Error", _ => "OK" };

    // ---------------- SAPI（COM）----------------

    /// <summary>列出系统音色，纯诊断用。</summary>
    static List<string> ListVoices()
    {
        var list = new List<string>();
        try
        {
            var t = Type.GetTypeFromProgID("SAPI.SpVoice");
            dynamic v = Activator.CreateInstance(t);
            dynamic vs = v.GetVoices();
            int n = (int)vs.Count;
            for (int i = 0; i < n; i++)
            {
                dynamic one = vs.Item(i);
                list.Add((string)one.GetDescription());
            }
        }
        catch (Exception ex) { list.Add("(枚举失败: " + ex.Message + ")"); }
        return list;
    }

    static byte[] Synthesize(string text, string preferVoice)
    {
        // 用 PowerShell + System.Speech 合成：
        // 在 .NET 进程里直接调 SAPI（无论封装层还是 COM 晚绑定）都拿不到音频输出，
        // 父进程里 AudioOutputStream 接不上会退回默认声卡；pwsh 里这条路是通的。
        string txt = Path.Combine(_stateDir, "tts-" + Guid.NewGuid().ToString("N") + ".txt");
        string wav = Path.Combine(_stateDir, "tts-" + Guid.NewGuid().ToString("N") + ".wav");
        try
        {
            File.WriteAllText(txt, text, new UTF8Encoding(false));
            string ps1 = Path.Combine(AppContext.BaseDirectory, "say.ps1");
            if (!File.Exists(ps1)) { Log("找不到 say.ps1: " + ps1); return null; }

            var psi = new System.Diagnostics.ProcessStartInfo(PwshPath())
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            psi.ArgumentList.Add("-NoProfile");
            psi.ArgumentList.Add("-ExecutionPolicy");
            psi.ArgumentList.Add("Bypass");
            psi.ArgumentList.Add("-File");
            psi.ArgumentList.Add(ps1);
            psi.ArgumentList.Add("-InTextFile");
            psi.ArgumentList.Add(txt);
            psi.ArgumentList.Add("-OutFile");
            psi.ArgumentList.Add(wav);
            if (!string.IsNullOrWhiteSpace(preferVoice))
            {
                psi.ArgumentList.Add("-Voice");
                psi.ArgumentList.Add(preferVoice);
            }

            using var p = System.Diagnostics.Process.Start(psi);
            string err = p.StandardError.ReadToEnd();
            p.WaitForExit(30000);
            if (p.ExitCode != 0) { Log($"say.ps1 退出码 {p.ExitCode}: {err.Trim()}"); return null; }
            if (!File.Exists(wav)) { Log("say.ps1 没产出 wav"); return null; }
            var bytes = File.ReadAllBytes(wav);
            return bytes.Length > 44 ? bytes : null;
        }
        catch (Exception ex) { Log("合成异常: " + ex.Message); return null; }
        finally
        {
            try { if (File.Exists(txt)) File.Delete(txt); } catch { }
            try { if (File.Exists(wav)) File.Delete(wav); } catch { }
        }
    }

    static string PwshPath()
    {
        foreach (var c in new[] {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "PowerShell", "7", "pwsh.exe"),
            "pwsh.exe" })
            if (c == "pwsh.exe" || File.Exists(c)) return c;
        return "pwsh.exe";
    }
    static int WavDurationMs(byte[] wav)
    {
        try
        {
            int byteRate = 0, dataSize = 0, i = 12;
            while (i + 8 <= wav.Length)
            {
                string id = Encoding.ASCII.GetString(wav, i, 4);
                int size = BitConverter.ToInt32(wav, i + 4);
                if (id == "fmt " && size >= 16) byteRate = BitConverter.ToInt32(wav, i + 16);
                else if (id == "data") { dataSize = size; break; }
                i += 8 + size + (size % 2);
            }
            if (byteRate > 0 && dataSize > 0) return (int)(1000L * dataSize / byteRate);
        }
        catch { }
        return 0;
    }

    static void Log(string s)
    {
        try { File.AppendAllText(_logPath, $"[{DateTime.Now:HH:mm:ss}] {s}{Environment.NewLine}"); } catch { }
    }
}
