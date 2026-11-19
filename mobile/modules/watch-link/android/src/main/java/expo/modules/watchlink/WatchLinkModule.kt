package expo.modules.watchlink

import android.content.Context
import com.google.android.gms.wearable.MessageClient
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The phone's half of the Wear OS link (the watch's is wear/…/Link.kt).
 *
 * `send` writes who is signed in, the server and the language to one data
 * item, which Google Play services copies to the paired watch whenever it
 * can — the watch app need not be running. An empty token signs the watch
 * out. Only an app with this package name and signing key can read it.
 *
 * When the watch moves the clock it sends a message, and JS hears
 * `onClockChanged` so the phone's clock, widget and live notification catch up.
 */
class WatchLinkModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context is not available" }

  private val listener = MessageClient.OnMessageReceivedListener { event ->
    if (event.path == CLOCK_CHANGED_PATH) sendEvent("onClockChanged", emptyMap<String, Any>())
  }

  override fun definition() = ModuleDefinition {
    Name("WatchLink")
    Events("onClockChanged")

    OnStartObserving { Wearable.getMessageClient(context).addListener(listener) }
    OnStopObserving { Wearable.getMessageClient(context).removeListener(listener) }

    Function("send") { token: String, server: String, lang: String ->
      val request = PutDataMapRequest.create(SESSION_PATH).apply {
        dataMap.putString("token", token)
        dataMap.putString("server", server)
        dataMap.putString("lang", lang)
      }.asPutDataRequest().setUrgent()
      // Fire and forget: with no watch paired the item simply waits.
      Wearable.getDataClient(context).putDataItem(request)
      true
    }

    // The phone's latest clock, for the watch face and tile. "at" makes every
    // write a change, so the watch hears it even when the state looks the same.
    Function("sendClock") { json: String ->
      val request = PutDataMapRequest.create(CLOCK_PATH).apply {
        dataMap.putString("clock", json)
        dataMap.putLong("at", System.currentTimeMillis())
      }.asPutDataRequest().setUrgent()
      Wearable.getDataClient(context).putDataItem(request)
      true
    }
  }

  companion object {
    const val SESSION_PATH = "/kaamkorecord/session"
    const val CLOCK_CHANGED_PATH = "/kaamkorecord/clock-changed"
    const val CLOCK_PATH = "/kaamkorecord/clock"
  }
}
