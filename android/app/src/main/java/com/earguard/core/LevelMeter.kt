package com.earguard.core

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.sqrt

/**
 * Accumulates A-weighted and plain levels from interleaved float audio, per channel.
 * Call [process] from the audio thread and [takeWindow] about once a second.
 */
class LevelMeter(private val sampleRate: Double) {
    data class Window(val dbfs: Double, val dbfsA: Double, val peak: Float, val frames: Int) {
        val isSilent: Boolean get() = peak == 0f
    }

    private var filters: List<AWeightingFilter> = emptyList()
    private var sumSq = DoubleArray(0)
    private var sumSqA = DoubleArray(0)
    private var frames = 0
    private var peak = 0f
    private var channels = 0

    /** [samples]: interleaved float, [sampleCount] values in total (frames × [channelCount]). */
    @Synchronized
    fun process(samples: FloatArray, sampleCount: Int, channelCount: Int) {
        if (channelCount != channels) {
            channels = channelCount
            filters = List(channelCount) { AWeightingFilter(sampleRate) }
            sumSq = DoubleArray(channelCount)
            sumSqA = DoubleArray(channelCount)
        }
        val frameCount = sampleCount / channelCount
        for (f in 0 until frameCount) {
            for (c in 0 until channelCount) {
                val x = samples[f * channelCount + c]
                val y = filters[c].process(x)
                sumSq[c] += x.toDouble() * x
                sumSqA[c] += y.toDouble() * y
                peak = max(peak, abs(x))
            }
        }
        frames += frameCount
    }

    /**
     * Returns the window since the last call and resets; null if no audio arrived.
     * Uses the LOUDER channel: each ear hears one channel, and "when unsure, read loud".
     */
    @Synchronized
    fun takeWindow(): Window? {
        if (frames == 0 || channels == 0) return null
        val n = frames.toDouble()
        val rms = sumSq.maxOf { sqrt(it / n) }
        val rmsA = sumSqA.maxOf { sqrt(it / n) }
        val w = Window(rmsToDbfs(rms), rmsToDbfs(rmsA), peak, frames)
        sumSq.fill(0.0); sumSqA.fill(0.0)
        frames = 0
        peak = 0f
        return w
    }
}
