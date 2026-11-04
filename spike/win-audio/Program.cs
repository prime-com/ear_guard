// EarGuard — Windows feasibility spike (same questions as the Mac spike).
//   (c) default output device: name + how it is connected (Bluetooth? USB? headphone jack?)
//   (b) output volume: slider position AND dB
//   (a) system output level via WASAPI loopback — and does it FOLLOW the master volume or not?
//
// Run:  dotnet run -- 30      (listens for 30 s)
// While it runs: play music, then move the Windows volume slider up and down a few times.
using NAudio.CoreAudioApi;
using NAudio.Wave;

static string Prop(MMDevice d, Guid fmtid, int pid)
{
    try
    {
        var key = new PropertyKey(fmtid, pid);
        return d.Properties.Contains(key) ? Convert.ToString(d.Properties[key].Value) ?? "?" : "(none)";
    }
    catch (Exception e) { return $"(error: {e.Message})"; }
}

// PKEY_Device_EnumeratorName: "BTHENUM"/"BTHHFENUM"/"BTHLEDEVICE" = Bluetooth, "USB", "HDAUDIO", "SWD"…
static string Enumerator(MMDevice d) => Prop(d, new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), 24);
// PKEY_AudioEndpoint_FormFactor: 1 Speakers, 3 Headphones, 5 Headset, 9 HDMI/display, 10 unknown
static string FormFactor(MMDevice d) => Prop(d, new Guid("1da5d803-d492-4edd-8c23-e0c0ffee7f0e"), 0);

int seconds = args.Length > 0 && int.TryParse(args[0], out var s) ? s : 20;
var enumerator = new MMDeviceEnumerator();

Console.WriteLine("=== Render (output) devices ===");
foreach (var d in enumerator.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active))
    Console.WriteLine($"  {d.FriendlyName}  [bus={Enumerator(d)} formFactor={FormFactor(d)}]");

Console.WriteLine("=== Capture (input) devices — a Bluetooth 'Hands-Free' input here = call-mode risk ===");
foreach (var d in enumerator.EnumerateAudioEndPoints(DataFlow.Capture, DeviceState.Active))
    Console.WriteLine($"  {d.FriendlyName}  [bus={Enumerator(d)}]");

var dev = enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
Console.WriteLine();
Console.WriteLine($"(c) default output: \"{dev.FriendlyName}\"  id={dev.ID}");
Console.WriteLine($"    bus={Enumerator(dev)}  formFactor={FormFactor(dev)}   (bus BTHENUM/BTHLE… = Bluetooth)");

var vol = dev.AudioEndpointVolume;
Console.WriteLine($"(b) volume: scalar={vol.MasterVolumeLevelScalar:F3}  dB={vol.MasterVolumeLevel:F1}  muted={vol.Mute}");

Console.WriteLine($"(a) loopback capture for {seconds} s — play music, then move the volume slider…");
using var capture = new WasapiLoopbackCapture(dev);
var fmt = capture.WaveFormat;
Console.WriteLine($"    format: {fmt.SampleRate} Hz, {fmt.Channels} ch, {fmt.BitsPerSample} bit, {fmt.Encoding}");

var gate = new object();
double[] sumSq = new double[fmt.Channels];
long frames = 0;
float peak = 0;
int callbacks = 0;

capture.DataAvailable += (_, e) =>
{
    if (fmt.Encoding != WaveFormatEncoding.IeeeFloat || fmt.BitsPerSample != 32) return; // WASAPI shared mode is normally 32-bit float
    int ch = fmt.Channels;
    int n = e.BytesRecorded / 4;
    var span = System.Runtime.InteropServices.MemoryMarshal.Cast<byte, float>(e.Buffer.AsSpan(0, e.BytesRecorded));
    lock (gate)
    {
        callbacks++;
        for (int i = 0; i + ch <= n; i += ch)
        {
            for (int c = 0; c < ch; c++) { float x = span[i + c]; sumSq[c] += (double)x * x; peak = MathF.Max(peak, MathF.Abs(x)); }
            frames++;
        }
    }
};
capture.StartRecording();

for (int t = 0; t < seconds; t++)
{
    Thread.Sleep(1000);
    double rms; float pk; int cb;
    lock (gate)
    {
        rms = frames > 0 ? sumSq.Select(v => Math.Sqrt(v / frames)).Max() : 0; // louder channel
        pk = peak; cb = callbacks;
        Array.Clear(sumSq); frames = 0; peak = 0; callbacks = 0;
    }
    double dbfs = rms > 0 ? 20 * Math.Log10(rms * Math.Sqrt(2)) : double.NegativeInfinity; // AES17
    Console.WriteLine($"    level={dbfs,7:F1} dBFS peak={pk:F3} callbacks={cb,3} | volume scalar={vol.MasterVolumeLevelScalar:F3} dB={vol.MasterVolumeLevel,6:F1} muted={vol.Mute}");
}
capture.StopRecording();
Console.WriteLine("done");
Console.WriteLine("Interpretation: if 'level' stays put while the volume changes, loopback is BEFORE the master volume (what we want).");
Console.WriteLine("If 'level' drops with the volume, it is AFTER it (we then add the volume back, or measure both).");
