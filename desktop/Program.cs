using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Huaihai1948
{
    internal static class Program
    {
        internal const string AppName = "淮海战役 1948";
        internal const string AppVersion = "1.0.0";
        internal static string WebDir;
        internal static string UserDataDir;
        private static Mutex _mutex;

        internal static void Log(string msg)
        {
            string line = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + "  " + msg + "\r\n";
            string[] dirs = new string[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Huaihai1948"),
                Path.Combine(Path.GetTempPath(), "Huaihai1948"),
                AppDomain.CurrentDomain.BaseDirectory
            };
            foreach (string dir in dirs)
            {
                try
                {
                    Directory.CreateDirectory(dir);
                    File.AppendAllText(Path.Combine(dir, "app.log"), line);
                    return;
                }
                catch { }
            }
        }

        private static bool TryPrepareDir(string dir)
        {
            try
            {
                Directory.CreateDirectory(dir);
                string probe = Path.Combine(dir, ".write_test");
                File.WriteAllText(probe, "ok");
                File.Delete(probe);
                return true;
            }
            catch { return false; }
        }

        [STAThread]
        private static void Main()
        {
            Log("=== app start v" + AppVersion + " ===");
            AppDomain.CurrentDomain.UnhandledException += delegate(object s, UnhandledExceptionEventArgs e)
            {
                Log("UNHANDLED " + e.ExceptionObject);
            };
            Application.ThreadException += delegate(object s, System.Threading.ThreadExceptionEventArgs e)
            {
                Log("THREAD " + e.Exception);
            };
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);

            bool createdNew;
            _mutex = new Mutex(true, "Huaihai1948_SingleInstance", out createdNew);
            if (!createdNew)
            {
                Log("another instance is running");
                BringExistingToFront();
                return;
            }

            try
            {
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);

                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                Log("baseDir=" + baseDir);
                WebDir = Path.Combine(baseDir, "web");
                if (!Directory.Exists(WebDir))
                {
                    string alt = Path.Combine(baseDir, "..", "web");
                    if (Directory.Exists(alt)) WebDir = Path.GetFullPath(alt);
                }
                Log("webDir=" + WebDir);
                if (!File.Exists(Path.Combine(WebDir, "index.html")))
                {
                    Log("missing web\\index.html");
                    MessageBox.Show(
                        "游戏文件不完整：缺少 web\\index.html。\n\n" +
                        "请将压缩包完整解压到本地文件夹后，再双击 淮海战役1948.exe。\n" +
                        "不要在压缩包预览窗口中直接运行。",
                        AppName, MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return;
                }

                UserDataDir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "Huaihai1948", "WebView2");
                if (!TryPrepareDir(UserDataDir))
                {
                    UserDataDir = Path.Combine(Path.GetTempPath(), "Huaihai1948", "WebView2");
                    if (!TryPrepareDir(UserDataDir))
                    {
                        UserDataDir = Path.Combine(baseDir, "WebView2Data");
                        if (!TryPrepareDir(UserDataDir))
                        {
                            Log("no writable user data folder");
                            MessageBox.Show("无法创建可写的用户数据目录。\n请将游戏放到有写入权限的文件夹后重试。",
                                AppName, MessageBoxButtons.OK, MessageBoxIcon.Error);
                            return;
                        }
                    }
                }
                Log("userData=" + UserDataDir);

                Application.Run(new MainForm());
                Log("application.run returned");
            }
            catch (Exception ex)
            {
                Log("FATAL " + ex);
                MessageBox.Show("程序启动失败：\n\n" + ex.ToString(), AppName,
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            finally
            {
                if (_mutex != null)
                {
                    try { _mutex.ReleaseMutex(); } catch { }
                    _mutex.Dispose();
                }
            }
        }

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        private static void BringExistingToFront()
        {
            IntPtr h = FindWindow(null, AppName);
            if (h != IntPtr.Zero)
            {
                ShowWindow(h, 9);
                SetForegroundWindow(h);
            }
        }

        internal static string FindEdge()
        {
            string[] candidates = new string[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Microsoft\Edge\Application\msedge.exe")
            };
            foreach (string p in candidates)
            {
                if (File.Exists(p)) return p;
            }
            try
            {
                using (RegistryKey k = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe"))
                {
                    if (k != null)
                    {
                        string v = k.GetValue(null) as string;
                        if (!string.IsNullOrEmpty(v) && File.Exists(v)) return v;
                    }
                }
            }
            catch { }
            return null;
        }
    }

    internal sealed class MainForm : Form
    {
        private readonly WebView2 _webView;
        private readonly Panel _splash;
        private bool _fullscreen;
        private FormBorderStyle _oldBorder;
        private FormWindowState _oldState;
        private Rectangle _oldBounds;
        private bool _webReady;
        private bool _fileFallbackTried;
        private bool _allowClose;
        private bool _closingSave;

        public MainForm()
        {
            Program.Log("MainForm ctor");
            Text = Program.AppName;
            AutoScaleMode = AutoScaleMode.None;
            BackColor = Color.FromArgb(10, 12, 9);
            StartPosition = FormStartPosition.CenterScreen;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); }
            catch { }

            float dpiScale = 1f;
            try
            {
                using (Graphics g = Graphics.FromHwnd(IntPtr.Zero))
                {
                    dpiScale = g.DpiX / 96f;
                }
            }
            catch { }
            if (dpiScale < 1f) dpiScale = 1f;
            if (dpiScale > 2.5f) dpiScale = 2.5f;

            Rectangle wa = Screen.PrimaryScreen.WorkingArea;
            int targetW = (int)(1600 * dpiScale);
            int targetH = (int)(900 * dpiScale);
            int w = Math.Min(targetW, wa.Width - 40);
            int h = Math.Min(targetH, wa.Height - 60);
            if (w < 1000) w = Math.Min(wa.Width, 1000);
            if (h < 620) h = Math.Min(wa.Height, 620);
            Size = new Size(w, h);
            MinimumSize = new Size((int)(1000 * dpiScale), (int)(620 * dpiScale));
            KeyPreview = true;

            _webView = new WebView2();
            _webView.Dock = DockStyle.Fill;
            _webView.DefaultBackgroundColor = Color.FromArgb(10, 12, 9);
            Controls.Add(_webView);

            _splash = new Panel();
            _splash.Dock = DockStyle.Fill;
            _splash.BackColor = Color.FromArgb(10, 12, 9);
            _splash.Paint += SplashPaint;
            Controls.Add(_splash);
            _splash.BringToFront();

            Shown += OnShown;
            KeyDown += OnKeyDown;
            FormClosing += OnFormClosing;
        }

        private async void OnFormClosing(object sender, FormClosingEventArgs e)
        {
            if (_allowClose) return;
            if (!_webReady || _webView == null || _webView.CoreWebView2 == null)
            {
                _allowClose = true;
                return;
            }
            e.Cancel = true;
            if (_closingSave) return;
            _closingSave = true;
            Program.Log("closing: requesting save");
            try
            {
                Task<string> task = _webView.ExecuteScriptAsync(
                    "(window.HX && HX.Save && HX.Save.autoSaveForExit) ? String(HX.Save.autoSaveForExit()) : 'no-save'");
                await Task.WhenAny(task, Task.Delay(2500));
                Program.Log("closing: save step finished");
            }
            catch (Exception ex)
            {
                Program.Log("closing: save failed " + ex.Message);
            }
            _allowClose = true;
            try { Close(); } catch { }
        }

        private async void OnShown(object sender, EventArgs e)
        {
            Program.Log("OnShown");
            try
            {
                await InitWebViewAsync();
            }
            catch (Exception ex)
            {
                Program.Log("Init exception " + ex);
                HandleInitError(ex);
            }
        }

        private async Task InitWebViewAsync()
        {
            Program.Log("creating WebView2 environment");
            CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, Program.UserDataDir, null);
            Program.Log("environment ok");
            await _webView.EnsureCoreWebView2Async(env);
            Program.Log("corewebview2 ready");
            CoreWebView2 core = _webView.CoreWebView2;
            CoreWebView2Settings st = core.Settings;
            st.AreDefaultContextMenusEnabled = false;
            st.AreDevToolsEnabled = false;
            st.IsStatusBarEnabled = false;
            st.IsZoomControlEnabled = false;
            st.AreBrowserAcceleratorKeysEnabled = false;
            st.IsPasswordAutosaveEnabled = false;
            st.IsGeneralAutofillEnabled = false;

            core.SetVirtualHostNameToFolderMapping(
                "huaihai.local", Program.WebDir, CoreWebView2HostResourceAccessKind.DenyCors);
            core.NavigationCompleted += OnNavigationCompleted;
            core.WebMessageReceived += OnWebMessageReceived;
            core.NewWindowRequested += OnNewWindowRequested;
            core.Navigate("https://huaihai.local/index.html");
            Program.Log("navigate requested");
        }

        private void OnNavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            Program.Log("navigation completed success=" + e.IsSuccess + " error=" + e.WebErrorStatus);
            if (!e.IsSuccess)
            {
                if (!_fileFallbackTried)
                {
                    _fileFallbackTried = true;
                    Program.Log("virtual host navigation failed, trying file://");
                    try
                    {
                        string fileUri = new Uri(Path.Combine(Program.WebDir, "index.html")).AbsoluteUri;
                        _webView.CoreWebView2.Navigate(fileUri);
                        return;
                    }
                    catch (Exception ex2)
                    {
                        Program.Log("file:// retry failed " + ex2.Message);
                    }
                }
                HandleInitError(new Exception("Navigation failed: " + e.WebErrorStatus));
                return;
            }
            _webReady = true;
            _splash.Visible = false;
            _splash.Dispose();
            _webView.Focus();
        }

        private void OnWebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            string msg = null;
            try { msg = e.TryGetWebMessageAsString(); }
            catch { }
            if (msg == "toggle-fullscreen") ToggleFullscreen();
            else if (msg == "exit-fullscreen" && _fullscreen) ExitFullscreen();
            else if (msg == "quit-game") Close();
        }

        private void OnNewWindowRequested(object sender, CoreWebView2NewWindowRequestedEventArgs e)
        {
            e.Handled = true;
        }

        private void OnKeyDown(object sender, KeyEventArgs e)
        {
            if (e.KeyCode == Keys.F11 && _webReady)
            {
                ToggleFullscreen();
                e.Handled = true;
            }
            else if (e.KeyCode == Keys.Escape && _fullscreen)
            {
                ExitFullscreen();
            }
        }

        private void ToggleFullscreen()
        {
            if (!_fullscreen)
            {
                _oldBorder = FormBorderStyle;
                _oldState = WindowState;
                _oldBounds = Bounds;
                FormBorderStyle = FormBorderStyle.None;
                WindowState = FormWindowState.Maximized;
                _fullscreen = true;
            }
            else
            {
                FormBorderStyle = _oldBorder;
                WindowState = FormWindowState.Normal;
                Bounds = _oldBounds;
                _fullscreen = false;
            }
            _webView.Focus();
        }

        private void ExitFullscreen()
        {
            if (_fullscreen) ToggleFullscreen();
        }

        private void SplashPaint(object sender, PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.Clear(Color.FromArgb(10, 12, 9));
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;

            int cx = _splash.Width / 2;
            int cy = (int)(_splash.Height * 0.32);
            float outer = Math.Min(_splash.Width, _splash.Height) * 0.09f;
            PointF[] pts = new PointF[10];
            for (int i = 0; i < 10; i++)
            {
                float r = (i % 2 == 0) ? outer : outer * 0.41f;
                double a = -Math.PI / 2 + i * Math.PI / 5;
                pts[i] = new PointF(cx + (float)(Math.Cos(a) * r), cy + (float)(Math.Sin(a) * r));
            }
            using (GraphicsPath path = new GraphicsPath())
            {
                path.AddPolygon(pts);
                using (SolidBrush fill = new SolidBrush(Color.FromArgb(176, 54, 42)))
                using (Pen edge = new Pen(Color.FromArgb(216, 186, 126), 2f))
                {
                    g.FillPath(fill, path);
                    g.DrawPath(edge, path);
                }
            }

            using (StringFormat sf = new StringFormat())
            {
                sf.Alignment = StringAlignment.Center;
                sf.LineAlignment = StringAlignment.Center;
                using (Font f1 = new Font("Microsoft YaHei UI", 22f, FontStyle.Bold, GraphicsUnit.Point))
                using (Font f2 = new Font("Microsoft YaHei UI", 10f, FontStyle.Regular, GraphicsUnit.Point))
                using (SolidBrush cream = new SolidBrush(Color.FromArgb(236, 223, 190)))
                using (SolidBrush dim = new SolidBrush(Color.FromArgb(150, 143, 121)))
                {
                    g.DrawString("淮海战役", f1, cream,
                        new RectangleF(0, _splash.Height * 0.43f, _splash.Width, 54), sf);
                    g.DrawString("1 9 4 8   ·   徐 州 — 蚌 埠", f2, dim,
                        new RectangleF(0, _splash.Height * 0.43f + 58, _splash.Width, 26), sf);
                    g.DrawString("正在展开战场…", f2, dim,
                        new RectangleF(0, _splash.Height * 0.43f + 100, _splash.Width, 26), sf);
                }
            }
        }

        private void HandleInitError(Exception ex)
        {
            Program.Log("HandleInitError " + ex.Message);
            if (_splash != null && !_splash.IsDisposed) _splash.Visible = false;

            // WebView2 不可用时，自动改用本机 Edge 的应用窗口，保证游戏仍能运行
            string edge = Program.FindEdge();
            if (!string.IsNullOrEmpty(edge) && TryLaunchEdgeApp(edge))
            {
                Program.Log("launched Edge fallback");
                Close();
                return;
            }

            // 再退一步：用系统默认浏览器打开
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = Path.Combine(Program.WebDir, "index.html");
                psi.UseShellExecute = true;
                Process.Start(psi);
                Program.Log("launched default browser fallback");
                Close();
                return;
            }
            catch { }

            MessageBox.Show(this,
                "无法启动游戏。\n\n请确认已安装 Microsoft Edge / WebView2 Runtime，并确认程序目录中的文件完整。\n\n" +
                ex.Message,
                Program.AppName, MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }

        private bool TryLaunchEdgeApp(string edge)
        {
            try
            {
                string uri = new Uri(Path.Combine(Program.WebDir, "index.html")).AbsoluteUri;
                string edgeData = Path.Combine(Path.GetDirectoryName(Program.UserDataDir), "EdgeApp");
                try { Directory.CreateDirectory(edgeData); } catch { edgeData = Program.UserDataDir; }

                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = edge;
                psi.Arguments =
                    "--app=\"" + uri + "\"" +
                    " --user-data-dir=\"" + edgeData + "\"" +
                    " --window-size=1600,900 --no-first-run --no-default-browser-check" +
                    " --disable-features=Translate,msEdgeSidebarV2";
                psi.UseShellExecute = false;
                Process.Start(psi);
                return true;
            }
            catch
            {
                return false;
            }
        }
    }
}
