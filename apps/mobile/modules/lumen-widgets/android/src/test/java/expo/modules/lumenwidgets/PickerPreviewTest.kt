package expo.modules.lumenwidgets

import android.appwidget.AppWidgetProviderInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

// The generated picker preview (Android 15+) draws the gallery's sample reading with the published copy.
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class PickerPreviewTest {
    private val context = RuntimeEnvironment.getApplication()

    @Test
    fun drawsTheGallerySampleWithThePublishedCopy() {
        WidgetStore.write(context, testSnapshot(), TEST_DISPLAY)
        val view = sampleView(context, TEST_READING_MS)!!
        assertEquals("Up to date", view.status)
        assertEquals("Last check 2 h ago", view.lastCheck)
        assertEquals("64", view.bpm)
    }

    // WID-2: the preview shows a sample heart rate and status, so it is set for the home screen and nothing else.
    @Test
    fun setsThePreviewForTheHomeScreenOnly() {
        assertEquals(1, PREVIEW_CATEGORIES.size)
        assertEquals(true, PREVIEW_CATEGORIES.contains(AppWidgetProviderInfo.WIDGET_CATEGORY_HOME_SCREEN))
        assertEquals(false, PREVIEW_CATEGORIES.contains(AppWidgetProviderInfo.WIDGET_CATEGORY_KEYGUARD))
    }

    @Test
    fun asksForAPreviewOnlyWhenThePublishedCopyChanged() {
        val display = TEST_DISPLAY
        assertEquals(true, WidgetStore.previewNeedsUpdate(context, display))
        WidgetStore.markPreviewed(context, display)
        assertEquals(false, WidgetStore.previewNeedsUpdate(context, display))
        assertEquals(true, WidgetStore.previewNeedsUpdate(context, display.replace("Check now", "Revisar ahora")))
    }

    // An older version's copy can be unreadable after an update; start-up re-sets previews from it.
    @Test
    fun skipsTheSampleWhenTheStoredCopyCannotBeRead() {
        WidgetStore.write(context, testSnapshot(), "{\"v\":0}")
        assertNull(sampleView(context, TEST_READING_MS))
    }

    @Test
    fun asksAgainAfterAnAppUpdateDropsThePreviews() {
        val display = TEST_DISPLAY
        WidgetStore.markPreviewed(context, display)
        shadowOf(context.packageManager).getInternalMutablePackageInfo(context.packageName).lastUpdateTime += 60_000L
        assertEquals(true, WidgetStore.previewNeedsUpdate(context, display))
    }
}
