// AuthorDesk launcher: serves the built web app on http://localhost:47820 (loopback only) and opens it
// in a dedicated app window (Edge or Chrome). The server stops when that window is closed.
// Compiled with the .NET Framework C# compiler that ships with Windows (see scripts/build.ps1).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: AssemblyTitle("AuthorDesk")]
[assembly: AssemblyProduct("AuthorDesk")]
[assembly: AssemblyDescription("Private writing studio for novelists")]
[assembly: AssemblyVersion("0.3.0.0")]

namespace AuthorDesk
{
    static class Program
    {
        // Release version; bump with each GitHub release (tag "v" + Version). scripts\package-release.ps1 reads it.
        const string Version = "0.3";
        const string UpdateRepo = "toxiicxmonster/AuthorDesk";

        // Fixed port: the browser stores your work per origin, so the address must never change.
        const int Port = 47820;
        static readonly string Origin = "http://localhost:" + Port + "/";
        const string PingPath = "/__authordesk_ping";

        static string root;
        static HttpListener listener;
        static NotifyIcon tray;
        static string dataDir;
        static string syncServer; // optional https URL of an AuthorDesk sync server, from sync-server.txt

        // Optional private grammar engine (LanguageTool), installed by scripts\install-grammar-engine.ps1.
        // It listens on loopback only; the app reaches it through /grammar/* on this server (same origin).
        const int GrammarPort = 47821;
        static string grammarDir;
        static Process grammar;

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

            Application.EnableVisualStyles();
            if (TryAutoUpdate()) return 0; // the updated AuthorDesk has been started in our place

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

            StartGrammarEngine();

