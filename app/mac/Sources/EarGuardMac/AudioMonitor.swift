import CoreAudio
import EarGuardCore
import Foundation

/// Taps everything the Mac plays (before the volume is applied), measures it once a second,
/// and restarts itself when the default output device changes.
final class AudioMonitor {
    struct Reading {
        var output: OutputInfo
        var window: LevelMeter.Window?   // nil if no audio callbacks arrived
        var seconds: Double
    }

    var onReading: ((Reading) -> Void)?
    var onError: ((String) -> Void)?

    private var tapID = AudioObjectID(kAudioObjectUnknown)
    private var aggID = AudioObjectID(kAudioObjectUnknown)
    private var proc: AudioDeviceIOProcID?
    private var meter: LevelMeter?
    private var timer: DispatchSourceTimer?
    private var device = AudioObjectID(0)
    private var lastTick = Date()
    private var listenerInstalled = false

    func start() {
        stop()
        guard let dev = defaultOutputDevice() else { onError?("No sound output device."); return }
        device = dev
        let info = readOutputInfo(dev)
        do { try startTap(outputUID: info.uid) } catch { onError?("\(error)") }
        installListenerOnce()

        lastTick = Date()
        let t = DispatchSource.makeTimerSource(queue: .main)
        t.schedule(deadline: .now() + 1, repeating: 1)
        t.setEventHandler { [weak self] in self?.tick() }
        t.resume()
        timer = t
    }

    func stop() {
        timer?.cancel(); timer = nil
        if let proc, aggID != kAudioObjectUnknown {
            AudioDeviceStop(aggID, proc)
            AudioDeviceDestroyIOProcID(aggID, proc)
        }
        proc = nil
        if aggID != kAudioObjectUnknown { AudioHardwareDestroyAggregateDevice(aggID); aggID = AudioObjectID(kAudioObjectUnknown) }
        if tapID != kAudioObjectUnknown { AudioHardwareDestroyProcessTap(tapID); tapID = AudioObjectID(kAudioObjectUnknown) }
        meter = nil
    }

    private func tick() {
        let now = Date()
        let seconds = now.timeIntervalSince(lastTick)
        lastTick = now
        let info = readOutputInfo(device)
        onReading?(Reading(output: info, window: meter?.takeWindow(), seconds: seconds))
    }

    private func installListenerOnce() {
        guard !listenerInstalled else { return }
        listenerInstalled = true
        var a = addr(kAudioHardwarePropertyDefaultOutputDevice)
        AudioObjectAddPropertyListenerBlock(systemObject, &a, .main) { [weak self] _, _ in self?.start() }
    }

    private enum TapError: Error, CustomStringConvertible {
        case failed(String, OSStatus)
        var description: String { if case let .failed(what, st) = self { return "\(what) failed (status \(st))" } else { return "" } }
    }

    private func startTap(outputUID: String) throws {
        let desc = CATapDescription(stereoGlobalTapButExcludeProcesses: [])
        desc.name = "EarGuard"
        desc.isPrivate = true
        desc.muteBehavior = .unmuted
        var st = AudioHardwareCreateProcessTap(desc, &tapID)
        guard st == noErr else { throw TapError.failed("Creating the audio tap", st) }

        var agg: [String: Any] = [
            kAudioAggregateDeviceNameKey: "EarGuardTap",
            kAudioAggregateDeviceUIDKey: UUID().uuidString,
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false,
            kAudioAggregateDeviceTapAutoStartKey: true,
            kAudioAggregateDeviceTapListKey: [[kAudioSubTapUIDKey: desc.uuid.uuidString, kAudioSubTapDriftCompensationKey: true]],
        ]
        // Keep Bluetooth devices out of the aggregate (see ClockMode).
        let clockUID: String?
        switch ClockMode.current {
        case .builtin: clockUID = builtInOutputUID()
        case .output: clockUID = outputUID
        case .none: clockUID = nil
        }
        if let clockUID {
            agg[kAudioAggregateDeviceMainSubDeviceKey] = clockUID
            agg[kAudioAggregateDeviceSubDeviceListKey] = [[kAudioSubDeviceUIDKey: clockUID]]
        }
        print("tap clock: \(ClockMode.current.rawValue) \(clockUID ?? "(none)")")
        st = AudioHardwareCreateAggregateDevice(agg as CFDictionary, &aggID)
        guard st == noErr else { throw TapError.failed("Creating the aggregate device", st) }

        let format = getProperty(tapID, addr(kAudioTapPropertyFormat), AudioStreamBasicDescription())
        let m = LevelMeter(sampleRate: format?.mSampleRate ?? 48000)
        meter = m

        st = AudioDeviceCreateIOProcIDWithBlock(&proc, aggID, DispatchQueue(label: "earguard.io")) { _, inData, _, _, _ in
            let bufs = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: inData))
            // The tap delivers interleaved Float32 (format flags 9). Anything else is ignored.
            guard bufs.count == 1, let b = bufs.first, let d = b.mData else { return }
            let ch = Int(b.mNumberChannels)
            guard ch > 0 else { return }
            let frames = Int(b.mDataByteSize) / (MemoryLayout<Float>.size * ch)
            m.process(d.assumingMemoryBound(to: Float.self), frameCount: frames, channelCount: ch)
        }
        guard st == noErr, let proc else { throw TapError.failed("Creating the audio callback", st) }
        st = AudioDeviceStart(aggID, proc)
        guard st == noErr else { throw TapError.failed("Starting audio capture", st) }
    }
}
