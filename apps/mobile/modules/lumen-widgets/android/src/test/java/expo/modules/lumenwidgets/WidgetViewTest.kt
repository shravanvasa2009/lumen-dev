package expo.modules.lumenwidgets

import org.json.JSONException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class WidgetViewTest {
    @Test
    fun parsesAppendixBTimes() {
        assertEquals(TEST_READING_MS, parseUtcSeconds("2026-10-04T07:41:58Z"))
    }

    @Test
    fun showsTheLatestReadingWithLocalizedCopy() {
        val view = widgetView(testSnapshot(), TEST_DISPLAY, TEST_READING_MS + 2 * 3_600_000L + 59_000L)
        assertEquals("regular", view.statusKey)
        assertEquals("Up to date", view.status)
        assertEquals("Last check 2 h ago", view.lastCheck)
        assertEquals("64", view.bpm)
        assertEquals("streak 5 days", view.streak)
        assertEquals("No checks yet", view.emptyTitle)
        assertEquals("Takes 90 seconds", view.emptyBody)
        assertEquals("system", view.theme)
        assertEquals(0xFF2EC4B6L, view.dark.accentFill)
        assertEquals(0xFFF87171L, view.dark.criticalText)
        assertEquals(0xFF272B36L, view.dark.badgeExperimentalBg)
        assertEquals(emptyList<String>(), view.checks)
        assertEquals(null, view.diabetesTag)
    }

    @Test
    fun readsTheFourChecksAndTheDiabetesTag() {
        val view = widgetView(testSnapshot(), testDisplayWithChecks(), TEST_READING_MS)
        assertEquals(listOf("AFib", "POTS", "HRV", "Diabetes"), view.checks)
        assertEquals("Experimental", view.diabetesTag)
        assertEquals(null, widgetView(testSnapshot(), testDisplayWithChecks(null), TEST_READING_MS).diabetesTag)
    }

    @Test
    fun mapsEveryStatusThroughTheDisplayCopy() {
        val labels =
            listOf("regular", "check-again", "see-doctor", "inconclusive").map { status ->
                widgetView(testSnapshot(status = "\"$status\""), TEST_DISPLAY, TEST_READING_MS).status
            }
        assertEquals(listOf("Up to date", "Check again tonight", "Doctor visit suggested", "Check again tonight"), labels)
    }

    @Test
    fun handlesTheNoReadingYetSnapshot() {
        val view =
            widgetView(
                testSnapshot(status = "null", lastReadingAt = "null", hrBpm = "null", streakDays = 0),
                TEST_DISPLAY,
                TEST_READING_MS,
            )
        assertNull(view.statusKey)
        assertNull(view.status)
        assertNull(view.lastCheck)
        assertNull(view.bpm)
        assertNull(view.streak)
        assertEquals("Check now", view.checkNow)
        assertEquals("Full Scan", view.fullScan)
    }

    @Test
    fun neverShowsAHiddenValue() {
        assertNull(widgetView(testSnapshot(hideValues = true), TEST_DISPLAY, TEST_READING_MS).bpm)
        assertNull(widgetView(testSnapshot(hrBpm = "null"), TEST_DISPLAY, TEST_READING_MS).bpm)
    }

    @Test
    fun clampsAClockThatRunsBehindTheReadingToZeroHours() {
        assertEquals("Last check 0 h ago", widgetView(testSnapshot(), TEST_DISPLAY, TEST_READING_MS - 60_000L).lastCheck)
    }

    @Test
    fun rejectsAnUnknownStatusVersionOrColor() {
        assertThrows(JSONException::class.java) { widgetView(testSnapshot(status = "\"afib\""), TEST_DISPLAY, TEST_READING_MS) }
        assertThrows(IllegalArgumentException::class.java) { widgetView(testSnapshot(version = 2), TEST_DISPLAY, TEST_READING_MS) }
        assertThrows(IllegalArgumentException::class.java) { parseColor("#000000A3") }
    }
}
