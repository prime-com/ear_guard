package com.earguard.core

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.log10
import kotlin.math.sin

class CoreTest {
    private val vectors: JSONObject by lazy {
        // Gradle runs unit tests with the module directory (android/app) as the working directory.
        val f = listOf("../../test-vectors/core.json", "../test-vectors/core.json", "test-vectors/core.json").map(::File).first { it.exists() }
        JSONObject(f.readText())
    }

    private fun rows(k: String) = vectors.getJSONArray(k).let { a -> List(a.length()) { a.getJSONObject(it) } }
    private fun mode(s: String) = if (s == "standard") DoseMode.STANDARD else DoseMode.SENSITIVE

    @Test fun sharedVectors() {
        rows("dbToPa2").forEach { assertEquals(it.getDouble("pa2"), dbToPa2(it.getDouble("db")), 1e-12) }
        rows("exposurePa2h").forEach { assertEquals(it.getDouble("pa2h"), exposurePa2h(it.getDouble("db"), it.getDouble("seconds")), 1e-9) }
        rows("weeklyDoseFraction").forEach { assertEquals(it.getDouble("fraction"), weeklyDoseFraction(it.getDouble("pa2h"), mode(it.getString("mode"))), 1e-9) }
        rows("allowedHoursPerWeek").forEach { assertEquals(it.getDouble("hours"), allowedHoursPerWeek(it.getDouble("db"), mode(it.getString("mode"))), 1e-6) }
        rows("earLevelDb").forEach { assertEquals(it.getDouble("db"), earLevelDb(it.getDouble("signalDbA"), it.getDouble("volumeDb"), it.getDouble("sDevice")), 1e-9) }
        rows("rmsToDbfs").forEach { assertEquals(it.getDouble("dbfs"), rmsToDbfs(it.getDouble("rms")), 1e-9) }
    }

    @Test fun whoLimit() {
        assertEquals(1.0, weeklyDoseFraction(exposurePa2h(80.0, 40 * 3600.0)), 0.01)
        assertEquals(0.5, allowedHoursPerWeek(83.0) / allowedHoursPerWeek(80.0), 0.01)
    }

    @Test fun aWeightingMatchesIec61672() {
        val aw = AWeightingFilter(48000.0)
        listOf(31.5 to -39.4, 63.0 to -26.2, 125.0 to -16.1, 250.0 to -8.6, 500.0 to -3.2, 1000.0 to 0.0, 2000.0 to 1.2, 4000.0 to 1.0, 8000.0 to -1.1)
            .forEach { (f, want) -> assertEquals("A-weighting @$f Hz", want, aw.responseDb(f), 0.7) }
    }

    private fun sine(freq: Double, amp: Float, seconds: Double = 2.0, ch: Int = 2, sr: Double = 48000.0): FloatArray {
        val n = (sr * seconds).toInt()
        return FloatArray(n * ch) { i -> amp * sin(2 * PI * freq * (i / ch) / sr).toFloat() }
    }

    @Test fun meterReadsFullScaleSineAsZeroDbfs() {
        val m = LevelMeter(48000.0)
        val b = sine(1000.0, 1f)
        m.process(b, b.size, 2)
        val w = m.takeWindow()!!
        assertEquals(0.0, w.dbfs, 0.05)
        assertEquals(0.0, w.dbfsA, 0.3)
        val b2 = sine(100.0, 1f)
        m.process(b2, b2.size, 2)
        val w2 = m.takeWindow()!!
        assertEquals(-19.1, w2.dbfsA - w2.dbfs, 0.7)
    }

    @Test fun louderChannelWinsAndWindowResets() {
        val m = LevelMeter(48000.0)
        val n = 48000
        val b = FloatArray(n * 2) { i -> (if (i % 2 == 0) 0.1f else 0.5f) * sin(2 * PI * 1000 * (i / 2) / 48000.0).toFloat() }
        m.process(b, b.size, 2)
        assertEquals(20 * log10(0.5), m.takeWindow()!!.dbfs, 0.1)
        assertNull(m.takeWindow())
        m.process(FloatArray(4800), 4800, 2)
        assertTrue(m.takeWindow()!!.isSilent)
    }

    @Test fun estimateLeansLoudAndNeverReportsQuietAsALevel() {
        val e = estimateLevel(-15.0, 0.5)
        assertEquals(-15 + 20 * log10(0.5) + 100, e.dbA, 1e-9)
        assertEquals(kotlin.math.sqrt(10.0 * 10 + 6.0 * 6), e.sigma, 1e-9)
        assertTrue(e.conservative > e.dbA)
        assertFalse(estimateLevel(-15.0, 0.0).isReportable)
        assertFalse(estimateLevel(-100.0, 1.0).isReportable)
        assertFalse(estimateLevel(Double.NEGATIVE_INFINITY, 1.0).isReportable)
        assertTrue(estimateLevel(-15.0, 0.5).isReportable)
        assertTrue(volumeDb(0.0) <= -100)
        assertTrue(abs(volumeDb(1.0)) < 1e-12)
    }

    @Test fun doseStoreRollingWeekAndPersistence() {
        val now = 1_800_000_000L
        val s = DoseStore()
        s.add(0.5, now - 3600)
        s.add(0.25, now - 3 * 86400)
        s.add(9.0, now - 10 * 86400) // outside the week
        assertEquals(0.75, s.weekPa2h(now), 1e-9)
        assertEquals(0.75, DoseStore.fromJson(s.toJson(now)).weekPa2h(now), 1e-9)
        assertEquals(0.0, DoseStore.fromJson("not json").weekPa2h(now), 0.0)
    }
}