            var serverThread = new Thread(ServeLoop) { IsBackground = true, Name = "AuthorDesk server" };
            serverThread.Start();

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
            try { if (grammar != null && !grammar.HasExited) grammar.Kill(); } catch { }
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
                if (path == "/grammar/status")
                {
                    Write(res, GrammarStatusJson(), "application/json");
                    return;
                }
                if (path == "/grammar/v2/check")
                {
                    ProxyGrammar(ctx);
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

        // ---------- Auto-update (release installs only) ----------

        /// On launch, a release install (AuthorDesk.exe next to dist\) updates itself to the latest GitHub release.
        /// A source checkout (app\ or .git next to the exe) never does; neither does one with no-auto-update.txt.
        /// Books are not in this folder (they live in the browser profile under %LOCALAPPDATA%), so they are untouched.
        static bool TryAutoUpdate()
        {
            string exeDir = AppDomain.CurrentDomain.BaseDirectory;
            CleanupOldUpdate(exeDir);
            if (!File.Exists(Path.Combine(exeDir, "dist", "index.html"))) return false;
            if (Directory.Exists(Path.Combine(exeDir, "app")) || Directory.Exists(Path.Combine(exeDir, ".git"))) return false;
            if (File.Exists(Path.Combine(exeDir, "no-auto-update.txt")) || File.Exists(Path.Combine(dataDir, "no-auto-update.txt"))) return false;

            string tag, assetUrl;
            if (!LatestRelease(out tag, out assetUrl)) return false;
            if (CompareVersions(tag.TrimStart('v', 'V'), Version) <= 0) return false;

            Form splash = Splash("Updating AuthorDesk to " + tag + "...");
            string work = Path.Combine(exeDir, ".update"); // same drive as the install, so folders can be moved in
            try
            {
                if (Directory.Exists(work)) Directory.Delete(work, true);
                Directory.CreateDirectory(work);
                string zip = Path.Combine(work, "release.zip");
                using (var wc = new WebClient())
                {
                    wc.Headers[HttpRequestHeader.UserAgent] = "AuthorDesk-updater";
                    wc.DownloadFile(assetUrl, zip);
                }
                string unpacked = Path.Combine(work, "files");
                ZipFile.ExtractToDirectory(zip, unpacked);
                string root = unpacked;
                if (!File.Exists(Path.Combine(root, "AuthorDesk.exe")))
                {
                    var dirs = Directory.GetDirectories(unpacked);
                    if (dirs.Length == 1) root = dirs[0];
                }
                if (!File.Exists(Path.Combine(root, "AuthorDesk.exe")) || !File.Exists(Path.Combine(root, "dist", "index.html")))
                    throw new InvalidDataException("the release package is incomplete");
                InstallUpdate(root, exeDir);
                Log("Updated from " + Version + " to " + tag);
            }
            catch (Exception ex)
            {
                Log("Update to " + tag + " failed: " + ex.Message);
                CloseSplash(splash);
                return false; // carry on with the installed version
            }
            finally
            {
                try { if (Directory.Exists(work)) Directory.Delete(work, true); } catch { }
            }
            CloseSplash(splash);
            try
            {
                Process.Start(new ProcessStartInfo(Path.Combine(exeDir, "AuthorDesk.exe")) { UseShellExecute = false, WorkingDirectory = exeDir });
                return true;
            }
            catch (Exception ex)
            {
                Log("Could not start the updated AuthorDesk: " + ex.Message);
                return false;
            }
        }

        /// Asks GitHub for the latest release and its Windows zip. Quietly gives up when offline or rate-limited.
        static bool LatestRelease(out string tag, out string assetUrl)
        {
            tag = null;
            assetUrl = null;
            try
            {
                var req = (HttpWebRequest)WebRequest.Create("https://api.github.com/repos/" + UpdateRepo + "/releases/latest");
                req.UserAgent = "AuthorDesk-updater";
                req.Accept = "application/vnd.github+json";
                req.Timeout = 5000;
                req.ReadWriteTimeout = 5000;
                string json;
                using (var res = (HttpWebResponse)req.GetResponse())
                using (var sr = new StreamReader(res.GetResponseStream())) json = sr.ReadToEnd();
                var release = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(json);
                tag = release["tag_name"] as string;
                var assets = release["assets"] as System.Collections.ArrayList;
                if (tag == null || assets == null) return false;
                foreach (Dictionary<string, object> a in assets)
                {
                    string name = a["name"] as string;
                    if (name != null && name.EndsWith("-windows.zip", StringComparison.OrdinalIgnoreCase))
                    {
                        assetUrl = a["browser_download_url"] as string;
                        break;
                    }
                }
                return assetUrl != null && assetUrl.StartsWith("https://github.com/" + UpdateRepo + "/releases/download/", StringComparison.OrdinalIgnoreCase);
            }
            catch (Exception ex)
            {
                Log("Update check skipped: " + ex.Message);
                return false;
            }
        }

        /// Compares dotted versions numerically ("0.10" > "0.9"; "0.2" == "0.2.0").
        static int CompareVersions(string a, string b)
        {
            string[] x = a.Split('.'), y = b.Split('.');
            for (int i = 0; i < Math.Max(x.Length, y.Length); i++)
            {
                int p, q;
                int.TryParse(i < x.Length ? x[i] : "0", out p);
                int.TryParse(i < y.Length ? y[i] : "0", out q);
                if (p != q) return p.CompareTo(q);
            }
            return 0;
        }

        /// Moves the new files in, keeping each replaced item as *.old; on any failure everything is put back.
        /// The running exe can't be overwritten but can be renamed, which is what makes this possible.
        static void InstallUpdate(string from, string to)
        {
            var done = new List<KeyValuePair<string, string>>(); // installed path -> its backup (null if it was new)
            try
            {
                foreach (string src in Directory.GetFileSystemEntries(from))
                {
                    string name = Path.GetFileName(src);
                    if (name.Equals("sync-server.txt", StringComparison.OrdinalIgnoreCase)) continue; // the author's own settings
                    string dest = Path.Combine(to, name);
                    string backup = null;
                    if (File.Exists(dest) || Directory.Exists(dest))
                    {
                        backup = dest + ".old";
                        DeletePath(backup);
                        if (Directory.Exists(dest)) Directory.Move(dest, backup); else File.Move(dest, backup);
                    }
                    done.Add(new KeyValuePair<string, string>(dest, backup));
                    if (Directory.Exists(src)) Directory.Move(src, dest); else File.Move(src, dest);
                }
            }
            catch
            {
                for (int i = done.Count - 1; i >= 0; i--)
                {
                    try
                    {
                        DeletePath(done[i].Key);
                        if (done[i].Value != null)
                        {
                            if (Directory.Exists(done[i].Value)) Directory.Move(done[i].Value, done[i].Key);
                            else if (File.Exists(done[i].Value)) File.Move(done[i].Value, done[i].Key);
                        }
                    }
                    catch { }
                }
                throw;
            }
        }

        /// Removes backups left by the last update (the old exe may still be closing; then it goes next time).
        static void CleanupOldUpdate(string dir)
        {
            try
            {
                foreach (string old in Directory.GetFileSystemEntries(dir, "*.old"))
                {
                    try { DeletePath(old); } catch { }
                }
            }
            catch { }
        }

        static void DeletePath(string path)
        {
            if (Directory.Exists(path)) Directory.Delete(path, true);
            else if (File.Exists(path)) File.Delete(path);
        }

        static Form Splash(string text)
        {
            try
            {
                var f = new Form
                {
                    Text = "AuthorDesk",
                    FormBorderStyle = FormBorderStyle.FixedDialog,
                    StartPosition = FormStartPosition.CenterScreen,
                    ClientSize = new Size(360, 90),
                    ControlBox = false,
                    ShowInTaskbar = true,
                    TopMost = true,
                };
                try { f.Icon = Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location); } catch { }
                f.Controls.Add(new Label { Text = text, AutoSize = false, Bounds = new Rectangle(16, 14, 328, 24) });
                f.Controls.Add(new ProgressBar { Style = ProgressBarStyle.Marquee, Bounds = new Rectangle(16, 46, 328, 18) });
                f.Show();
                f.Refresh();
                return f;
            }
            catch { return null; }
        }

