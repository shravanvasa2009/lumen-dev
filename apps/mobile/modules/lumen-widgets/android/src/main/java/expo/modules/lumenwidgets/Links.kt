package expo.modules.lumenwidgets

import android.content.Context
import android.content.Intent
import android.net.Uri

// Spec §9.6: widgets never measure; every action opens the app through one of these links.
const val CHECK_LINK = "lumen://check"
const val FULL_SCAN_LINK = "lumen://check?mode=full"
const val STANDING_LINK = "lumen://standing"

// Pinned to this app so another app registering the lumen scheme can't receive the tap.
fun linkIntent(context: Context, link: String): Intent =
    Intent(Intent.ACTION_VIEW, Uri.parse(link)).setPackage(context.packageName)
