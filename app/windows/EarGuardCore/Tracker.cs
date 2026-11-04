namespace EarGuard.Core;

/// <summary>What the output is (filled in by the Windows layer).</summary>
public sealed record OutputInfo(string Name, string Kind, bool IsHeadphones, bool Muted, double? Scalar, double? EndpointDb);

public enum TrackState { NotHeadphones, Muted, Silent, VeryQuiet, Playing }

public sealed record TrackResult(TrackState State, LevelEstimate? Estimate = null, double SignalDbfsA = double.NaN);

/// <summary>Turns audio readings into a level estimate and a listening dose.</summary>
public sealed class Tracker
{
    public DoseStore Store { get; }
    public DoseMode Mode { get; set; } = DoseMode.Standard;
    public bool Paused { get; set; }
    public TrackResult Last { get; private set; } = new(TrackState.Silent);
    public double SilentSeconds { get; private set; }

    public Tracker(DoseStore store) { Store = store; }

    public TrackResult Handle(OutputInfo o, LevelWindow? w, double seconds, DateTimeOffset at)
    {
        if (!o.IsHeadphones) { SilentSeconds = 0; return Set(new(TrackState.NotHeadphones)); }
        if (o.Muted) { SilentSeconds = 0; return Set(new(TrackState.Muted)); }
        if (w is not { } win || win.IsSilent || !double.IsFinite(win.DbfsA))
        {
            SilentSeconds += seconds;
            return Set(new(TrackState.Silent));
        }
        SilentSeconds = 0;
        // Volume unknown: assume maximum (the loud side).
        var vdb = Levels.VolumeDb(o.Scalar ?? 1, o.EndpointDb);
        var est = Levels.EstimateLevel(win.DbfsA, vdb);
        if (!est.IsReportable) return Set(new(TrackState.VeryQuiet, est, win.DbfsA));
        if (!Paused) Store.Add(Dose.ExposurePa2h(est.Conservative, seconds), at);
        return Set(new(TrackState.Playing, est, win.DbfsA));
    }

    private TrackResult Set(TrackResult r) => Last = r;

    public double WeekFraction(DateTimeOffset now) => Dose.WeeklyDoseFraction(Store.WeekPa2h(now), Mode);
    public double TodayFraction(DateTimeOffset now) => Dose.WeeklyDoseFraction(Store.TodayPa2h(now), Mode);
}
