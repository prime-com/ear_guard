namespace EarGuard.Core;

// Port of app/mac/Sources/EarGuardCore (itself a port of src/core/calibration.ts).
// test-vectors/core.json keeps all the ports in agreement.

public enum DoseMode { Standard, Sensitive }

public static class Dose
{
    public const double RefPressurePa = 20e-6;

    public static double Allowance(DoseMode m) => m == DoseMode.Standard ? 1.6 : 0.51;

    public static double DbToPa2(double db) => Math.Pow(RefPressurePa * Math.Pow(10, db / 20), 2);

    public static double ExposurePa2h(double db, double seconds) => DbToPa2(db) * (seconds / 3600);

    public static double WeeklyDoseFraction(double pa2h, DoseMode m = DoseMode.Standard) => pa2h / Allowance(m);

    public static double AllowedHoursPerWeek(double db, DoseMode m = DoseMode.Standard) => Allowance(m) / DbToPa2(db);

    public static double EarLevelDb(double signalDbA, double volumeDb, double sDevice) => signalDbA + volumeDb + sDevice;

    /// <summary>dBFS per AES17: a full-scale sine is 0 dBFS (rms * sqrt 2).</summary>
    public static double RmsToDbfs(double rms) => rms > 0 ? 20 * Math.Log10(rms * Math.Sqrt(2)) : double.NegativeInfinity;
}
