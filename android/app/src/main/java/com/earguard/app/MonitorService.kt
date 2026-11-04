package com.earguard.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import com.earguard.core.DoseMode
import com.earguard.core.DoseStore
import com.earguard.core.LevelMeter
import com.earguard.core.estimateLevel
import com.earguard.core.exposurePa2h
import com.earguard.core.weeklyDoseFraction
import kotlin.concurrent.thread

/**
 * Captures the sound other apps play (Android 10+ AudioPlaybackCapture, with the user's one-time screen-capture
 * consent), measures it, estimates the level at the ear and keeps a listening dose. All on this phone.
 */
class MonitorService : Service() {
    private var projection: MediaProjection? = null
    private var record: AudioRecord? = null
    private var meter: LevelMeter? = null
    @Volatile private var capturing = false
    private val handler = Handler(Looper.getMainLooper())
    private var lastTick = 0L
    private var silentSeconds = 0
    private var store: DoseStore = DoseStore()
    private var lastSave = 0L

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (capturing) return START_NOT_STICKY
        val code = intent?.getIntExtra(EXTRA_CODE, 0) ?: 0
        @Suppress("DEPRECATION")
        val data: Intent? = intent?.getParcelableExtra(EXTRA_DATA)
        if (data == null) {
            stopSelf()
            return START_NOT_STICKY
        }

        // Must be in the foreground before touching the projection (Android 14).
        startAsForeground("Starting…")
        store = DoseStore.fromJson(getSharedPreferences("dose", MODE_PRIVATE).getString("json", null))
        MonitorState.clear()
        try {
            val mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            val p = mpm.getMediaProjection(code, data)
            p.registerCallback(object : MediaProjection.Callback() {
                override fun onStop() {
                    handler.post { stopSelf() }
                }
            }, handler)
            projection = p
            startCapture(p)
        } catch (e: Exception) {
            MonitorState.add("ERROR: ${e.message}")
            MonitorState.status = "Could not start: ${e.message}"
            stopSelf()
            return START_NOT_STICKY
        }

        MonitorState.running = true
        MonitorState.status = "Running"
        MonitorState.add("outputs: " + listOutputs(this).joinToString(" | "))
        lastTick = System.currentTimeMillis()
        lastSave = lastTick
        handler.postDelayed({ tick() }, 1000)
        return START_NOT_STICKY
    }

    private fun startCapture(p: MediaProjection) {
        val cfg = AudioPlaybackCaptureConfiguration.Builder(p)
            .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
            .addMatchingUsage(AudioAttributes.USAGE_GAME)
            .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
            .build()
        val rate = 48000
        val fmt = AudioFormat.Builder()
            .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
            .setSampleRate(rate)
            .setChannelMask(AudioFormat.CHANNEL_IN_STEREO)
            .build()
        val minBuf = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_STEREO, AudioFormat.ENCODING_PCM_FLOAT)
        val rec = AudioRecord.Builder()
            .setAudioPlaybackCaptureConfig(cfg)
            .setAudioFormat(fmt)
            .setBufferSizeInBytes(maxOf(minBuf, rate / 2 * 2 * 4))
            .build()
        val m = LevelMeter(rate.toDouble())
        meter = m
        record = rec
        rec.startRecording()
        capturing = true
        thread(name = "earguard-capture") {
            val buf = FloatArray(rate / 10 * 2)
            while (capturing) {
                val n = rec.read(buf, 0, buf.size, AudioRecord.READ_BLOCKING)
                if (n > 0) m.process(buf, n, 2) else if (n < 0) break
            }
        }
    }

    private fun tick() {
        if (!capturing) return
        val now = System.currentTimeMillis()
        val seconds = ((now - lastTick) / 1000.0).coerceIn(0.1, 5.0)
        lastTick = now
        val out = readOutput(this)
        val w = meter?.takeWindow()
        val vol = "vol ${out.volumeIndex}/${out.volumeMax}"
        val line: String
        var notif: String

        if (!out.isHeadphones) {
            line = "${out.name} [${out.typeLabel}] — not headphones, not counted"
            notif = "Not headphones — not tracked"
        } else if (out.muted || out.volume <= 0.0) {
            line = "${out.name} [${out.typeLabel}] $vol — muted"
            notif = "Muted"
        } else if (w == null || w.isSilent || !w.dbfsA.isFinite()) {
            silentSeconds++
            line = "${out.name} [${out.typeLabel}] $vol — no audio captured" +
                (if (silentSeconds > 15) " (the app playing may block capture)" else "")
            notif = "No sound playing"
        } else {
            silentSeconds = 0
            val est = estimateLevel(w.dbfsA, out.volume)
            if (!est.isReportable) {
                line = "${out.name} [${out.typeLabel}] $vol signal %.1f dBFS(A) — very quiet, not counted".format(w.dbfsA)
                notif = "Very quiet"
            } else {
                store.add(exposurePa2h(est.conservative, seconds), now / 1000)
                val mode = if (out.callMode) " CALL MODE" else ""
                line = "${out.name} [${out.typeLabel}$mode] $vol signal %.1f dBFS (%.1f A-wtd) peak %.2f → ≈%.0f dB(A) (%.0f–%.0f)"
                    .format(w.dbfs, w.dbfsA, w.peak, est.dbA, est.low, est.high)
                notif = "≈%.0f dB(A) at your ears (rough estimate)".format(est.dbA)
            }
        }
        val week = weeklyDoseFraction(store.weekPa2h(now / 1000), DoseMode.STANDARD)
        MonitorState.add(line)
        MonitorState.status = "Running — last 7 days: %.1f %% of the weekly limit".format(week * 100)
        if (out.callMode) notif = "Headphones are in call mode. $notif"
        updateNotification("$notif · week %.1f %%".format(week * 100))

        if (now - lastSave > 30_000) {
            save(now)
            lastSave = now
        }
        handler.postDelayed({ tick() }, 1000)
    }

    private fun save(nowMs: Long) {
        getSharedPreferences("dose", MODE_PRIVATE).edit().putString("json", store.toJson(nowMs / 1000)).apply()
    }

    override fun onDestroy() {
        capturing = false
        handler.removeCallbacksAndMessages(null)
        try { record?.stop() } catch (_: Exception) {}
        record?.release()
        projection?.stop()
        save(System.currentTimeMillis())
        MonitorState.running = false
        MonitorState.status = "Stopped"
        super.onDestroy()
    }

    /* ---- notification ---- */

    private fun channel(): String {
        val nm = getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Live level", NotificationManager.IMPORTANCE_LOW))
        }
        return CHANNEL
    }

    private fun build(text: String): Notification =
        Notification.Builder(this, channel())
            .setContentTitle("EarGuard")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_lock_silent_mode_off)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()

    private fun startAsForeground(text: String) {
        val n = build(text)
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        else startForeground(NOTIF_ID, n)
    }

    private fun updateNotification(text: String) {
        getSystemService(NotificationManager::class.java).notify(NOTIF_ID, build(text))
    }

    companion object {
        const val ACTION_STOP = "com.earguard.app.STOP"
        const val EXTRA_CODE = "code"
        const val EXTRA_DATA = "data"
        private const val CHANNEL = "live-level"
        private const val NOTIF_ID = 1
    }
}
