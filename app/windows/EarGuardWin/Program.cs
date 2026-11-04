using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using EarGuard.Core;
using EarGuard.Win;

internal static class Program
{
    [DllImport("kernel32.dll")] private static extern bool AttachConsole(int pid);

    [STAThread]
    private static void Main(string[] args)
    {
        var print = args.Contains("--print");
        if (print) AttachConsole(-1);

        using var mutex = new Mutex(true, "EarGuard.Tray.SingleInstance", out var first);
        if (!first && !print) return;

        var store = new DoseStore(DoseStore.DefaultPath());
        var tracker = new Tracker(store);
        using var monitor = new AudioMonitor();

        if (print)
        {
            // Headless: print one line per second for N seconds (default 30), like the Mac app's --print.
            int n = args.SkipWhile(a => a != "--print").Skip(1).Select(a => int.TryParse(a, out var v) ? v : 30).FirstOrDefault(30);
            for (int i = 0; i < n; i++)
            {
                Thread.Sleep(1000);
                var r = monitor.Poll();
                var t = tracker.Handle(r.Output, r.Window, 1, DateTimeOffset.UtcNow);
                Console.WriteLine(Describe(r, t, tracker));
            }
            store.Save(DateTimeOffset.UtcNow);
            return;
        }

        ApplicationConfiguration.Initialize();
        Application.Run(new TrayContext(monitor, tracker, store));
    }

    public static string Describe(AudioMonitor.Reading r, TrackResult t, Tracker tracker)
    {
        var o = r.Output;
        var vol = o.Scalar is double s ? $"vol {s:P0} ({o.EndpointDb:F1} dB)" : "vol ?";
        var head = $"{o.Name} [{o.Kind}] {vol}";
        return t.State switch
        {
            TrackState.NotHeadphones => $"{head} - not headphones, not counted",
            TrackState.Muted => $"{head} - muted",
            TrackState.Silent => $"{head} - no audio captured",
            TrackState.VeryQuiet => $"{head} - very quiet, not counted",
            _ => $"{head} signal {t.SignalDbfsA:F1} dBFS(A) -> ~{t.Estimate!.Value.DbA:F0} dB(A) ({t.Estimate.Value.Low:F0}-{t.Estimate.Value.High:F0})" +
                 $" | week {tracker.WeekFraction(DateTimeOffset.UtcNow):P1}",
        };
    }
}

internal sealed class TrayContext : ApplicationContext
{
    private readonly AudioMonitor _monitor;
    private readonly Tracker _tracker;
    private readonly DoseStore _store;
    private readonly NotifyIcon _tray;
    private readonly System.Windows.Forms.Timer _timer;
    private readonly ToolStripMenuItem _level = new("Starting...") { Enabled = false };
    private readonly ToolStripMenuItem _device = new("") { Enabled = false };
    private readonly ToolStripMenuItem _today = new("") { Enabled = false };
    private readonly ToolStripMenuItem _week = new("") { Enabled = false };
    private readonly ToolStripMenuItem _pause = new("Pause tracking");
    private readonly ToolStripMenuItem _sensitive = new("Sensitive mode (75 dB limit)");
    private bool _warned;
    private int _saveCountdown = 30;
    private IntPtr _iconHandle;

    [DllImport("user32.dll")] private static extern bool DestroyIcon(IntPtr h);

    public TrayContext(AudioMonitor monitor, Tracker tracker, DoseStore store)
    {
        _monitor = monitor; _tracker = tracker; _store = store;
        var menu = new ContextMenuStrip();
        menu.Items.AddRange(new ToolStripItem[]
        {
            _level, _device, new ToolStripSeparator(), _today, _week, new ToolStripSeparator(),
            _pause, _sensitive,
            new ToolStripMenuItem("About this estimate") { Enabled = false, ToolTipText = "A rough estimate, not a measurement." },
            new ToolStripSeparator(),
        });
        var quit = new ToolStripMenuItem("Quit EarGuard");
        quit.Click += (_, _) => Quit();
        menu.Items.Add(quit);
        _pause.Click += (_, _) => { _tracker.Paused = !_tracker.Paused; _pause.Text = _tracker.Paused ? "Resume tracking" : "Pause tracking"; };
        _sensitive.Click += (_, _) =>
        {
            _tracker.Mode = _tracker.Mode == DoseMode.Standard ? DoseMode.Sensitive : DoseMode.Standard;
            _sensitive.Checked = _tracker.Mode == DoseMode.Sensitive;
        };
        _tray = new NotifyIcon { ContextMenuStrip = menu, Visible = true, Text = "EarGuard" };
        SetIcon("--", Color.Gray);
        _timer = new System.Windows.Forms.Timer { Interval = 1000 };
        _timer.Tick += (_, _) => Tick();
        _timer.Start();
    }

