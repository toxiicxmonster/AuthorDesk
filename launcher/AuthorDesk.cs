// AuthorDesk launcher: serves the built web app on http://localhost:47820 (loopback only) and opens it
// in a dedicated app window (Edge or Chrome). The server stops when that window is closed.
// Compiled with the .NET Framework C# compiler that ships with Windows (see scripts/build.ps1).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("AuthorDesk")]
[assembly: AssemblyProduct("AuthorDesk")]
[assembly: AssemblyDescription("Private writing studio for novelists")]
[assembly: AssemblyVersion("0.1.0.0")]

namespace AuthorDesk
{
    static class Program
    {
        // Fixed port: the browser stores your work per origin, so the address must never change.
        const int Port = 47820;
        static readonly string Origin = "http://localhost:" + Port + "/";
        const string PingPath = "/__authordesk_ping";

        static string root;
        static HttpListener listener;
        static NotifyIcon tray;
        static string dataDir;
        static string syncServer; // optional https URL of an AuthorDesk sync server, from sync-server.txt

        [STAThread]
        static int Main(string[] args)
        {
            dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AuthorDesk");
            Directory.CreateDirectory(dataDir);

            // Already running? Just open another window.
            if (IsServerRunning())
            {
                OpenWindow(false);
                return 0;
            }

            syncServer = ReadSyncServer();
            try { ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12 | (SecurityProtocolType)12288; } catch { ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12; }

            root = FindDist();
            if (root == null)
            {
                MessageBox.Show(
                    "AuthorDesk hasn't been built yet.\n\nRun scripts\\build.ps1 (or 'npm run build' inside the app folder), then start AuthorDesk again.",
                    "AuthorDesk", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return 1;
            }

            try
            {
                listener = new HttpListener();
                listener.Prefixes.Add(Origin);
                listener.Start();
            }
            catch (Exception ex)
            {
                Log("Could not start server: " + ex.Message);
                MessageBox.Show(
                    "AuthorDesk could not start its local server on port " + Port + ".\n\nAnother program may be using that port. Close it and try again.\n\n" + ex.Message,
                    "AuthorDesk", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }

            var serverThread = new Thread(ServeLoop) { IsBackground = true, Name = "AuthorDesk server" };
            serverThread.Start();

            Application.EnableVisualStyles();
            SetupTray();

            Process browser = OpenWindow(true);
            if (browser != null)
            {
                // Quit when the dedicated app window closes.
                var watcher = new Thread(() =>
                {
                    try { browser.WaitForExit(); } catch { }
                    // The first process may hand off to an already-running one; keep serving while any app window remains.
                    Thread.Sleep(1500);
                    while (AppWindowsOpen()) Thread.Sleep(3000);
                    Quit();
                }) { IsBackground = true };
                watcher.Start();
            }

            Application.Run();
            return 0;
        }

        static string FindDist()
        {
            string exeDir = AppDomain.CurrentDomain.BaseDirectory;
            string[] candidates =
            {
                Path.Combine(exeDir, "app", "dist"),
                Path.Combine(exeDir, "dist"),
                Path.Combine(exeDir, "..", "app", "dist"),
            };
            foreach (var c in candidates)
            {
                if (File.Exists(Path.Combine(c, "index.html"))) return Path.GetFullPath(c);
            }
            return null;
        }

        static bool IsServerRunning()
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create("http://localhost:" + Port + PingPath);
                req.Timeout = 800;
                using (var res = (HttpWebResponse)req.GetResponse())
                using (var sr = new StreamReader(res.GetResponseStream()))
                {
                    return sr.ReadToEnd().Trim() == "authordesk";
                }
            }
            catch { return false; }
        }

