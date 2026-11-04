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
