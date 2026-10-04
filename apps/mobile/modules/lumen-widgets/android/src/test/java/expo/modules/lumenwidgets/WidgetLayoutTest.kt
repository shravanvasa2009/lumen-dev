package expo.modules.lumenwidgets

import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.glance.appwidget.testing.unit.GlanceAppWidgetUnitTest
import androidx.glance.appwidget.testing.unit.hasStartActivityClickAction
import androidx.glance.appwidget.testing.unit.runGlanceAppWidgetUnitTest
import androidx.glance.testing.unit.hasContentDescriptionEqualTo
import androidx.glance.testing.unit.hasTextEqualTo
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

// Mockup 32's structure for published readings, at the smallest and a large cell for each widget.
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class WidgetLayoutTest {
    private val context = RuntimeEnvironment.getApplication()

    // Two hours after the reading, so "Last check 2 h ago".
    private val nowMs = TEST_READING_MS + 2 * 3_600_000L

    private fun render(
        snapshot: String,
        medium: Boolean,
        size: DpSize,
        display: String = TEST_DISPLAY,
        checks: GlanceAppWidgetUnitTest.() -> Unit,
    ) =
        runGlanceAppWidgetUnitTest {
            setContext(context)
            setAppWidgetSize(size)
            val view = widgetView(snapshot, display, nowMs)
            provideComposable { WidgetBody(view, medium) }
            checks()
        }

    @Test
    fun smallShowsTheMarkStatusLastCheckAndCheckNow() {
        for (size in listOf(DpSize(110.dp, 110.dp), DpSize(200.dp, 200.dp))) {
            render(testSnapshot(), medium = false, size = size) {
                onNode(hasContentDescriptionEqualTo("Lumen")).assertExists()
                onNode(hasTextEqualTo("Up to date")).assertExists()
                onNode(hasTextEqualTo("Last check 2 h ago")).assertExists()
                onNode(hasTextEqualTo("Check now")).assertExists()
                // The card and the button both open the check.
                onAllNodes(hasStartActivityClickAction(linkIntent(context, CHECK_LINK))).assertCountEquals(2)
                onNode(hasTextEqualTo("64")).assertDoesNotExist()
            }
        }
    }

    // Four-checks proposal A (owner, 2026-10-03).
    @Test
    fun mediumListsTheFourChecksWithTheDiabetesEvidenceTag() {
        for (size in listOf(DpSize(250.dp, 130.dp), DpSize(420.dp, 220.dp))) {
            render(testSnapshot(), medium = true, size = size, display = testDisplayWithChecks()) {
                listOf("AFib", "POTS", "HRV", "Diabetes", "Experimental").forEach {
                    onNode(hasTextEqualTo(it)).assertExists()
                }
                onNode(hasTextEqualTo("64")).assertExists()
            }
        }
    }

    @Test
    fun mediumDropsTheTagWhenDiabetesIsNoLongerExperimental() {
        render(testSnapshot(), medium = true, size = DpSize(330.dp, 168.dp), display = testDisplayWithChecks(null)) {
            onNode(hasTextEqualTo("Diabetes")).assertExists()
            onNode(hasTextEqualTo("Experimental")).assertDoesNotExist()
        }
    }

    @Test
    fun smallNamesNoCheck() {
        render(testSnapshot(), medium = false, size = DpSize(140.dp, 140.dp), display = testDisplayWithChecks()) {
            onNode(hasTextEqualTo("AFib")).assertDoesNotExist()
            onNode(hasTextEqualTo("Up to date")).assertExists()
        }
    }

    @Test
    fun noRowFromAnAppThatPublishesNoChecks() {
        render(testSnapshot(), medium = true, size = DpSize(330.dp, 140.dp)) {
            onNode(hasTextEqualTo("AFib")).assertDoesNotExist()
        }
    }

    @Test
    fun smallKeepsALongStatusAndDropsTheDetailInTheSmallestCell() {
        render(testSnapshot(status = "\"see-doctor\""), medium = false, size = DpSize(110.dp, 110.dp)) {
            onNode(hasTextEqualTo("Doctor visit suggested")).assertExists()
            onNode(hasTextEqualTo("Last check 2 h ago")).assertDoesNotExist()
        }
        render(testSnapshot(status = "\"see-doctor\""), medium = false, size = DpSize(170.dp, 170.dp)) {
            onNode(hasTextEqualTo("Last check 2 h ago")).assertExists()
        }
    }

    @Test
    fun mediumShowsTheHeartRateStatusStreakAndBothButtons() {
        for (size in listOf(DpSize(250.dp, 110.dp), DpSize(420.dp, 200.dp))) {
            render(testSnapshot(), medium = true, size = size) {
                onNode(hasTextEqualTo("Lumen")).assertExists()
                onNode(hasTextEqualTo("64")).assertExists()
                onNode(hasTextEqualTo("bpm")).assertExists()
                onNode(hasTextEqualTo("Up to date · streak 5 days")).assertExists()
                onNode(hasStartActivityClickAction(linkIntent(context, CHECK_LINK))).assertExists()
                onNode(hasStartActivityClickAction(linkIntent(context, FULL_SCAN_LINK))).assertExists()
            }
        }
    }

    @Test
    fun mediumPutsTheStatusInTheNumbersPlaceWhenValuesAreHidden() {
        render(testSnapshot(hideValues = true), medium = true, size = DpSize(330.dp, 140.dp)) {
            onNode(hasTextEqualTo("64")).assertDoesNotExist()
            onNode(hasTextEqualTo("bpm")).assertDoesNotExist()
            onNode(hasTextEqualTo("Up to date")).assertExists()
            onNode(hasTextEqualTo("Last check 2 h ago · streak 5 days")).assertExists()
            onNode(hasTextEqualTo("Check now")).assertExists()
            onNode(hasTextEqualTo("Full Scan")).assertExists()
        }
    }
}
