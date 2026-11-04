namespace EarGuard.Core;

/// <summary>A-weighting (IEC 61672) as three biquads (bilinear transform, pre-warped poles), 0 dB at 1 kHz.</summary>
public sealed class AWeightingFilter
{
    private struct Biquad
    {
        public double B0, B1, B2, A1, A2, Z1, Z2;
        public double Process(double x)
        {
            var y = B0 * x + Z1;
            Z1 = B1 * x - A1 * y + Z2;
            Z2 = B2 * x - A2 * y;
            return y;
        }
        public readonly double Magnitude(double w)
        {
            double c1 = Math.Cos(w), s1 = Math.Sin(w), c2 = Math.Cos(2 * w), s2 = Math.Sin(2 * w);
            double nr = B0 + B1 * c1 + B2 * c2, ni = -(B1 * s1 + B2 * s2);
            double dr = 1 + A1 * c1 + A2 * c2, di = -(A1 * s1 + A2 * s2);
            return Math.Sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
        }
    }

    private readonly Biquad[] _s;
    private readonly double _gain;
    public double SampleRate { get; }

    public AWeightingFilter(double sampleRate)
    {
        SampleRate = sampleRate;
        double f1 = 20.598997, f2 = 107.65265, f3 = 737.86223, f4 = 12194.217;
        double c = 2 * sampleRate;
        double W(double f) => c * Math.Tan(2 * Math.PI * f / c);
        double w1 = W(f1), w2 = W(f2), w3 = W(f3), w4 = W(f4);
        (double b2, double b1, double b0, double a2, double a1, double a0)[] analog =
        {
            (1, 0, 0, 1, 2 * w1, w1 * w1),
            (1, 0, 0, 1, w2 + w3, w2 * w3),
            (0, 0, 1, 1, 2 * w4, w4 * w4),
        };
        _s = analog.Select(a =>
        {
            double c2 = c * c;
            double n0 = a.b2 * c2 + a.b1 * c + a.b0, n1 = -2 * a.b2 * c2 + 2 * a.b0, n2 = a.b2 * c2 - a.b1 * c + a.b0;
            double d0 = a.a2 * c2 + a.a1 * c + a.a0, d1 = -2 * a.a2 * c2 + 2 * a.a0, d2 = a.a2 * c2 - a.a1 * c + a.a0;
            return new Biquad { B0 = n0 / d0, B1 = n1 / d0, B2 = n2 / d0, A1 = d1 / d0, A2 = d2 / d0 };
        }).ToArray();
        double w1k = 2 * Math.PI * 1000 / sampleRate;
        _gain = 1 / _s.Aggregate(1.0, (g, b) => g * b.Magnitude(w1k));
    }

    public float Process(float x)
    {
        double v = x;
        for (int i = 0; i < _s.Length; i++) v = _s[i].Process(v);
        return (float)(v * _gain);
    }

    public double ResponseDb(double frequency)
    {
        double w = 2 * Math.PI * frequency / SampleRate;
        return 20 * Math.Log10(_gain * _s.Aggregate(1.0, (g, b) => g * b.Magnitude(w)));
    }
}
