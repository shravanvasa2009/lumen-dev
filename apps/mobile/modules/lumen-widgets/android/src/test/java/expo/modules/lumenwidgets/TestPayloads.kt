package expo.modules.lumenwidgets

// Payloads shaped like the ones publish.ts writes, with the app's dark token colors for every role.
private const val PALETTE =
    """{"surface":"#141925","text":"#F3F5F9","textDim":"#A7AFBF","accent":"#2EC4B6","ringTrack":"#252C3D",""" +
        """"buttonFill":"#2EC4B6","onButtonFill":"#0B0E14","tonalFill":"#18333B","onTonalFill":"#2EC4B6",""" +
        """"flag":"#F5A524","criticalText":"#F87171"}"""

const val TEST_DISPLAY =
    """{"name":"Lumen","status":{"regular":"Up to date","check-again":"Check again tonight","see-doctor":"Doctor visit suggested",""" +
        """"inconclusive":"Check again tonight"},"lastCheck":"Last check {{hours}} h ago","bpm":"bpm",""" +
        """"checkNow":"Check now","fullScan":"Full Scan","empty":{"title":"No checks yet","body":"Takes 90 seconds"},""" +
        """"lock":{"lastCheck":"Last check {{hours}} h ago","checkNow":"Check now"},""" +
        """"palette":{"light":$PALETTE,"dark":$PALETTE}}"""

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
