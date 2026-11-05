using System.Text.Json;
using Microsoft.Win32;

namespace EarGuard.Win;

/// <summary>Small settings file in %APPDATA%\EarGuard, plus the "start with Windows" registry entry.</summary>
public sealed class Settings
{
    public bool Sensitive { get; set; }
    public bool Paused { get; set; }
    /// <summary>Start-with-Windows is switched on once, on first run; after that the user's choice wins.</summary>
    public bool StartupAsked { get; set; }

    private static string PathFile => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "EarGuard", "settings.json");

    public static Settings Load()
    {
        try { return JsonSerializer.Deserialize<Settings>(File.ReadAllText(PathFile)) ?? new Settings(); }
        catch { return new Settings(); }
    }

    public void Save()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(PathFile)!);
            File.WriteAllText(PathFile, JsonSerializer.Serialize(this));
        }
        catch { /* settings are a convenience; never crash for them */ }
    }
}

public static class Startup
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "EarGuard";

    public static bool IsEnabled()
    {
        try
        {
            using var k = Registry.CurrentUser.OpenSubKey(RunKey);
            return k?.GetValue(ValueName) is string;
        }
        catch { return false; }
    }

    /// <summary>Per-user (no admin needed). Points at the exe that is running now.</summary>
    public static bool Set(bool enabled)
    {
        try
        {
            using var k = Registry.CurrentUser.CreateSubKey(RunKey);
            if (enabled)
            {
                var exe = Environment.ProcessPath;
                if (string.IsNullOrEmpty(exe)) return false;
                k.SetValue(ValueName, $"\"{exe}\"");
            }
            else k.DeleteValue(ValueName, false);
            return true;
        }
        catch { return false; }
    }
}
