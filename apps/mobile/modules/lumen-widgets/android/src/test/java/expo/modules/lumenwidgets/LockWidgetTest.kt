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

// Everything the home-screen widgets may show that the lock screen must not (WID-2): the value, its unit, every status
// word, and the four checks' names.
private val HOME_ONLY_TEXT =
    listOf("64", "bpm", "Up to date", "Check again", "Doctor", "streak", "AFib", "POTS", "HRV", "Diabetes", "Experimental")

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class LockWidgetTest {
    private val context = RuntimeEnvironment.getApplication()

    @Test
    fun showsWhenTheLastCheckWasAndNothingAboutIt() {
        val view = lockView(FLAGGED_SNAPSHOT, testDisplayWithChecks(), TWO_HOURS_LATER_MS)
        assertEquals("Lumen", view.name)
        assertEquals("Last check 2 h ago", view.line)
        assertEquals("Check now", view.checkNow)
    }

    @Test
    fun showsNoChecksYetBeforeTheFirstReading() {
        WidgetStore.writeDisplay(context, testDisplayWithChecks())
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
    private fun assertDrawsNoHealthDetails(size: DpSize, checkTargets: Int) =
        runGlanceAppWidgetUnitTest {
            setContext(context)
            setAppWidgetSize(size)
            provideComposable { LockBody(lockView(FLAGGED_SNAPSHOT, testDisplayWithChecks(), TWO_HOURS_LATER_MS)) }
            onNode(hasTextEqualTo("Lumen")).assertExists()
            onNode(hasTextEqualTo("Last check 2 h ago")).assertExists()
            for (text in HOME_ONLY_TEXT) onAllNodes(hasText(text, ignoreCase = true)).assertCountEquals(0)
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
}
