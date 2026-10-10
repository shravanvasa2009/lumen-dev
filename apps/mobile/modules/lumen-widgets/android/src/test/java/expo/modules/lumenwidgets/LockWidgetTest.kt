package expo.modules.lumenwidgets

import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.glance.appwidget.testing.unit.hasStartActivityClickAction
import androidx.glance.appwidget.testing.unit.runGlanceAppWidgetUnitTest
import androidx.glance.testing.unit.hasText
import androidx.glance.testing.unit.hasTextEqualTo
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

private const val TWO_HOURS_LATER_MS = TEST_READING_MS + 2 * 3_600_000L + 59_000L

// A see-doctor reading with every flag set and the heart rate showing: the most the snapshot can hold.
private val FLAGGED_SNAPSHOT =
    testSnapshot(status = "\"see-doctor\"", hrBpm = "64")
        .replace("\"rhythmFlag\":false", "\"rhythmFlag\":true")
        .replace("\"diabetesFlag\":false", "\"diabetesFlag\":true")

// Everything the home-screen widgets may show that the lock screen must not (WID-2): the value, its unit, and every
// status word; and the condition names, which no widget shows.
private val HOME_ONLY_TEXT =
    listOf("64", "bpm", "Up to date", "Check again", "Doctor", "AFib", "POTS", "HRV", "Diabetes")

// The same display in Spanish (es.json and lockscreen.json's words), and what the lock screen must not show in it.
private val SPANISH_DISPLAY =
    listOf(
        "Up to date" to "Al día",
        "Check again tonight" to "Revisa de nuevo esta noche",
        "Doctor visit suggested" to "Se sugiere ver a un médico",
        "Last check {{hours}} h ago" to "Última revisión hace {{hours}} h",
        "\"bpm\"" to "\"lpm\"",
        "Check now" to "Revisar ahora",
        "Full Scan" to "Escaneo completo",
        "No checks yet" to "Sin revisiones aún",
    ).fold(TEST_DISPLAY) { display, (english, spanish) -> display.replace(english, spanish) }
private val SPANISH_HOME_ONLY_TEXT =
    listOf("64", "lpm", "Al día", "Revisa de nuevo", "médico", "FA", "POTS", "VFC", "Diabetes")

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class LockWidgetTest {
    private val context = RuntimeEnvironment.getApplication()

    @Test
    fun showsWhenTheLastCheckWasAndNothingAboutIt() {
        val view = lockView(FLAGGED_SNAPSHOT, TEST_DISPLAY, TWO_HOURS_LATER_MS)
        assertEquals("Lumen", view.name)
        assertEquals("Last check 2 h ago", view.line)
        assertEquals("Check now", view.checkNow)
    }

    // The ring tells only how long ago the check was: full right after it, empty a day later and before any.
    @Test
    fun theRingEmptiesOverTheDayAfterACheck() {
        assertEquals(1f, freshness(TEST_READING_MS, TEST_READING_MS), 0f)
        assertEquals(0.75f, freshness(TEST_READING_MS, TEST_READING_MS + 6 * 3_600_000L), 0.0001f)
        assertEquals(0f, freshness(TEST_READING_MS, TEST_READING_MS + 30 * 3_600_000L), 0f)
        assertEquals(1f, freshness(TEST_READING_MS, TEST_READING_MS - 60_000L), 0f)
        assertEquals(0f, freshness(null, TEST_READING_MS), 0f)
    }

    // A lock screen is dark behind its widgets, so the widget takes the dark palette in either app theme.
    @Test
    fun drawsWithTheDarkPalette() {
        val light = TEST_DISPLAY.replaceFirst("\"surface\":\"#141925\"", "\"surface\":\"#FFFFFF\"")
        assertEquals(0xFF141925L, lockView(FLAGGED_SNAPSHOT, light, TWO_HOURS_LATER_MS).palette.surface)
    }

    @Test
    fun drawsTheRingAtTheAskedSize() {
        val ring = ringBitmap(104, 0.5f, 0xFF252C3D.toInt(), 0xFFF3F5F9.toInt())
        assertEquals(104, ring.width)
        assertEquals(104, ring.height)
    }

    @Test
    fun showsNoChecksYetBeforeTheFirstReading() {
        WidgetStore.writeDisplay(context, TEST_DISPLAY)
        assertEquals("No checks yet", WidgetStore.readLock(context, TWO_HOURS_LATER_MS)!!.line)
    }

    @Test
    fun theFallbackHoldsTheLockScreenCopy() {
        val view = fallbackLockView(context)
        assertEquals(context.applicationInfo.loadLabel(context.packageManager).toString(), view.name)
        assertEquals("No checks yet", view.line)
        assertEquals("Check now", view.checkNow)
    }

    // A wide slot (the lock-screen hub's) and a narrow one, where the button is left out.
    private fun assertDrawsNoHealthDetails(
        size: DpSize,
        checkTargets: Int,
        display: String = TEST_DISPLAY,
        line: String = "Last check 2 h ago",
        forbidden: List<String> = HOME_ONLY_TEXT,
    ) =
        runGlanceAppWidgetUnitTest {
            setContext(context)
            setAppWidgetSize(size)
            provideComposable { LockBody(lockView(FLAGGED_SNAPSHOT, display, TWO_HOURS_LATER_MS)) }
            onNode(hasTextEqualTo("Lumen")).assertExists()
            onNode(hasTextEqualTo(line)).assertExists()
            for (text in forbidden) onAllNodes(hasText(text, ignoreCase = true)).assertCountEquals(0)
            onAllNodes(hasStartActivityClickAction(linkIntent(context, CHECK_LINK))).assertCountEquals(checkTargets)
            onAllNodes(hasStartActivityClickAction(linkIntent(context, FULL_SCAN_LINK))).assertCountEquals(0)
        }

    @Test
    fun theWideWidgetOpensTheCheckFromTheCardAndTheButton() {
        assertDrawsNoHealthDetails(DpSize(330.dp, 160.dp), checkTargets = 2)
    }

    @Test
    fun theNarrowWidgetOpensTheCheckFromTheCard() {
        assertDrawsNoHealthDetails(DpSize(180.dp, 90.dp), checkTargets = 1)
    }

    @Test
    fun theSpanishWidgetShowsNoHealthDetailsEither() {
        assertDrawsNoHealthDetails(
            DpSize(330.dp, 160.dp),
            checkTargets = 2,
            display = SPANISH_DISPLAY,
            line = "Última revisión hace 2 h",
            forbidden = SPANISH_HOME_ONLY_TEXT,
        )
    }
}
