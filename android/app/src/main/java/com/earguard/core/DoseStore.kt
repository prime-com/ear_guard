package com.earguard.core

import org.json.JSONObject

/** Rolling record of listening energy in 15-minute buckets. Pure; persistence is done by the caller via [toJson]/[fromJson]. */
class DoseStore(private val buckets: MutableMap<Long, Double> = mutableMapOf()) {
    companion object {
        const val BUCKET_SECONDS = 900L

        fun fromJson(json: String?): DoseStore {
            val m = mutableMapOf<Long, Double>()
            if (!json.isNullOrBlank()) {
                try {
                    val o = JSONObject(json)
                    for (k in o.keys()) k.toLongOrNull()?.let { m[it] = o.getDouble(k) }
                } catch (_: Exception) { /* corrupt data: start fresh */ }
            }
            return DoseStore(m)
        }
    }

    private fun key(epochSeconds: Long) = epochSeconds / BUCKET_SECONDS

    @Synchronized
    fun add(pa2h: Double, epochSeconds: Long) {
        buckets[key(epochSeconds)] = (buckets[key(epochSeconds)] ?: 0.0) + pa2h
    }

    /** Energy since [startEpoch] up to [nowEpoch] (bucket granularity). */
    @Synchronized
    fun pa2hSince(startEpoch: Long, nowEpoch: Long): Double {
        val from = key(startEpoch); val to = key(nowEpoch)
        return buckets.entries.filter { it.key in from..to }.sumOf { it.value }
    }

    fun weekPa2h(nowEpoch: Long) = pa2hSince(nowEpoch - 7 * 86400, nowEpoch)

    @Synchronized
    fun toJson(nowEpoch: Long): String {
        val cutoff = key(nowEpoch - 8 * 86400)
        buckets.keys.removeAll { it < cutoff }
        val o = JSONObject()
        for ((k, v) in buckets) o.put(k.toString(), v)
        return o.toString()
    }
}
