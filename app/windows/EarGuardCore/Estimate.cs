namespace EarGuard.Core;

public readonly record struct Estimate(double Value, double Sigma);

public readonly record struct LevelEstimate(double DbA, double Sigma)
{
    /// <summary>Used for dose: estimate + 1 sigma (reads loud when unsure — safety rule).</summary>
    public double Conservative => DbA + Sigma;
    public double Low => DbA - Sigma;
    public double High => DbA + Sigma;
    public bool IsReportable => double.IsFinite(DbA) && DbA >= Levels.MinReportableDb;
}

public static class Levels
{
    /// <summary>
    /// UNVERIFIED PLACEHOLDER (same as the Mac app): dB SPL a full-scale 1 kHz tone gives at the ear at
    /// maximum volume. Spans Sony ULT WEAR ~85-88 dB (hearing check, reads low) and Apple EarPods ~111 dB
    /// (Apple Health). Leans LOUD. Always call the result a "rough estimate".
    /// </summary>
    public static readonly Estimate DefaultDevice = new(100, 10);

    public const double VolumeMappingSigma = 6.0;
    public const double MinReportableDb = 20.0;

    /// <summary>Slider position (0..1) to dB relative to maximum, assuming amplitude proportional to the slider.</summary>
    public static double VolumeDbFromScalar(double scalar) =>
        scalar > 0 ? Math.Max(-60, 20 * Math.Log10(Math.Min(1, scalar))) : -120;

    /// <summary>
    /// Windows reports the endpoint volume in real dB. On the one device measured (Sony over Bluetooth) that
    /// curve is QUIETER than 20*log10(slider) (0.50 -> -10.3 dB vs -6 dB). To lean loud we take the louder
    /// of the two. Pass null when Windows gives no dB value.
    /// </summary>
    public static double VolumeDb(double scalar, double? endpointDb)
    {
        var assumed = VolumeDbFromScalar(scalar);
        if (endpointDb is double e && double.IsFinite(e) && scalar > 0) return Math.Max(assumed, Math.Min(0, e));
        return assumed;
    }

    public static LevelEstimate EstimateLevel(double signalDbA, double volumeDb, Estimate? device = null)
    {
        var d = device ?? DefaultDevice;
        var level = Dose.EarLevelDb(signalDbA, volumeDb, d.Value);
        return new LevelEstimate(level, Math.Sqrt(d.Sigma * d.Sigma + VolumeMappingSigma * VolumeMappingSigma));
    }
}
