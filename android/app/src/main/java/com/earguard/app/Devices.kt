package com.earguard.app

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build

/** What the phone's sound is currently going to. */
data class OutputInfo(
    val name: String,
    val typeLabel: String,
    /** Counted toward the listening dose: Bluetooth, wired, USB headsets and hearing aids. */
    val isHeadphones: Boolean,
    /** Bluetooth is in call mode (SCO): the music will sound quiet and "phone-like". */
    val callMode: Boolean,
    val volume: Double, // 0…1 of the music stream
    val volumeIndex: Int,
    val volumeMax: Int,
    val muted: Boolean,
)

private const val TYPE_BLE_HEADSET = 26 // API 31; written as a number so older compile targets don't matter

private fun typeLabel(t: Int): String = when (t) {
    AudioDeviceInfo.TYPE_BLUETOOTH_A2DP -> "Bluetooth"
    AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "Bluetooth (call mode)"
    TYPE_BLE_HEADSET -> "Bluetooth LE"
    AudioDeviceInfo.TYPE_WIRED_HEADPHONES -> "wired headphones"
    AudioDeviceInfo.TYPE_WIRED_HEADSET -> "wired headset"
    AudioDeviceInfo.TYPE_USB_HEADSET -> "USB headset"
    AudioDeviceInfo.TYPE_USB_DEVICE, AudioDeviceInfo.TYPE_USB_ACCESSORY -> "USB"
    AudioDeviceInfo.TYPE_HEARING_AID -> "hearing aid"
    AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "phone speaker"
    AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "phone earpiece"
    AudioDeviceInfo.TYPE_HDMI -> "HDMI"
    else -> "type $t"
}

private val HEADPHONE_TYPES = setOf(
    AudioDeviceInfo.TYPE_BLUETOOTH_A2DP, AudioDeviceInfo.TYPE_BLUETOOTH_SCO, TYPE_BLE_HEADSET,
    AudioDeviceInfo.TYPE_WIRED_HEADPHONES, AudioDeviceInfo.TYPE_WIRED_HEADSET,
    AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_HEARING_AID,
)

fun readOutput(ctx: Context): OutputInfo {
    val am = ctx.getSystemService(AudioManager::class.java)
    // API 33+ tells us the device the music is really routed to; older versions only list what's connected.
    val routed: List<AudioDeviceInfo> =
        if (Build.VERSION.SDK_INT >= 33) {
            am.getAudioDevicesForAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).build())
        } else {
            am.getDevices(AudioManager.GET_DEVICES_OUTPUTS).toList()
        }
    // Prefer a headphone-like device if one is present (loud side: it is the one that counts).
    val d = routed.firstOrNull { it.type in HEADPHONE_TYPES } ?: routed.firstOrNull()
    val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
    val idx = am.getStreamVolume(AudioManager.STREAM_MUSIC)
    return OutputInfo(
        name = d?.productName?.toString()?.takeIf { it.isNotBlank() } ?: "Unknown",
        typeLabel = d?.let { typeLabel(it.type) } ?: "no output",
        isHeadphones = d != null && d.type in HEADPHONE_TYPES,
        callMode = d?.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
        volume = idx.toDouble() / max,
        volumeIndex = idx,
        volumeMax = max,
        muted = am.isStreamMute(AudioManager.STREAM_MUSIC),
    )
}

/** Every output the phone currently sees (for the spike log). */
fun listOutputs(ctx: Context): List<String> =
    ctx.getSystemService(AudioManager::class.java).getDevices(AudioManager.GET_DEVICES_OUTPUTS)
        .map { "${it.productName} — ${typeLabel(it.type)}" }
