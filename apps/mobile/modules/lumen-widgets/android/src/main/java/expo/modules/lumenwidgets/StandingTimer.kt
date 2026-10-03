package expo.modules.lumenwidgets

import android.app.PendingIntent
import android.content.Context
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

// The channel the expo-notifications standing-step alerts use (ADR 0005), so the user manages both in one place.
private const val CHANNEL_ID = "standing"
private const val NOTIFICATION_ID = 0x5747

// Mirrors StandingTimerContent in src/index.ts; every string comes from lockscreen.json (WID-2).
class StandingTimerContent : Record {
    @Field val channelName: String = ""

    @Field val title: String = ""

    @Field val text: String = ""

    @Field val actionLabel: String = ""

    @Field val countdownMs: Double? = null
}

// An ongoing notification, not a foreground service: the app is open during the test, and the system draws
// the chronometer, so it keeps counting if the user leaves the app (ADR 0005).
fun postStandingTimer(context: Context, content: StandingTimerContent) {
    val manager = NotificationManagerCompat.from(context)
    // The user turned notifications off; the in-app timer still runs, so there is nothing to report.
    if (!manager.areNotificationsEnabled()) return
    if (manager.getNotificationChannelCompat(CHANNEL_ID) == null) {
        manager.createNotificationChannel(
            NotificationChannelCompat.Builder(CHANNEL_ID, NotificationManagerCompat.IMPORTANCE_HIGH).setName(content.channelName).build(),
        )
    }
    val open =
        PendingIntent.getActivity(
            context,
            0,
            linkIntent(context, STANDING_LINK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    val builder =
        NotificationCompat
            .Builder(context, CHANNEL_ID)
            .setSmallIcon(context.applicationInfo.icon)
            .setContentTitle(content.title)
            .setContentText(content.text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            // The text holds no health details (WID-2), so the lock screen may show it in full.
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(open)
            .addAction(0, content.actionLabel, open)
    val countdownMs = content.countdownMs
    if (countdownMs == null) {
        builder.setShowWhen(false)
    } else {
        builder
            .setWhen(System.currentTimeMillis() + countdownMs.toLong())
            .setShowWhen(true)
            .setUsesChronometer(true)
            .setChronometerCountDown(true)
    }
    manager.notify(NOTIFICATION_ID, builder.build())
}

fun endStandingTimer(context: Context) {
    NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
}