        static string FindBrowser()
        {
            string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string[] candidates =
            {
                Path.Combine(pf86, @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(pf, @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(pf, @"Google\Chrome\Application\chrome.exe"),
                Path.Combine(pf86, @"Google\Chrome\Application\chrome.exe"),
                Path.Combine(local, @"Google\Chrome\Application\chrome.exe"),
            };
            foreach (var c in candidates) if (File.Exists(c)) return c;
            return null;
        }

        static string ProfileDir
        {
            get { return Path.Combine(dataDir, "BrowserProfile"); }
        }

        /// Opens the app in a dedicated window. All writing data lives in this private browser profile.
        static Process OpenWindow(bool track)
        {
            string browser = FindBrowser();
            if (browser == null)
            {
                Process.Start(Origin);
                return null;
            }
            var psi = new ProcessStartInfo(browser,
                "--app=" + Origin +
                " --user-data-dir=\"" + ProfileDir + "\"" +
                " --no-first-run --no-default-browser-check --disable-sync --window-size=1400,900")
            {
                UseShellExecute = false,
            };
            try
            {
                var p = Process.Start(psi);
                return track ? p : null;
            }
            catch (Exception ex)
            {
                Log("Could not open browser: " + ex.Message);
                Process.Start(Origin);
                return null;
            }
        }

        static bool AppWindowsOpen()
        {
            // Any browser process still using our private profile means an AuthorDesk window is open.
            try
            {
                string name = Path.GetFileNameWithoutExtension(FindBrowser() ?? "msedge");
                foreach (var p in Process.GetProcessesByName(name))
                {
                    try
                    {
                        if (!string.IsNullOrEmpty(p.MainWindowTitle) && p.MainWindowTitle.Contains("AuthorDesk")) return true;
                    }
                    catch { }
                }
            }
            catch { }
            return false;
        }

        static void SetupTray()
        {
            tray = new NotifyIcon();
            try { tray.Icon = Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location); }
            catch { tray.Icon = SystemIcons.Application; }
            tray.Text = "AuthorDesk (running)";
            var menu = new ContextMenuStrip();
            menu.Items.Add("Open AuthorDesk", null, (s, e) => OpenWindow(false));
            menu.Items.Add("Open data folder", null, (s, e) => Process.Start("explorer.exe", "\"" + dataDir + "\""));
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Quit AuthorDesk", null, (s, e) => Quit());
            tray.ContextMenuStrip = menu;
            tray.DoubleClick += (s, e) => OpenWindow(false);
            tray.Visible = true;
        }

        static void Quit()
        {
            try { if (tray != null) { tray.Visible = false; tray.Dispose(); } } catch { }
            try { if (listener != null) listener.Stop(); } catch { }
            Application.Exit();
            Environment.Exit(0);
        }

        static void ServeLoop()
        {
            while (listener != null && listener.IsListening)
            {
                HttpListenerContext ctx;
                try { ctx = listener.GetContext(); }
                catch { break; }
                ThreadPool.QueueUserWorkItem(_ => Handle(ctx));
            }
        }

        static readonly Dictionary<string, string> Mime = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            { ".html", "text/html; charset=utf-8" },
            { ".js", "text/javascript; charset=utf-8" },
            { ".mjs", "text/javascript; charset=utf-8" },
            { ".css", "text/css; charset=utf-8" },
            { ".json", "application/json" },
            { ".webmanifest", "application/manifest+json" },
            { ".svg", "image/svg+xml" },
            { ".png", "image/png" },
            { ".ico", "image/x-icon" },
            { ".jpg", "image/jpeg" },
            { ".woff2", "font/woff2" },
            { ".txt", "text/plain; charset=utf-8" },
            { ".aff", "text/plain; charset=utf-8" },
            { ".dic", "text/plain; charset=utf-8" },
        };

        static void Handle(HttpListenerContext ctx)
        {
            var res = ctx.Response;
            try
            {
                // Only ever answer this computer.
                if (!IPAddress.IsLoopback(ctx.Request.RemoteEndPoint.Address))
                {
                    res.StatusCode = 403;
                    return;
                }
                string path = Uri.UnescapeDataString(ctx.Request.Url.AbsolutePath);
                res.Headers["X-Content-Type-Options"] = "nosniff";
                res.Headers["Referrer-Policy"] = "no-referrer";
                if (path == PingPath)
                {
                    Write(res, "authordesk", "text/plain");
                    return;
                }
                if (path.StartsWith("/api/"))
                {
                    if (syncServer == null)
                    {
                        res.StatusCode = 404;
                        Write(res, "{\"error\":\"No sync server configured\"}", "application/json");
                    }
                    else Proxy(ctx);
                    return;
                }
                if (ctx.Request.HttpMethod != "GET" && ctx.Request.HttpMethod != "HEAD")
                {
                    res.StatusCode = 405;
                    return;
                }
                if (path == "/" || path == "") path = "/index.html";
                string full = Path.GetFullPath(Path.Combine(root, path.TrimStart('/').Replace('/', Path.DirectorySeparatorChar)));
                if (!full.StartsWith(root, StringComparison.OrdinalIgnoreCase) || !File.Exists(full))
                {
                    // Unknown paths fall back to the app shell (routing is hash-based).
                    full = Path.Combine(root, "index.html");
                }
                string ext = Path.GetExtension(full);
                string type;
                if (!Mime.TryGetValue(ext, out type)) type = "application/octet-stream";
                bool immutable = full.Contains(Path.DirectorySeparatorChar + "assets" + Path.DirectorySeparatorChar);
                res.Headers["Cache-Control"] = immutable ? "public, max-age=31536000, immutable" : "no-cache";
                res.ContentType = type;
                byte[] bytes = File.ReadAllBytes(full);
                res.ContentLength64 = bytes.Length;
                if (ctx.Request.HttpMethod == "GET") res.OutputStream.Write(bytes, 0, bytes.Length);
            }
            catch (Exception ex)
            {
                Log("Request failed: " + ex.GetType().Name);
                try { res.StatusCode = 500; } catch { }
            }
            finally
            {
                try { res.Close(); } catch { }
            }
        }