    private void Tick()
    {
        var now = DateTimeOffset.UtcNow;
        var r = _monitor.Poll();
        var t = _tracker.Handle(r.Output, r.Window, 1, now);
        var week = _tracker.WeekFraction(now);
        _device.Text = $"{r.Output.Name} [{r.Output.Kind}]";
        _today.Text = $"Today: {_tracker.TodayFraction(now):P0} of weekly limit";
        _week.Text = $"Last 7 days: {week:P1} of weekly limit";

        string tip; string icon; Color color;
        switch (t.State)
        {
            case TrackState.Playing:
                var e = t.Estimate!.Value;
                _level.Text = $"~{e.DbA:F0} dB(A) at your ears  (rough estimate, {e.Low:F0}-{e.High:F0})";
                icon = $"{e.DbA:F0}";
                color = e.DbA >= 90 ? Color.FromArgb(200, 30, 30) : e.DbA >= 80 ? Color.FromArgb(215, 130, 0) : Color.FromArgb(30, 140, 60);
                tip = $"~{e.DbA:F0} dB(A) (rough) - week {week:P0}";
                break;
            case TrackState.Muted: _level.Text = "Muted"; icon = "--"; color = Color.Gray; tip = "Muted"; break;
            case TrackState.VeryQuiet: _level.Text = "Very quiet - not counted"; icon = "--"; color = Color.Gray; tip = "Very quiet"; break;
            case TrackState.NotHeadphones: _level.Text = "Not headphones - not tracked"; icon = "--"; color = Color.Gray; tip = "Not headphones"; break;
            default: _level.Text = "No sound playing"; icon = "--"; color = Color.Gray; tip = "No sound playing"; break;
        }
        if (r.CallMode) { _level.Text = "Headphones are in CALL MODE (phone-like sound). " + _level.Text; tip = "Call mode! " + tip; }
        if (r.Note != null) _level.Text = r.Note;
        _tray.Text = tip.Length > 120 ? tip[..120] : tip;
        SetIcon(icon, color);

        if (week >= 1 && !_warned)
        {
            _warned = true;
            _tray.ShowBalloonTip(8000, "EarGuard", "You have reached the weekly listening limit (WHO / ITU-T H.870). A rough estimate - but consider a break.", ToolTipIcon.Warning);
        }
        else if (week < 0.95) _warned = false;

        if (--_saveCountdown <= 0) { _store.Save(now); _saveCountdown = 30; }
    }

    private void SetIcon(string text, Color color)
    {
        using var bmp = new Bitmap(32, 32);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
            using var b = new SolidBrush(color);
            g.FillEllipse(b, 0, 0, 31, 31);
            using var f = new Font("Segoe UI", text.Length >= 3 ? 12f : 15f, FontStyle.Bold, GraphicsUnit.Pixel);
            var sz = g.MeasureString(text, f);
            g.DrawString(text, f, Brushes.White, (32 - sz.Width) / 2, (32 - sz.Height) / 2);
        }
        var h = bmp.GetHicon();
        _tray.Icon = Icon.FromHandle(h);
        if (_iconHandle != IntPtr.Zero) DestroyIcon(_iconHandle);
        _iconHandle = h;
    }

    private void Quit()
    {
        _timer.Stop();
        _store.Save(DateTimeOffset.UtcNow);
        _tray.Visible = false;
        _tray.Dispose();
        ExitThread();
    }
}
