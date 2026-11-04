import Foundation

/// A-weighting (IEC 61672) as three digital biquads, designed with the bilinear transform
/// and pre-warped pole frequencies, normalised to 0 dB at 1 kHz.
public final class AWeightingFilter {
    private struct Biquad {
        var b0 = 0.0, b1 = 0.0, b2 = 0.0, a1 = 0.0, a2 = 0.0
        var z1 = 0.0, z2 = 0.0
        mutating func process(_ x: Double) -> Double {
            let y = b0 * x + z1
            z1 = b1 * x - a1 * y + z2
            z2 = b2 * x - a2 * y
            return y
        }
        func magnitude(omega: Double) -> Double {
            // |H(e^{jω})| for the biquad
            let c1 = cos(omega), s1 = sin(omega), c2 = cos(2 * omega), s2 = sin(2 * omega)
            let nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2)
            let dr = 1 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2)
            return ((nr * nr + ni * ni) / (dr * dr + di * di)).squareRoot()
        }
    }

    private var sections: [Biquad]
    private let gain: Double
    public let sampleRate: Double

    public init(sampleRate: Double) {
        self.sampleRate = sampleRate
        // IEC 61672 analog pole frequencies (Hz)
        let f1 = 20.598997, f2 = 107.65265, f3 = 737.86223, f4 = 12194.217
        let c = 2 * sampleRate
        // pre-warp so the poles land exactly in the digital domain
        func w(_ f: Double) -> Double { c * tan(2 * Double.pi * f / c) }
        let w1 = w(f1), w2 = w(f2), w3 = w(f3), w4 = w(f4)

        // analog sections (b2,b1,b0 / a2,a1,a0)
        let analog: [(Double, Double, Double, Double, Double, Double)] = [
            (1, 0, 0, 1, 2 * w1, w1 * w1),       // s² / (s+w1)²
            (1, 0, 0, 1, w2 + w3, w2 * w3),      // s² / ((s+w2)(s+w3))
            (0, 0, 1, 1, 2 * w4, w4 * w4),       // 1  / (s+w4)²
        ]
        func digital(_ s: (Double, Double, Double, Double, Double, Double)) -> Biquad {
            let (b2, b1, b0, a2, a1, a0) = s
            let c2 = c * c
            let n0 = b2 * c2 + b1 * c + b0, n1 = -2 * b2 * c2 + 2 * b0, n2 = b2 * c2 - b1 * c + b0
            let d0 = a2 * c2 + a1 * c + a0, d1 = -2 * a2 * c2 + 2 * a0, d2 = a2 * c2 - a1 * c + a0
            return Biquad(b0: n0 / d0, b1: n1 / d0, b2: n2 / d0, a1: d1 / d0, a2: d2 / d0)
        }
        sections = analog.map(digital)
        let omega1k = 2 * Double.pi * 1000 / sampleRate
        gain = 1 / sections.reduce(1.0) { $0 * $1.magnitude(omega: omega1k) }
    }

    public func process(_ x: Float) -> Float {
        var v = Double(x)
        for i in sections.indices { v = sections[i].process(v) }
        return Float(v * gain)
    }

    /// Filter gain in dB at `frequency` (for tests).
    public func responseDb(at frequency: Double) -> Double {
        let omega = 2 * Double.pi * frequency / sampleRate
        return 20 * log10(gain * sections.reduce(1.0) { $0 * $1.magnitude(omega: omega) })
    }
}
