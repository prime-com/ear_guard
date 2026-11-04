import Foundation

/// Rolling record of listening energy in 15-minute buckets, kept on this Mac only.
public final class DoseStore {
    public static let bucketSeconds = 900
    private let lock = NSLock()
    private var buckets: [Int: Double] = [:] // epoch/900 → Pa²·h
    private let url: URL?

    public init(url: URL? = nil) {
        self.url = url
        if let url, let data = try? Data(contentsOf: url),
           let decoded = try? JSONDecoder().decode([String: Double].self, from: data) {
            for (k, v) in decoded { if let key = Int(k) { buckets[key] = v } }
        }
    }

    public static func defaultURL() -> URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("EarGuard", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("dose.json")
    }

    private func key(_ date: Date) -> Int { Int(date.timeIntervalSince1970) / Self.bucketSeconds }

    public func add(pa2h: Double, at date: Date) {
        lock.lock(); defer { lock.unlock() }
        buckets[key(date), default: 0] += pa2h
    }

    /// Energy since `start` (bucket granularity).
    public func pa2h(since start: Date, now: Date = Date()) -> Double {
        lock.lock(); defer { lock.unlock() }
        let from = key(start), to = key(now)
        return buckets.reduce(0) { $1.key >= from && $1.key <= to ? $0 + $1.value : $0 }
    }

    public func weekPa2h(now: Date = Date()) -> Double { pa2h(since: now.addingTimeInterval(-7 * 86400), now: now) }

    public func todayPa2h(now: Date = Date(), calendar: Calendar = .current) -> Double {
        pa2h(since: calendar.startOfDay(for: now), now: now)
    }

    public func save(now: Date = Date()) {
        guard let url else { return }
        lock.lock()
        let cutoff = key(now.addingTimeInterval(-8 * 86400))
        buckets = buckets.filter { $0.key >= cutoff }
        let out = Dictionary(uniqueKeysWithValues: buckets.map { (String($0.key), $0.value) })
        lock.unlock()
        if let data = try? JSONEncoder().encode(out) { try? data.write(to: url, options: .atomic) }
    }
}
