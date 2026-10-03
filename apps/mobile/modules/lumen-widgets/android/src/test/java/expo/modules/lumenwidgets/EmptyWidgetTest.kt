package expo.modules.lumenwidgets

import androidx.glance.appwidget.testing.unit.hasStartActivityClickAction
import androidx.glance.appwidget.testing.unit.runGlanceAppWidgetUnitTest
import androidx.glance.testing.unit.hasContentDescriptionEqualTo
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

    // A widget placed before the app's first publish must still draw the app icon and open a check.
    private fun assertVisibleAndOpensACheck(medium: Boolean) =
        runGlanceAppWidgetUnitTest {
            setContext(context)
            provideComposable { WidgetBody(null, medium) }
            onNode(hasContentDescriptionEqualTo(appName)).assertExists()
            onNode(hasStartActivityClickAction(linkIntent(context, CHECK_LINK))).assertExists()
        }

    @Test
    fun smallWidgetShowsTheIconBeforeTheFirstPublish() {
        assertTrue(appName.isNotBlank())
        assertVisibleAndOpensACheck(medium = false)
    }

    @Test
    fun mediumWidgetShowsTheIconBeforeTheFirstPublish() {
        assertVisibleAndOpensACheck(medium = true)
    }
}
