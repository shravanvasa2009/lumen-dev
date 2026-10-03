package expo.modules.lumenwidgets

import android.app.Notification
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

private const val NOW_MS = 1_791_099_718_000L
private const val COUNTDOWN_MS = 102_000.0

// SDK 35 is pinned so the Robolectric download doesn't change with the module's target SDK.
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class StandingTimerTest {
    private val context = RuntimeEnvironment.getApplication()

    // Expo fills a Record's fields by reflection, so the test does the same with what useStandingLiveTimer sends.
    private fun content(countdownMs: Double?, progress: Double) =
        StandingTimerContent().apply {
            val fields =
                mapOf(
                    "channelName" to "Standing test",
                    "title" to "Standing test",
                    "text" to "Next reading in",
                    "step" to "Step 3 of 5",
                    "tapHint" to "Tap to measure",
                    "actionLabel" to "Measure now",
                    "countdownMs" to countdownMs,
                    "progress" to progress,
                    "accentLight" to "#1D7A71",
                    "accentDark" to "#2EC4B6",
                )
            for ((name, value) in fields) {
                StandingTimerContent::class.java.getDeclaredField(name).apply { isAccessible = true }.set(this, value)
            }
        }

    private fun Notification.text(key: String) = extras.getCharSequence(key)?.toString()

    @Test
    fun countdownShowsTheStepTheSystemTimerAndTheProgress() {
        val notification = standingNotification(context, content(COUNTDOWN_MS, 0.6), NOW_MS)
        assertEquals("Standing test", notification.text(NotificationCompat.EXTRA_TITLE))
        assertEquals("Step 3 of 5", notification.text(NotificationCompat.EXTRA_SUB_TEXT))
        assertEquals("Next reading in", notification.text(NotificationCompat.EXTRA_TEXT))
        assertEquals(PROGRESS_MAX, notification.extras.getInt(NotificationCompat.EXTRA_PROGRESS_MAX))
        assertEquals(600, notification.extras.getInt(NotificationCompat.EXTRA_PROGRESS))
        assertFalse(notification.extras.getBoolean(NotificationCompat.EXTRA_PROGRESS_INDETERMINATE))
        assertEquals(NOW_MS + COUNTDOWN_MS.toLong(), notification.`when`)
        assertTrue(notification.extras.getBoolean(NotificationCompat.EXTRA_SHOW_WHEN))
        assertTrue(notification.extras.getBoolean(NotificationCompat.EXTRA_SHOW_CHRONOMETER))
        assertTrue(notification.extras.getBoolean(NotificationCompat.EXTRA_CHRONOMETER_COUNT_DOWN))
        assertEquals("Measure now", notification.actions.single().title.toString())
        assertEquals(Notification.VISIBILITY_PUBLIC, notification.visibility)
        assertTrue(notification.flags and Notification.FLAG_ONGOING_EVENT != 0)
    }

    @Test
    fun aDueReadingAsksForATapAndStopsTheTimer() {
        val notification = standingNotification(context, content(null, 0.6), NOW_MS)
        assertEquals("Tap to measure", notification.text(NotificationCompat.EXTRA_TEXT))
        assertEquals("Step 3 of 5", notification.text(NotificationCompat.EXTRA_SUB_TEXT))
        assertFalse(notification.extras.getBoolean(NotificationCompat.EXTRA_SHOW_WHEN))
        assertFalse(notification.extras.getBoolean(NotificationCompat.EXTRA_SHOW_CHRONOMETER))
    }

    @Test
    fun progressOutsideTheTestIsClamped() {
        val early = standingNotification(context, content(COUNTDOWN_MS, -0.2), NOW_MS)
        val late = standingNotification(context, content(COUNTDOWN_MS, 1.4), NOW_MS)
        assertEquals(0, early.extras.getInt(NotificationCompat.EXTRA_PROGRESS))
        assertEquals(PROGRESS_MAX, late.extras.getInt(NotificationCompat.EXTRA_PROGRESS))
    }

    @Test
    fun theBrandMarkAndTheLightAccentTintTheNotification() {
        val notification = standingNotification(context, content(COUNTDOWN_MS, 0.6), NOW_MS)
        assertEquals(R.drawable.lumen_notification_mark, notification.smallIcon.resId)
        assertNotNull(ContextCompat.getDrawable(context, R.drawable.lumen_notification_mark))
        assertEquals(0xFF1D7A71.toInt(), notification.color)
    }

    @Test
    @Config(qualifiers = "night")
    fun aDarkPhoneGetsTheDarkAccent() {
        val notification = standingNotification(context, content(COUNTDOWN_MS, 0.6), NOW_MS)
        assertEquals(0xFF2EC4B6.toInt(), notification.color)
    }
}
