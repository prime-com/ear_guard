using System.Text.Json;

namespace EarGuard.Core;

/// <summary>Rolling record of listening energy in 15-minute buckets, kept on this PC only.</summary>
public sealed class DoseStore
{
    public const int BucketSeconds = 900;
    private readonly object _lock = new();
    private readonly Dictionary<long, double> _buckets = new();
    private readonly string? _path;

    public DoseStore(string? path = null)
    {
        _path = path;
        try
        {
            if (path != null && File.Exists(path))
            {
                var d = JsonSerializer.Deserialize<Dictionary<string, double>>(File.ReadAllText(path));
                if (d != null) foreach (var (k, v) in d) if (long.TryParse(k, out var key)) _buckets[key] = v;
            }
        }
        catch { /* a damaged file starts a fresh record */ }
    }

    public static string DefaultPath()
    {
        var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "EarGuard");
        Directory.CreateDirectory(dir);
        return Path.Combine(dir, "dose.json");
    }

    private static long Key(DateTimeOffset t) => t.ToUnixTimeSeconds() / BucketSeconds;

    public void Add(double pa2h, DateTimeOffset at)
    {
        lock (_lock) _buckets[Key(at)] = _buckets.GetValueOrDefault(Key(at)) + pa2h;
    }

    public double Pa2hSince(DateTimeOffset start, DateTimeOffset now)
    {
        lock (_lock)
        {
            long from = Key(start), to = Key(now);
            return _buckets.Where(kv => kv.Key >= from && kv.Key <= to).Sum(kv => kv.Value);
        }
    }

    public double WeekPa2h(DateTimeOffset now) => Pa2hSince(now.AddDays(-7), now);

    public double TodayPa2h(DateTimeOffset now) =>
        Pa2hSince(new DateTimeOffset(now.LocalDateTime.Date, TimeZoneInfo.Local.GetUtcOffset(now.LocalDateTime.Date)), now);

    public void Save(DateTimeOffset now)
    {
        if (_path == null) return;
        Dictionary<string, double> o;
        lock (_lock)
        {
            long cutoff = Key(now.AddDays(-8));
            foreach (var k in _buckets.Keys.Where(k => k < cutoff).ToList()) _buckets.Remove(k);
            o = _buckets.ToDictionary(kv => kv.Key.ToString(), kv => kv.Value);
        }
        var tmp = _path + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(o));
        File.Move(tmp, _path, overwrite: true);
    }
}
