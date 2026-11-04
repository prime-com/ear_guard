using EarGuard.Core;
using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace EarGuard.Win;

/// <summary>
/// Listens to what Windows plays (WASAPI loopback on the default output, which is read BEFORE the master
/// volume — verified on a Sony ULT WEAR over Bluetooth) and reads the endpoint volume and device type.
/// </summary>
public sealed class AudioMonitor : IDisposable
{
    public sealed record Reading(OutputInfo Output, LevelWindow? Window, bool CallMode, string? Note);

    private readonly MMDeviceEnumerator _enum = new();
    private MMDevice? _dev;
    private WasapiLoopbackCapture? _cap;
    private LevelMeter? _meter;
    private string? _devId;

    private static string Prop(MMDevice d, string guid, int pid)
    {
        try
        {
            var key = new PropertyKey(new Guid(guid), pid);
            return d.Properties.Contains(key) ? Convert.ToString(d.Properties[key].Value) ?? "" : "";
        }
        catch { return ""; }
    }

    // PKEY_Device_EnumeratorName: BTHENUM / BTHHFENUM / BTHLEDEVICE = Bluetooth, USB, HDAUDIO, SWD...
    private static string Bus(MMDevice d) => Prop(d, "a45c254e-df1c-4efd-8020-67d146a850e0", 24);
    // PKEY_AudioEndpoint_FormFactor: 1 speakers, 3 headphones, 5 headset, 8 digital out, 9 HDMI/display
    private static string Form(MMDevice d) => Prop(d, "1da5d803-d492-4edd-8c23-e0c0ffee7f0e", 0);

    private void Restart()
    {
        Stop();
        _dev = _enum.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
        _devId = _dev.ID;
        var cap = new WasapiLoopbackCapture(_dev);
        var fmt = cap.WaveFormat;
        var meter = new LevelMeter(fmt.SampleRate);
        cap.DataAvailable += (_, e) =>
        {
            if (fmt.Encoding != WaveFormatEncoding.IeeeFloat || fmt.BitsPerSample != 32 || e.BytesRecorded < 4) return;
            meter.Process(System.Runtime.InteropServices.MemoryMarshal.Cast<byte, float>(e.Buffer.AsSpan(0, e.BytesRecorded)), fmt.Channels);
        };
        cap.StartRecording();
        _cap = cap;
        _meter = meter;
    }

    private void Stop()
    {
        try { _cap?.StopRecording(); } catch { }
        try { _cap?.Dispose(); } catch { }
        _cap = null; _meter = null;
    }

    /// <summary>Call about once a second.</summary>
    public Reading Poll()
    {
        try
        {
            var current = _enum.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
            if (_cap == null || current.ID != _devId) Restart();
            else current.Dispose();
        }
        catch (Exception e)
        {
            Stop();
            return new Reading(new OutputInfo("No output device", "none", false, false, null, null), null, false, e.Message);
        }

        var d = _dev!;
        var bus = Bus(d);
        var form = Form(d);
        bool bluetooth = bus.StartsWith("BTH", StringComparison.OrdinalIgnoreCase);
        // Bluetooth "Hands-Free" (BTHHFENUM) endpoint = call mode: 16 kHz, music sounds phone-like.
        bool callMode = bus.Equals("BTHHFENUM", StringComparison.OrdinalIgnoreCase);
        bool headphones = bluetooth || form == "3" || form == "5" || bus.Equals("USB", StringComparison.OrdinalIgnoreCase) && form != "1";
        string kind = callMode ? "Bluetooth (call mode)" : bluetooth ? "Bluetooth" : form == "3" ? "headphones" : form == "5" ? "headset" : form == "1" ? "speakers" : form == "9" ? "display" : $"bus {bus}";

        double? scalar = null, db = null;
        bool muted = false;
        try
        {
            var v = d.AudioEndpointVolume;
            scalar = v.MasterVolumeLevelScalar;
            db = v.MasterVolumeLevel;
            muted = v.Mute;
        }
        catch { /* some endpoints expose no volume: Tracker then assumes maximum */ }

        var window = _meter?.TakeWindow();
        return new Reading(new OutputInfo(d.FriendlyName, kind, headphones, muted, scalar, db), window, callMode, null);
    }

    public void Dispose() { Stop(); _dev?.Dispose(); _enum.Dispose(); }
}
