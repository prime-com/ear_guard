package com.earguard.app

import java.util.concurrent.ConcurrentLinkedDeque

/** State shared between the capture service and the screen (same process). */
object MonitorState {
    @Volatile var running = false
    @Volatile var status = "Not running"
    private val log = ConcurrentLinkedDeque<String>()

    fun add(line: String) {
        log.addFirst(line)
        while (log.size > 200) log.removeLast()
    }

    fun lines(max: Int = 40): List<String> = log.take(max)
    fun all(): String = log.reversed().joinToString("\n")
    fun clear() = log.clear()
}
