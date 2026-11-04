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

func getProperty<T>(_ obj: AudioObjectID, _ a: AudioObjectPropertyAddress, _ zero: T) -> T? {
    var a = a
    guard AudioObjectHasProperty(obj, &a) else { return nil }
    var v = zero
    var size = UInt32(MemoryLayout<T>.size)
    return AudioObjectGetPropertyData(obj, &a, 0, nil, &size, &v) == noErr ? v : nil
}

/// What we know about the current default output device.
struct OutputInfo: Equatable {
    var name: String
    var uid: String
    var transport: String        // 'blue', 'blea', 'usb ', 'bltn', 'hdmi', …
    var isHeadphones: Bool       // output we count toward the listening dose
    var volume: Double?          // slider position 0…1, nil if the device doesn't expose one
    var muted: Bool

    var transportLabel: String {
        switch transport {
        case "blue", "blea": return "Bluetooth"
        case "usb ": return "USB"
        case "bltn": return isHeadphones ? "headphone jack" : "built-in speakers"
        case "hdmi", "dprt": return "display/TV"
        case "airp": return "AirPlay"
        default: return transport.trimmingCharacters(in: .whitespaces)
        }
    }
}

let systemObject = AudioObjectID(kAudioObjectSystemObject)

func defaultOutputDevice() -> AudioObjectID? {
    getProperty(systemObject, addr(kAudioHardwarePropertyDefaultOutputDevice), AudioObjectID(0))
}

/// Bluetooth, USB and the headphone jack are counted; speakers, displays and AirPlay are not.
func countsAsHeadphones(transport: String, dataSource: UInt32?) -> Bool {
    switch transport {
    case "blue", "blea", "usb ": return true
    case "bltn": return dataSource == 0x6864706E // 'hdpn'
    default: return false
    }
}

func readOutputInfo(_ dev: AudioObjectID) -> OutputInfo {
    let out = kAudioDevicePropertyScopeOutput
    let name = getProperty(dev, addr(kAudioObjectPropertyName), "" as CFString) as String? ?? "Unknown"
    let uid = getProperty(dev, addr(kAudioDevicePropertyDeviceUID), "" as CFString) as String? ?? ""
    let transport = fourCC(getProperty(dev, addr(kAudioDevicePropertyTransportType), UInt32(0)) ?? 0)
    let source = getProperty(dev, addr(kAudioDevicePropertyDataSource, out), UInt32(0))
    // 'vmvc' = virtual main volume (0…1)
    var volume = getProperty(dev, addr(0x766D7663, out), Float32(0)).map(Double.init)
    if volume == nil { volume = getProperty(dev, addr(kAudioDevicePropertyVolumeScalar, out, 1), Float32(0)).map(Double.init) }
    let muted = (getProperty(dev, addr(kAudioDevicePropertyMute, out), UInt32(0)) ?? 0) != 0
    return OutputInfo(name: name, uid: uid, transport: transport,
                      isHeadphones: countsAsHeadphones(transport: transport, dataSource: source),
                      volume: volume, muted: muted)
}

func allAudioDevices() -> [AudioObjectID] {
    var a = addr(kAudioHardwarePropertyDevices)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(systemObject, &a, 0, nil, &size) == noErr else { return [] }
    var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
    guard AudioObjectGetPropertyData(systemObject, &a, 0, nil, &size, &ids) == noErr else { return [] }
    return ids
}

func outputChannelCount(_ dev: AudioObjectID) -> Int {
    var a = addr(kAudioDevicePropertyStreamConfiguration, kAudioDevicePropertyScopeOutput, 0)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(dev, &a, 0, nil, &size) == noErr, size > 0 else { return 0 }
    let buf = UnsafeMutableRawPointer.allocate(byteCount: Int(size), alignment: 16)
    defer { buf.deallocate() }
    guard AudioObjectGetPropertyData(dev, &a, 0, nil, &size, buf) == noErr else { return 0 }
    return UnsafeMutableAudioBufferListPointer(buf.assumingMemoryBound(to: AudioBufferList.self)).reduce(0) { $0 + Int($1.mNumberChannels) }
}

/// UID of a built-in output device (the Mac's own speakers), or nil.
func builtInOutputUID() -> String? {
    for id in allAudioDevices() where outputChannelCount(id) > 0 {
        let transport = fourCC(getProperty(id, addr(kAudioDevicePropertyTransportType), UInt32(0)) ?? 0)
        if transport == "bltn" { return getProperty(id, addr(kAudioDevicePropertyDeviceUID), "" as CFString) as String? }
    }
    return nil
}

/// Which device provides the clock for the tap's aggregate device.
///
/// Why this matters: an aggregate that contains a Bluetooth headset also contains its microphone
/// stream, and running it can switch the headset into call mode (HFP) — music turns quiet and
/// "phone-like". `builtin` (default) keeps the Bluetooth device out of the aggregate entirely.
enum ClockMode: String {
    case builtin  // default: the Mac's own speakers provide the clock
    case none     // tap only, no sub-device
    case output   // the default output device (old behaviour; can trigger call mode on Bluetooth)

    static var current: ClockMode { ProcessInfo.processInfo.environment["EARGUARD_CLOCK"].flatMap(ClockMode.init) ?? .builtin }
}
