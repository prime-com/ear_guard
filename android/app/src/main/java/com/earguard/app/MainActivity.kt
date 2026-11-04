package com.earguard.app

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Typeface
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.core.content.ContextCompat

class MainActivity : Activity() {
    private lateinit var status: TextView
    private lateinit var log: TextView
    private lateinit var toggle: Button
    private val handler = Handler(Looper.getMainLooper())

    private val refresh = object : Runnable {
        override fun run() {
            status.text = MonitorState.status
            toggle.text = if (MonitorState.running) "Stop" else "Start monitoring"
            log.text = MonitorState.lines().joinToString("\n\n")
            handler.postDelayed(this, 1000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pad = (16 * resources.displayMetrics.density).toInt()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad * 2, pad, pad)
        }

        root.addView(TextView(this).apply {
            text = "EarGuard"
            textSize = 26f
            setTypeface(null, Typeface.BOLD)
        })
        root.addView(TextView(this).apply {
            text = "Test version — a rough estimate, not a measurement. It listens to what your phone plays (never records " +
                "or uploads it), combines that with the volume and an assumed headphone loudness (100 dB ± 10), and reads " +
                "LOUD when unsure."
            textSize = 13f
        })
        status = TextView(this).apply {
            text = MonitorState.status
            textSize = 16f
            setPadding(0, pad, 0, pad)
        }
        root.addView(status)

        toggle = Button(this).apply {
            text = "Start monitoring"
            setOnClickListener { onToggle() }
        }
        root.addView(toggle)
        root.addView(Button(this).apply {
            text = "Share log"
            setOnClickListener { shareLog() }
        })

        log = TextView(this).apply {
            textSize = 12f
            typeface = Typeface.MONOSPACE
            setPadding(0, pad, 0, 0)
        }
        root.addView(ScrollView(this).apply { addView(log) }, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(root)
    }

    override fun onResume() {
        super.onResume()
        handler.post(refresh)
    }

    override fun onPause() {
        handler.removeCallbacks(refresh)
        super.onPause()
    }

    private fun onToggle() {
        if (MonitorState.running) {
            startService(Intent(this, MonitorService::class.java).setAction(MonitorService.ACTION_STOP))
            return
        }
        val need = buildList {
            add(Manifest.permission.RECORD_AUDIO)
            if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
        }.filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
        if (need.isNotEmpty()) requestPermissions(need.toTypedArray(), REQ_PERMS) else askCapture()
    }

    @Deprecated("Deprecated in Java")
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        if (requestCode != REQ_PERMS) return
        // Notifications are optional; the microphone permission is required (Android needs it for playback capture).
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) askCapture()
        else MonitorState.status = "Microphone permission is required by Android to capture playback (nothing is recorded)."
    }

    private fun askCapture() {
        val mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        @Suppress("DEPRECATION")
        startActivityForResult(mpm.createScreenCaptureIntent(), REQ_CAPTURE)
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQ_CAPTURE) return
        if (resultCode == RESULT_OK && data != null) {
            ContextCompat.startForegroundService(
                this,
                Intent(this, MonitorService::class.java)
                    .putExtra(MonitorService.EXTRA_CODE, resultCode)
                    .putExtra(MonitorService.EXTRA_DATA, data),
            )
        } else {
            MonitorState.status = "Capture permission was declined."
        }
    }

    private fun shareLog() {
        val header = "EarGuard Android log (${Build.MANUFACTURER} ${Build.MODEL}, Android ${Build.VERSION.RELEASE} / API ${Build.VERSION.SDK_INT})"
        startActivity(
            Intent.createChooser(
                Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, header + "\n\n" + MonitorState.all()),
                "Share log",
            ),
        )
    }

    companion object {
        private const val REQ_PERMS = 1
        private const val REQ_CAPTURE = 2
    }
}