        static void CloseSplash(Form f)
        {
            try { if (f != null) { f.Close(); f.Dispose(); } } catch { }
        }

        // ---------- Private grammar engine ----------

        static string GrammarJava { get { return Path.Combine(grammarDir, "jre", "bin", "javaw.exe"); } }
        static string GrammarJar { get { return Path.Combine(grammarDir, "languagetool", "languagetool-server.jar"); } }
        static bool GrammarInstalled { get { return File.Exists(GrammarJava) && File.Exists(GrammarJar); } }

        static void StartGrammarEngine()
        {
            grammarDir = Path.Combine(dataDir, "grammar-engine");
            if (!GrammarInstalled || GrammarReady()) return; // not installed, or one is already serving
            try
            {
                string props = Path.Combine(grammarDir, "server.properties");
                var psi = new ProcessStartInfo(GrammarJava,
                    "-Xms256m -Xmx2g -cp \"" + GrammarJar + "\" org.languagetool.server.HTTPServer --port " + GrammarPort +
                    (File.Exists(props) ? " --config \"" + props + "\"" : ""))
                {
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WorkingDirectory = Path.GetDirectoryName(GrammarJar),
                };
                grammar = Process.Start(psi);
                KillWithLauncher(grammar);
                Log("Grammar engine started");
            }
            catch (Exception ex)
            {
                Log("Could not start grammar engine: " + ex.Message);
            }
        }

        static bool GrammarReady()
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + GrammarPort + "/v2/languages");
                req.Timeout = 1000;
                using (var r = (HttpWebResponse)req.GetResponse()) return r.StatusCode == HttpStatusCode.OK;
            }
            catch { return false; }
        }

        static string GrammarStatusJson()
        {
            bool installed = grammarDir != null && GrammarInstalled;
            bool ngrams = installed && Directory.Exists(Path.Combine(grammarDir, "ngrams", "en"));
            bool ready = installed && GrammarReady();
            bool starting = installed && !ready && grammar != null && !grammar.HasExited;
            return "{\"installed\":" + (installed ? "true" : "false") + ",\"ngrams\":" + (ngrams ? "true" : "false") +
                ",\"ready\":" + (ready ? "true" : "false") + ",\"starting\":" + (starting ? "true" : "false") + "}";
        }

        static void ProxyGrammar(HttpListenerContext ctx)
        {
            var inReq = ctx.Request;
            var res = ctx.Response;
            res.Headers["Cache-Control"] = "no-store";
            if (inReq.HttpMethod != "POST") { res.StatusCode = 405; return; }
            var req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + GrammarPort + "/v2/check");
            req.Method = "POST";
            req.ContentType = inReq.ContentType;
            req.Accept = "application/json";
            req.Timeout = 90000;
            req.ReadWriteTimeout = 90000;
            HttpWebResponse upstream;
            try
            {
                using (var outStream = req.GetRequestStream()) inReq.InputStream.CopyTo(outStream);
                upstream = (HttpWebResponse)req.GetResponse();
            }
            catch (WebException wex)
            {
                upstream = wex.Response as HttpWebResponse;
                if (upstream == null)
                {
                    res.StatusCode = 503;
                    Write(res, "{\"error\":\"The grammar engine is not running yet.\"}", "application/json");
                    return;
                }
            }
            using (upstream)
            {
                res.StatusCode = (int)upstream.StatusCode;
                res.ContentType = upstream.ContentType;
                using (var body = upstream.GetResponseStream()) body.CopyTo(res.OutputStream);
            }
        }

        // A job object closes with the launcher, taking the engine with it even if the launcher crashes.
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        static extern IntPtr CreateJobObject(IntPtr attrs, string name);
        [DllImport("kernel32.dll")]
        static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref JobExtendedLimits info, uint length);
        [DllImport("kernel32.dll")]
        static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

        [StructLayout(LayoutKind.Sequential)]
        struct JobBasicLimits
        {
            public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass, SchedulingClass;
        }
        [StructLayout(LayoutKind.Sequential)]
        struct IoCounters { public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }
        [StructLayout(LayoutKind.Sequential)]
        struct JobExtendedLimits
        {
            public JobBasicLimits Basic;
            public IoCounters Io;
            public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
        }

        static IntPtr job = IntPtr.Zero;

        static void KillWithLauncher(Process p)
        {
            try
            {
                if (job == IntPtr.Zero)
                {
                    job = CreateJobObject(IntPtr.Zero, null);
                    var info = new JobExtendedLimits();
                    info.Basic.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
                    SetInformationJobObject(job, 9, ref info, (uint)Marshal.SizeOf(typeof(JobExtendedLimits)));
                }
                AssignProcessToJobObject(job, p.Handle);
            }
            catch (Exception ex) { Log("Job object: " + ex.Message); }
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
