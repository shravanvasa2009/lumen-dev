package expo.modules.lumenwidgets

import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.glance.appwidget.testing.unit.hasStartActivityClickAction
import androidx.glance.appwidget.testing.unit.runGlanceAppWidgetUnitTest
import androidx.glance.testing.unit.hasContentDescriptionEqualTo
import androidx.glance.testing.unit.hasTextEqualTo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

// Glance's test environment builds a real Bundle, so these run on Robolectric rather than Android's stub jar.
// SDK 35 is pinned so the Robolectric download doesn't change with the module's target SDK.
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class EmptyWidgetTest {
    private val context = RuntimeEnvironment.getApplication()
    private val appName = context.applicationInfo.loadLabel(context.packageManager).toString()

    @Test
    fun theFallbackHoldsTheEmptyStateCopyAndTokenColors() {
        val view = fallbackView(context)
        assertTrue(appName.isNotBlank())
        assertEquals(appName, view.name)
        assertEquals("No checks yet", view.emptyTitle)
        assertEquals("Takes 90 seconds", view.emptyBody)
        assertEquals("Check now", view.checkNow)
        assertEquals("Full Scan", view.fullScan)
        assertEquals(0xFFFFFFFFL, view.light.surface)
        assertEquals(0xFF1C1C1EL, view.dark.surface)
        assertEquals(0xFF096F67L, view.light.accent)
        assertEquals(0xFF3A3A3CL, view.dark.ringTrack)
    }

    // The launch publish sends the copy alone: the widget then draws "no reading yet" in the app's copy, never a
    // reading.
    @Test
    fun theCopyAloneDrawsTheEmptyState() {
        WidgetStore.writeDisplay(context, TEST_DISPLAY)
        val view = WidgetStore.read(context, TEST_READING_MS)!!
        assertNull(view.status)
        assertNull(view.bpm)
        assertNull(view.lastCheck)
        assertEquals("No checks yet", view.emptyTitle)
    }

    // A widget placed before the app's first publish still draws the mark, the empty state, and its buttons.
    private fun assertEmptyState(medium: Boolean, size: DpSize) =
        runGlanceAppWidgetUnitTest {
            setContext(context)
            setAppWidgetSize(size)
            provideComposable { WidgetBody(fallbackView(context), medium) }
            onNode(hasTextEqualTo("No checks yet")).assertExists()
            onNode(hasTextEqualTo("Takes 90 seconds")).assertExists()
            // Small: the card and the button both open the check; medium: only Check now.
            onAllNodes(hasStartActivityClickAction(linkIntent(context, CHECK_LINK))).assertCountEquals(if (medium) 1 else 2)
            if (medium) {
                onNode(hasTextEqualTo(appName)).assertExists()
                onNode(hasStartActivityClickAction(linkIntent(context, FULL_SCAN_LINK))).assertExists()
            } else {
                onNode(hasContentDescriptionEqualTo(appName)).assertExists()
            }
        }

    @Test
    fun smallWidgetShowsTheEmptyStateBeforeTheFirstPublish() {
        assertEmptyState(medium = false, size = DpSize(140.dp, 140.dp))
    }

    @Test
    fun mediumWidgetShowsTheEmptyStateBeforeTheFirstPublish() {
        assertEmptyState(medium = true, size = DpSize(330.dp, 140.dp))
    }

    @Test
    fun aPublishedSnapshotWithNoReadingShowsThePublishedEmptyCopy() =
        runGlanceAppWidgetUnitTest {
            setContext(context)
            setAppWidgetSize(DpSize(140.dp, 140.dp))
            val view = widgetView(testSnapshot(status = "null", lastReadingAt = "null", hrBpm = "null", streakDays = 0), TEST_DISPLAY, TEST_READING_MS)
            provideComposable { WidgetBody(view, medium = false) }
            onNode(hasTextEqualTo("No checks yet")).assertExists()
            onNode(hasTextEqualTo("Check now")).assertExists()
        }
}
