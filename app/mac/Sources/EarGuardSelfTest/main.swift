import EarGuardCore
import Foundation

var failures = 0
var checks = 0
func expect(_ cond: Bool, _ msg: @autoclosure () -> String) {
    checks += 1
    if !cond { failures += 1; print("FAIL: \(msg())") }
}
func near(_ a: Double, _ b: Double, _ tol: Double, _ what: String) {
    expect(abs(a - b) <= tol || (a.isInfinite && b.isInfinite && a == b), "\(what): got \(a), want \(b) ±\(tol)")
}

// ---- shared test vectors (generated from the TypeScript implementation) ----
let vectorsPath = CommandLine.arguments.dropFirst().first ?? "../../test-vectors/core.json"
let root = try! JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: vectorsPath))) as! [String: Any]
func rows(_ k: String) -> [[String: Any]] { root[k] as! [[String: Any]] }
func d(_ r: [String: Any], _ k: String) -> Double { (r[k] as! NSNumber).doubleValue }
func mode(_ r: [String: Any]) -> DoseMode { DoseMode(rawValue: r["mode"] as! String)! }

for r in rows("dbToPa2") { near(dbToPa2(d(r, "db")), d(r, "pa2"), 1e-12, "dbToPa2(\(d(r, "db")))") }
for r in rows("exposurePa2h") { near(exposurePa2h(db: d(r, "db"), seconds: d(r, "seconds")), d(r, "pa2h"), 1e-9, "exposure") }
for r in rows("weeklyDoseFraction") { near(weeklyDoseFraction(pa2h: d(r, "pa2h"), mode: mode(r)), d(r, "fraction"), 1e-9, "dose fraction") }
for r in rows("allowedHoursPerWeek") { near(allowedHoursPerWeek(db: d(r, "db"), mode: mode(r)), d(r, "hours"), 1e-6, "allowed hours") }
for r in rows("earLevelDb") { near(earLevelDb(signalDbA: d(r, "signalDbA"), volumeDb: d(r, "volumeDb"), sDevice: d(r, "sDevice")), d(r, "db"), 1e-9, "earLevel") }
for r in rows("rmsToDbfs") { near(rmsToDbfs(d(r, "rms")), d(r, "dbfs"), 1e-9, "rmsToDbfs") }

// ---- WHO / ITU-T H.870 sanity: 80 dB(A) for 40 h = 100 %, +3 dB halves the time ----
near(weeklyDoseFraction(pa2h: exposurePa2h(db: 80, seconds: 40 * 3600)), 1, 0.01, "80 dB x 40 h = 100%")
near(allowedHoursPerWeek(db: 83) / allowedHoursPerWeek(db: 80), 0.5, 0.01, "+3 dB halves")

// ---- A-weighting vs IEC 61672 nominal values (dB) at 48 kHz ----
let aw = AWeightingFilter(sampleRate: 48000)
let nominal: [(Double, Double)] = [(31.5, -39.4), (63, -26.2), (125, -16.1), (250, -8.6), (500, -3.2),
                                   (1000, 0.0), (2000, 1.2), (4000, 1.0), (8000, -1.1)]
for (f, want) in nominal { near(aw.responseDb(at: f), want, 0.7, "A-weighting @\(f) Hz") }

// ---- measured through the filter with a real signal: 1 kHz sine 0 dBFS reads 0 dBFS(A) ----
let sr = 48000.0
let meter = LevelMeter(sampleRate: sr)
func sineBlock(freq: Double, amp: Float, seconds: Double = 2, ch: Int = 2) -> [Float] {
    let n = Int(sr * seconds)
    var out = [Float](repeating: 0, count: n * ch)
    for i in 0..<n { let v = amp * Float(sin(2 * Double.pi * freq * Double(i) / sr)); for c in 0..<ch { out[i * ch + c] = v } }
    return out
}
var blk = sineBlock(freq: 1000, amp: 1)
blk.withUnsafeBufferPointer { meter.process($0.baseAddress!, frameCount: blk.count / 2, channelCount: 2) }
var w = meter.takeWindow()!
near(w.dbfs, 0, 0.05, "1 kHz full-scale sine = 0 dBFS")
near(w.dbfsA, 0, 0.3, "1 kHz sine A-weighted ≈ 0")
blk = sineBlock(freq: 100, amp: 1)
blk.withUnsafeBufferPointer { meter.process($0.baseAddress!, frameCount: blk.count / 2, channelCount: 2) }
w = meter.takeWindow()!
near(w.dbfsA - w.dbfs, -19.1, 0.7, "100 Hz is ~19 dB down when A-weighted")

