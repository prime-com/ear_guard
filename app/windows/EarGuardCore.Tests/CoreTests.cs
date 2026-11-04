using System.Text.Json;
using EarGuard.Core;
using Xunit;

namespace EarGuardCore.Tests;

public class CoreTests
{
    private static JsonElement Vectors()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !File.Exists(Path.Combine(dir.FullName, "test-vectors", "core.json"))) dir = dir.Parent;
        Assert.NotNull(dir);
        return JsonDocument.Parse(File.ReadAllText(Path.Combine(dir!.FullName, "test-vectors", "core.json"))).RootElement;
    }

    private static void Near(double expected, double actual, double rel = 1e-9) =>
        Assert.True(Math.Abs(expected - actual) <= rel * Math.Max(1, Math.Abs(expected)), $"expected {expected}, got {actual}");

    private static DoseMode Mode(string s) => s == "standard" ? DoseMode.Standard : DoseMode.Sensitive;

    [Fact] public void DbToPa2() { foreach (var v in Vectors().GetProperty("dbToPa2").EnumerateArray()) Near(v.GetProperty("pa2").GetDouble(), Dose.DbToPa2(v.GetProperty("db").GetDouble())); }

    [Fact] public void Exposure() { foreach (var v in Vectors().GetProperty("exposurePa2h").EnumerateArray()) Near(v.GetProperty("pa2h").GetDouble(), Dose.ExposurePa2h(v.GetProperty("db").GetDouble(), v.GetProperty("seconds").GetDouble())); }

    [Fact] public void WeeklyFraction() { foreach (var v in Vectors().GetProperty("weeklyDoseFraction").EnumerateArray()) Near(v.GetProperty("fraction").GetDouble(), Dose.WeeklyDoseFraction(v.GetProperty("pa2h").GetDouble(), Mode(v.GetProperty("mode").GetString()!))); }

    [Fact] public void AllowedHours() { foreach (var v in Vectors().GetProperty("allowedHoursPerWeek").EnumerateArray()) Near(v.GetProperty("hours").GetDouble(), Dose.AllowedHoursPerWeek(v.GetProperty("db").GetDouble(), Mode(v.GetProperty("mode").GetString()!)), 1e-6); }

    [Fact] public void EarLevel() { foreach (var v in Vectors().GetProperty("earLevelDb").EnumerateArray()) Near(v.GetProperty("db").GetDouble(), Dose.EarLevelDb(v.GetProperty("signalDbA").GetDouble(), v.GetProperty("volumeDb").GetDouble(), v.GetProperty("sDevice").GetDouble())); }

    [Fact] public void RmsToDbfs() { foreach (var v in Vectors().GetProperty("rmsToDbfs").EnumerateArray()) Assert.True(Math.Abs(v.GetProperty("dbfs").GetDouble() - Dose.RmsToDbfs(v.GetProperty("rms").GetDouble())) < 1e-9); }

    [Fact] public void AWeightingReferencePoints()
    {
        var f = new AWeightingFilter(48000);
        // same IEC 61672 nominal values and tolerance as the Mac self-test
        (double hz, double want)[] nominal = { (31.5, -39.4), (63, -26.2), (125, -16.1), (250, -8.6), (500, -3.2), (1000, 0.0), (2000, 1.2), (4000, 1.0), (8000, -1.1) };
        foreach (var (hz, want) in nominal)
            Assert.True(Math.Abs(f.ResponseDb(hz) - want) <= 0.7, $"{hz} Hz: expected {want}, got {f.ResponseDb(hz):F2}");
    }

    [Fact] public void MeterReadsFullScaleSineAsZeroDbfs()
    {
        var m = new LevelMeter(48000);
        var buf = new float[48000 * 2];
        for (int i = 0; i < 48000; i++) { var x = (float)Math.Sin(2 * Math.PI * 1000 * i / 48000.0); buf[2 * i] = x; buf[2 * i + 1] = x * 0.1f; }
        m.Process(buf, 2);
        var w = m.TakeWindow()!.Value;
        Assert.True(Math.Abs(w.Dbfs) < 0.05, $"{w.Dbfs}");
        Assert.True(Math.Abs(w.DbfsA) < 0.3, $"{w.DbfsA}"); // 1 kHz is the A-weighting reference
    }

    [Fact] public void QuietOrZeroVolumeIsNeverNegativeDb()
    {
        var est = Levels.EstimateLevel(-40, Levels.VolumeDb(0, -96));
        Assert.False(est.IsReportable);
    }

    [Fact] public void VolumeLeansLoud()
    {
        // measured: 0.50 -> -10.3 dB; the assumed curve (-6 dB) is louder, and must win
        Near(Levels.VolumeDbFromScalar(0.5), Levels.VolumeDb(0.5, -10.3), 1e-9);
        // a device that is LOUDER than the assumed curve is honoured (endpoint dB capped at 0)
        Near(-1, Levels.VolumeDb(0.5, -1), 1e-9);
    }

    [Fact] public void TrackerCountsDoseWithUpperBound()
    {
        var store = new DoseStore();
        var tr = new Tracker(store);
        var o = new OutputInfo("h", "Bluetooth", true, false, 1.0, 0.0);
        var w = new LevelWindow(-20, -20, 0.5f, 48000);
        var r = tr.Handle(o, w, 3600, DateTimeOffset.UtcNow);
        Assert.Equal(TrackState.Playing, r.State);
        Near(Dose.ExposurePa2h(r.Estimate!.Value.Conservative, 3600), store.WeekPa2h(DateTimeOffset.UtcNow));
        Assert.Equal(TrackState.NotHeadphones, tr.Handle(o with { IsHeadphones = false }, w, 1, DateTimeOffset.UtcNow).State);
    }

    [Fact] public void StoreRoundTrips()
    {
        var p = Path.Combine(Path.GetTempPath(), $"eg-{Guid.NewGuid():N}.json");
        var now = DateTimeOffset.UtcNow;
        var a = new DoseStore(p); a.Add(0.5, now); a.Save(now);
        var b = new DoseStore(p);
        Near(0.5, b.WeekPa2h(now));
        File.Delete(p);
    }
}
