namespace EarGuard.Core;

public readonly record struct LevelWindow(double Dbfs, double DbfsA, float Peak, int Frames)
{
    public bool IsSilent => Peak == 0;
}

/// <summary>Accumulates A-weighted and plain levels from interleaved float audio. Louder channel wins.</summary>
public sealed class LevelMeter
{
    private readonly object _lock = new();
    private readonly double _rate;
    private AWeightingFilter[] _filters = Array.Empty<AWeightingFilter>();
    private double[] _sumSq = Array.Empty<double>(), _sumSqA = Array.Empty<double>();
    private int _frames, _channels;
    private float _peak;

    public LevelMeter(double sampleRate) { _rate = sampleRate; }

    public void Process(ReadOnlySpan<float> samples, int channels)
    {
        lock (_lock)
        {
            if (channels != _channels)
            {
                _channels = channels;
                _filters = Enumerable.Range(0, channels).Select(_ => new AWeightingFilter(_rate)).ToArray();
                _sumSq = new double[channels];
                _sumSqA = new double[channels];
            }
            int frames = samples.Length / channels;
            for (int f = 0; f < frames; f++)
                for (int c = 0; c < channels; c++)
                {
                    float x = samples[f * channels + c];
                    float y = _filters[c].Process(x);
                    _sumSq[c] += (double)x * x;
                    _sumSqA[c] += (double)y * y;
                    _peak = Math.Max(_peak, Math.Abs(x));
                }
            _frames += frames;
        }
    }

    /// <summary>Window since the last call, or null if no audio arrived.</summary>
    public LevelWindow? TakeWindow()
    {
        lock (_lock)
        {
            if (_frames == 0 || _channels == 0) return null;
            double n = _frames;
            double rms = _sumSq.Max(v => Math.Sqrt(v / n)), rmsA = _sumSqA.Max(v => Math.Sqrt(v / n));
            var w = new LevelWindow(Dose.RmsToDbfs(rms), Dose.RmsToDbfs(rmsA), _peak, _frames);
            Array.Clear(_sumSq); Array.Clear(_sumSqA);
            _frames = 0; _peak = 0;
            return w;
        }
    }
}
