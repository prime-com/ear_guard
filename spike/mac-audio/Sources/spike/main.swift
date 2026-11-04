// EarGuard milestone M3 — Mac feasibility spike.
// Questions: can a native Mac app get (a) the system output signal level, (b) the output
// volume/gain, (c) the output device name + transport (Bluetooth?)?
import CoreAudio
import Foundation

func fourCC(_ v: UInt32) -> String {
    let b = [UInt8((v >> 24) & 255), UInt8((v >> 16) & 255), UInt8((v >> 8) & 255), UInt8(v & 255)]
    return String(bytes: b, encoding: .ascii) ?? "\(v)"
}

func addr(_ sel: AudioObjectPropertySelector,
          _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal,
          _ el: AudioObjectPropertyElement = kAudioObjectPropertyElementMain) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: sel, mScope: scope, mElement: el)
}

func get<T>(_ obj: AudioObjectID, _ a: AudioObjectPropertyAddress, _ zero: T) -> T? {
    var a = a
    guard AudioObjectHasProperty(obj, &a) else { return nil }
    var v = zero
    var size = UInt32(MemoryLayout<T>.size)
    let st = AudioObjectGetPropertyData(obj, &a, 0, nil, &size, &v)
    return st == noErr ? v : nil
}

// ---- (c) default output device, name, transport ----
guard let dev = get(AudioObjectID(kAudioObjectSystemObject), addr(kAudioHardwarePropertyDefaultOutputDevice), AudioObjectID(0)) else {
    print("FAIL: no default output device"); exit(1)
}
let name = get(dev, addr(kAudioObjectPropertyName), "" as CFString) as String? ?? "?"
let uid = get(dev, addr(kAudioDevicePropertyDeviceUID), "" as CFString) as String? ?? "?"
let transport = get(dev, addr(kAudioDevicePropertyTransportType), UInt32(0)) ?? 0
print("(c) default output: \"\(name)\"  uid=\(uid)")
print("    transport type: '\(fourCC(transport))'  (blue/blea = Bluetooth, bltn = built-in, usb  = USB)")

// ---- (b) volume / gain ----
let out = kAudioDevicePropertyScopeOutput
if let v = get(dev, addr(0x766D7663 /* vmvc: virtual main volume */, out), Float32(0)) {
    print("(b) virtual main volume (0…1): \(v)")
} else { print("(b) virtual main volume: NOT AVAILABLE") }
for el in [kAudioObjectPropertyElementMain, 1, 2] as [UInt32] {
    if let db = get(dev, addr(kAudioDevicePropertyVolumeDecibels, out, el), Float32(0)) {
        print("    volume dB (element \(el)): \(db)")
    }
    if let sc = get(dev, addr(kAudioDevicePropertyVolumeScalar, out, el), Float32(0)) {
        print("    volume scalar (element \(el)): \(sc)")
    }
}
if let m = get(dev, addr(kAudioDevicePropertyMute, out), UInt32(0)) { print("    muted: \(m)") }

// ---- (a) system output signal level via a Core Audio process tap ----
let seconds = Double(CommandLine.arguments.dropFirst().first ?? "6") ?? 6
let desc = CATapDescription(stereoGlobalTapButExcludeProcesses: [])
desc.name = "EarGuard spike"
desc.isPrivate = true
desc.muteBehavior = .unmuted
var tapID = AudioObjectID(kAudioObjectUnknown)
var st = AudioHardwareCreateProcessTap(desc, &tapID)
print("(a) create process tap: status \(st) \(st == noErr ? "OK" : "(" + fourCC(UInt32(bitPattern: st)) + ")")")
guard st == noErr else { exit(2) }

let aggUID = UUID().uuidString
let agg: [String: Any] = [
    kAudioAggregateDeviceNameKey: "EarGuardSpike",
    kAudioAggregateDeviceUIDKey: aggUID,
    kAudioAggregateDeviceIsPrivateKey: true,
    kAudioAggregateDeviceIsStackedKey: false,
    kAudioAggregateDeviceMainSubDeviceKey: uid,
    kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: uid]],
    kAudioAggregateDeviceTapAutoStartKey: true,
    kAudioAggregateDeviceTapListKey: [[
        kAudioSubTapUIDKey: desc.uuid.uuidString,
        kAudioSubTapDriftCompensationKey: true,
    ]],
]
var aggID = AudioObjectID(kAudioObjectUnknown)
st = AudioHardwareCreateAggregateDevice(agg as CFDictionary, &aggID)
print("    create aggregate device: status \(st)")
guard st == noErr else { exit(3) }

if let f = get(tapID, addr(kAudioTapPropertyFormat), AudioStreamBasicDescription()) {
    print("    tap format: \(f.mSampleRate) Hz, \(f.mChannelsPerFrame) ch, \(f.mBitsPerChannel) bit, flags \(f.mFormatFlags)")
}

var callbacks = 0
var peakEver: Float = 0
var sumSq = 0.0, count = 0.0, peak: Float = 0
let lock = NSLock()
var proc: AudioDeviceIOProcID?
st = AudioDeviceCreateIOProcIDWithBlock(&proc, aggID, DispatchQueue(label: "spike.io")) { _, inData, _, _, _ in
    let bufs = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: inData))
    var s = 0.0, n = 0.0, p: Float = 0
    for b in bufs {
        guard let d = b.mData?.assumingMemoryBound(to: Float.self) else { continue }
        let c = Int(b.mDataByteSize) / MemoryLayout<Float>.size
        for i in 0..<c { let x = d[i]; s += Double(x * x); n += 1; p = max(p, abs(x)) }
    }
    lock.lock(); callbacks += 1; sumSq += s; count += n; peak = max(peak, p); lock.unlock()
}
print("    create IOProc: status \(st)")
guard st == noErr, let proc = proc else { exit(4) }
st = AudioDeviceStart(aggID, proc)
print("    start: status \(st) — listening \(Int(seconds)) s; play some audio now…")
guard st == noErr else { exit(5) }

for _ in 0..<Int(seconds) {
    Thread.sleep(forTimeInterval: 1)
    lock.lock()
    let rms = count > 0 ? (sumSq / count).squareRoot() : 0
    let cb = callbacks
    let pk = peak
    sumSq = 0; count = 0; peak = 0
    peakEver = max(peakEver, pk)
    lock.unlock()
    let dbfs = rms > 0 ? 20 * log10(rms * 2.0.squareRoot()) : -Double.infinity
    print(String(format: "    callbacks=%d  level=%.1f dBFS (AES17)  peak=%.4f", cb, dbfs, pk))
}
AudioDeviceStop(aggID, proc)
AudioDeviceDestroyIOProcID(aggID, proc)
AudioHardwareDestroyAggregateDevice(aggID)
AudioHardwareDestroyProcessTap(tapID)
if peakEver == 0 {
    print("NOTE: all silence. If audio WAS playing, this is almost always the macOS privacy permission:")
    print("      System Settings → Privacy & Security → Screen & System Audio Recording → enable the app running this (Terminal / VS Code).")
}
print("done")
