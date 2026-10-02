package expo.modules.lumenwidgets

import org.json.JSONException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class WidgetViewTest {
    private val palette = """{"surface":"#141925","line":"#262E40","text":"#F3F5F9","textDim":"#A7AFBF","accentFill":"#2EC4B6","onAccentFill":"#0B0E14"}"""
    private val display =
        """{"name":"Lumen","status":{"regular":"Up to date","check-again":"Check again tonight","see-doctor":"Doctor visit suggested","inconclusive":"Check again tonight"},""" +
            """"lastCheck":"Last check {{hours}} h ago","bpm":"bpm","streak":"streak {{days}} days","checkNow":"Check now","fullScan":"Full Scan",""" +
            """"palette":{"light":$palette,"dark":$palette}}"""

    // 2026-10-04T07:41:58Z, the Appendix B example time.
    private val readingMs = 1_791_099_718_000L

    private fun snapshot(
        status: String = "\"regular\"",
        lastReadingAt: String = "\"2026-10-04T07:41:58Z\"",
        hrBpm: String = "64",
        hideValues: Boolean = false,
        streakDays: Int = 5,
    ) = """{"v":1,"updatedAt":"2026-10-04T07:42:10Z","lastReadingAt":$lastReadingAt,"status":$status,"hrBpm":$hrBpm,""" +
        """"rhythmFlag":false,"diabetesFlag":false,"nextConfirmationAt":null,"streakDays":$streakDays,"hideValues":$hideValues,"theme":"system"}"""

    @Test
    fun parsesAppendixBTimes() {
        assertEquals(readingMs, parseUtcSeconds("2026-10-04T07:41:58Z"))
    }

    @Test
    fun showsTheLatestReadingWithLocalizedCopy() {
        val view = widgetView(snapshot(), display, readingMs + 2 * 3_600_000L + 59_000L)
        assertEquals("Up to date", view.status)
        assertEquals("Last check 2 h ago", view.lastCheck)
        assertEquals("64", view.bpm)
        assertEquals("streak 5 days", view.streak)
        assertEquals("system", view.theme)
        assertEquals(0xFF2EC4B6L, view.dark.accentFill)
    }

    @Test
    fun mapsEveryStatusThroughTheDisplayCopy() {
        val labels = listOf("regular", "check-again", "see-doctor", "inconclusive").map { status ->
            widgetView(snapshot(status = "\"$status\""), display, readingMs).status
        }
        assertEquals(listOf("Up to date", "Check again tonight", "Doctor visit suggested", "Check again tonight"), labels)
    }

    @Test
    fun handlesTheNoReadingYetSnapshot() {
        val view = widgetView(snapshot(status = "null", lastReadingAt = "null", hrBpm = "null", streakDays = 0), display, readingMs)
        assertNull(view.status)
        assertNull(view.lastCheck)
        assertNull(view.bpm)
        assertNull(view.streak)
        assertEquals("Check now", view.checkNow)
        assertEquals("Full Scan", view.fullScan)
    }

    @Test
    fun neverShowsAHiddenValue() {
        assertNull(widgetView(snapshot(hideValues = true), display, readingMs).bpm)
        assertNull(widgetView(snapshot(hrBpm = "null"), display, readingMs).bpm)
    }

    @Test
    fun clampsAClockThatRunsBehindTheReadingToZeroHours() {
        assertEquals("Last check 0 h ago", widgetView(snapshot(), display, readingMs - 60_000L).lastCheck)
    }

    @Test
    fun rejectsAnUnknownStatusOrABadColor() {
        assertThrows(JSONException::class.java) { widgetView(snapshot(status = "\"afib\""), display, readingMs) }
        assertThrows(IllegalArgumentException::class.java) { parseColor("#000000A3") }
    }
}
