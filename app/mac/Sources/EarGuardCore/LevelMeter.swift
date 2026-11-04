import Foundation

/// Accumulates A-weighted and plain levels from interleaved float audio, per channel.
/// Call `process` from the audio thread and `takeWindow` ~once a second.
public final class LevelMeter {
    public struct Window {
        public var dbfs: Double       // unweighted, loudest channel (AES17)
        public var dbfsA: Double      // A-weighted, loudest channel (AES17)
        public var peak: Float
        public var frames: Int
        public var isSilent: Bool { peak == 0 }
    }

    private let lock = NSLock()
    private var filters: [AWeightingFilter] = []
    private var sumSq: [Double] = []
    private var sumSqA: [Double] = []
    private var frames = 0
    private var peak: Float = 0
    private let sampleRate: Double
    private var channels = 0

    public init(sampleRate: Double) { self.sampleRate = sampleRate }

    /// `samples`: interleaved Float32, `frameCount` frames of `channelCount` channels.
    public func process(_ samples: UnsafePointer<Float>, frameCount: Int, channelCount: Int) {
        lock.lock(); defer { lock.unlock() }
        if channelCount != channels {
            channels = channelCount
            filters = (0..<channelCount).map { _ in AWeightingFilter(sampleRate: sampleRate) }
            sumSq = Array(repeating: 0, count: channelCount)
            sumSqA = Array(repeating: 0, count: channelCount)
        }
        for f in 0..<frameCount {
            for c in 0..<channelCount {
                let x = samples[f * channelCount + c]
                let y = filters[c].process(x)
                sumSq[c] += Double(x) * Double(x)
                sumSqA[c] += Double(y) * Double(y)
                peak = max(peak, abs(x))
            }
        }
        frames += frameCount
    }

    /// Returns the window since the last call and resets. nil if no audio arrived.
    ///
    /// Uses the LOUDER channel: each ear hears one channel, and "when unsure, read loud".
    public func takeWindow() -> Window? {
        lock.lock(); defer { lock.unlock() }
        guard frames > 0, channels > 0 else { return nil }
        let n = Double(frames)
        let rms = sumSq.map { ($0 / n).squareRoot() }.max() ?? 0
        let rmsA = sumSqA.map { ($0 / n).squareRoot() }.max() ?? 0
        let w = Window(dbfs: rmsToDbfs(rms), dbfsA: rmsToDbfs(rmsA), peak: peak, frames: frames)
        for i in sumSq.indices { sumSq[i] = 0; sumSqA[i] = 0 }
        frames = 0
        peak = 0
        return w
    }
}
