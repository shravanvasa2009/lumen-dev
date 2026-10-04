package expo.modules.lumenwidgets

// Payloads shaped like the ones publish.ts writes, with the app's dark token colors.
private const val PALETTE =
    """{"surface":"#141925","line":"#262E40","line2":"#3A4458","text":"#F3F5F9","textDim":"#A7AFBF","accent":"#2EC4B6",""" +
        """"accentFill":"#2EC4B6","onAccentFill":"#0B0E14","flag":"#F5A524","criticalText":"#F87171",""" +
        """"badgeExperimentalFg":"#A7AFBF","badgeExperimentalBg":"#272B36"}"""

// The display before the four-checks row (an app version that publishes no checks).
const val TEST_DISPLAY =
    """{"name":"Lumen","status":{"regular":"Up to date","check-again":"Check again tonight","see-doctor":"Doctor visit suggested",""" +
        """"inconclusive":"Check again tonight"},"lastCheck":"Last check {{hours}} h ago","bpm":"bpm","streak":"streak {{days}} days",""" +
        """"checkNow":"Check now","fullScan":"Full Scan","empty":{"title":"No checks yet","body":"Takes 90 seconds"},""" +
        """"palette":{"light":$PALETTE,"dark":$PALETTE}}"""

// The current display: the four checks and the Diabetes evidence tag (publish.ts).
fun testDisplayWithChecks(diabetesTag: String? = "Experimental") =
    TEST_DISPLAY.dropLast(1) +
        ""","checks":["AFib","POTS","HRV","Diabetes"],"diabetesTag":${diabetesTag?.let { "\"$it\"" } ?: "null"}}"""

// 2026-10-04T07:41:58Z, the Appendix B example time.
const val TEST_READING_MS = 1_791_099_718_000L

fun testSnapshot(
    status: String = "\"regular\"",
    lastReadingAt: String = "\"2026-10-04T07:41:58Z\"",
    hrBpm: String = "64",
    hideValues: Boolean = false,
    streakDays: Int = 5,
    version: Int = 1,
) = """{"v":$version,"updatedAt":"2026-10-04T07:42:10Z","lastReadingAt":$lastReadingAt,"status":$status,"hrBpm":$hrBpm,""" +
    """"rhythmFlag":false,"diabetesFlag":false,"nextConfirmationAt":null,"streakDays":$streakDays,"hideValues":$hideValues,"theme":"system"}"""