// loudest channel wins (safety: read loud)
var stereo = [Float](repeating: 0, count: Int(sr) * 2)
for i in 0..<Int(sr) { let v = Float(sin(2 * Double.pi * 1000 * Double(i) / sr)); stereo[i * 2] = 0.1 * v; stereo[i * 2 + 1] = 0.5 * v }
stereo.withUnsafeBufferPointer { meter.process($0.baseAddress!, frameCount: Int(sr), channelCount: 2) }
w = meter.takeWindow()!
near(w.dbfs, 20 * log10(0.5), 0.1, "louder channel used")
expect(meter.takeWindow() == nil, "window resets after take")
var silence = [Float](repeating: 0, count: 4800)
silence.withUnsafeBufferPointer { meter.process($0.baseAddress!, frameCount: 2400, channelCount: 2) }
expect(meter.takeWindow()!.isSilent, "silence detected")

// ---- estimate: leans loud and carries uncertainty ----
let e = estimateLevel(signalDbA: -15, volumeScalar: 0.5)
near(e.dbA, -15 + 20 * log10(0.5) + 100, 1e-9, "estimate value")
near(e.sigma, (10.0 * 10 + 6 * 6).squareRoot(), 1e-9, "estimate sigma")
expect(e.conservative > e.dbA, "conservative value is above the estimate")
expect(estimateLevel(signalDbA: -15, volumeScalar: 1).dbA > estimateLevel(signalDbA: -15, volumeScalar: 0.25).dbA, "louder volume → higher level")
near(volumeDb(fromScalar: 1), 0, 1e-12, "max volume = 0 dB")
expect(volumeDb(fromScalar: 0) <= -100, "volume 0 = silence")

// ---- quiet / zero-volume never produces a negative or "reportable" level ----
expect(!estimateLevel(signalDbA: -15, volumeScalar: 0).isReportable, "slider at 0 is not reportable")
expect(estimateLevel(signalDbA: -15, volumeScalar: 0).dbA < 0, "(slider 0 really would be negative without the guard)")
expect(!estimateLevel(signalDbA: -100, volumeScalar: 1).isReportable, "near-silent signal is not reportable")
expect(!estimateLevel(signalDbA: -.infinity, volumeScalar: 1).isReportable, "−∞ signal is not reportable")
expect(estimateLevel(signalDbA: -15, volumeScalar: 0.5).isReportable, "normal listening is reportable")

// ---- dose store: rolling week, persistence ----
let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("earguard-selftest-\(UUID().uuidString).json")
let now = Date(timeIntervalSince1970: 1_800_000_000)
let store = DoseStore(url: tmp)
store.add(pa2h: 0.5, at: now.addingTimeInterval(-3600))
store.add(pa2h: 0.25, at: now.addingTimeInterval(-3 * 86400))
store.add(pa2h: 9.0, at: now.addingTimeInterval(-10 * 86400)) // outside the week
near(store.weekPa2h(now: now), 0.75, 1e-9, "week window excludes old energy")
store.save(now: now)
near(DoseStore(url: tmp).weekPa2h(now: now), 0.75, 1e-9, "persisted and reloaded")
try? FileManager.default.removeItem(at: tmp)

print(failures == 0 ? "OK — \(checks) checks passed" : "\(failures) of \(checks) checks FAILED")
exit(failures == 0 ? 0 : 1)