        static string ReadSyncServer()
        {
            string[] files = { Path.Combine(dataDir, "sync-server.txt"), Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "sync-server.txt") };
            foreach (var f in files)
            {
                if (!File.Exists(f)) continue;
                foreach (var raw in File.ReadAllLines(f))
                {
                    string line = raw.Trim();
                    if (line.Length == 0 || line.StartsWith("#")) continue;
                    Uri u;
                    if (!Uri.TryCreate(line, UriKind.Absolute, out u)) { Log("sync-server.txt: not a URL"); return null; }
                    bool local = u.IsLoopback;
                    if (u.Scheme != "https" && !(u.Scheme == "http" && local))
                    {
                        Log("sync-server.txt: refusing non-HTTPS sync server");
                        return null;
                    }
                    return u.GetLeftPart(UriPartial.Authority);
                }
            }
            return null;
        }

        /// Forwards /api/* to the configured sync server so the app stays same-origin and the session cookie stays HttpOnly.
        static void Proxy(HttpListenerContext ctx)
        {
            var inReq = ctx.Request;
            var res = ctx.Response;
            var req = (HttpWebRequest)WebRequest.Create(syncServer + inReq.Url.PathAndQuery);
            req.Method = inReq.HttpMethod;
            req.AllowAutoRedirect = false;
            req.Timeout = 120000;
            req.ReadWriteTimeout = 120000;
            if (inReq.Headers["X-AuthorDesk"] != null) req.Headers["X-AuthorDesk"] = inReq.Headers["X-AuthorDesk"];
            if (inReq.Headers["Cookie"] != null) req.Headers[HttpRequestHeader.Cookie] = inReq.Headers["Cookie"];
            req.Headers["X-Forwarded-Proto"] = "https";
            if (inReq.HasEntityBody)
            {
                req.ContentType = inReq.ContentType;
                using (var outStream = req.GetRequestStream()) inReq.InputStream.CopyTo(outStream);
            }
            HttpWebResponse upstream;
            try { upstream = (HttpWebResponse)req.GetResponse(); }
            catch (WebException wex)
            {
                upstream = wex.Response as HttpWebResponse;
                if (upstream == null)
                {
                    res.StatusCode = 502;
                    Write(res, "{\"error\":\"Could not reach the sync server.\"}", "application/json");
                    return;
                }
            }
            using (upstream)
            {
                res.StatusCode = (int)upstream.StatusCode;
                res.ContentType = upstream.ContentType;
                res.Headers["Cache-Control"] = "no-store";
                var cookies = upstream.Headers.GetValues("Set-Cookie");
                if (cookies != null)
                {
                    foreach (var c in cookies)
                    {
                        // Drop any Domain attribute so the cookie belongs to this local origin.
                        var parts = new List<string>();
                        foreach (var p in c.Split(';')) if (!p.Trim().StartsWith("Domain=", StringComparison.OrdinalIgnoreCase)) parts.Add(p.Trim());
                        res.Headers.Add("Set-Cookie", string.Join("; ", parts));
                    }
                }
                using (var body = upstream.GetResponseStream()) body.CopyTo(res.OutputStream);
            }
        }

        static void Write(HttpListenerResponse res, string text, string type)
        {
            byte[] b = Encoding.UTF8.GetBytes(text);
            res.ContentType = type;
            res.ContentLength64 = b.Length;
            res.OutputStream.Write(b, 0, b.Length);
        }

        static void Log(string msg)
        {
            try
            {
                File.AppendAllText(Path.Combine(dataDir, "launcher.log"), DateTime.Now.ToString("s") + " " + msg + Environment.NewLine);
            }
            catch { }
        }
    }
}
