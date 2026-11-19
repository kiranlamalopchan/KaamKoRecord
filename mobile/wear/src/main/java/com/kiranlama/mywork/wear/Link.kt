package com.kiranlama.mywork.wear

import android.content.Context
import android.content.SharedPreferences
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import kotlinx.coroutines.tasks.await

/**
 * The watch's half of modules/watch-link: the phone writes who is signed in,
 * which server and which language to one data item; the watch keeps a copy in
 * its private storage and tells the phone when it moved the clock.
 */
object Link {
  const val SESSION_PATH = "/kaamkorecord/session"
  const val CLOCK_CHANGED_PATH = "/kaamkorecord/clock-changed"
  /** The phone's latest clock, pushed when it moves it, for the face and the tile. */
  const val CLOCK_PATH = "/kaamkorecord/clock"

  fun prefs(context: Context): SharedPreferences =
    context.getSharedPreferences("link", Context.MODE_PRIVATE)

  fun token(context: Context): String? = prefs(context).getString("token", null)?.ifEmpty { null }
  fun server(context: Context): String = prefs(context).getString("server", "") ?: ""
  fun lang(context: Context): String = prefs(context).getString("lang", "en") ?: "en"
  fun signedIn(context: Context) = token(context) != null && server(context).isNotEmpty()

  fun forgetToken(context: Context) {
    prefs(context).edit().remove("token").apply()
  }

  fun save(context: Context, token: String, server: String, lang: String) {
    prefs(context).edit()
      .putString("token", token)
      .putString("server", server)
      .putString("lang", if (lang == "ne") "ne" else "en")
      .apply()
  }

  /** Read what the phone last wrote — covers a first launch before any change event. */
  suspend fun pull(context: Context) {
    try {
      val items = Wearable.getDataClient(context).dataItems.await()
      try {
        for (item in items) {
          if (item.uri.path == SESSION_PATH) {
            val map = DataMapItem.fromDataItem(item).dataMap
            save(context, map.getString("token") ?: "", map.getString("server") ?: "", map.getString("lang") ?: "en")
          }
        }
      } finally {
        items.release()
      }
    } catch (error: Exception) {
      // No Play services link yet: keep whatever was saved.
      Failures.report(error)
    }
  }

  /** Tell the phone the clock moved. Best effort: the phone also refreshes on its own. */
  suspend fun tellPhoneClockChanged(context: Context) {
    try {
      val nodes = Wearable.getNodeClient(context).connectedNodes.await()
      val messages = Wearable.getMessageClient(context)
      for (node in nodes) messages.sendMessage(node.id, CLOCK_CHANGED_PATH, ByteArray(0)).await()
    } catch (_: Exception) {
      /* the phone isn't near; it catches up when it next opens */
    }
  }
}

/** Woken by Play services when the phone changes the sign-in or the clock, even with the app closed. */
class SessionListenerService : WearableListenerService() {
  override fun onDataChanged(events: DataEventBuffer) {
    for (event in events) {
      if (event.type != DataEvent.TYPE_CHANGED) continue
      val map = DataMapItem.fromDataItem(event.dataItem).dataMap
      when (event.dataItem.uri.path) {
        Link.SESSION_PATH -> {
          Link.save(this, map.getString("token") ?: "", map.getString("server") ?: "", map.getString("lang") ?: "en")
          Face.update(this)
        }
        Link.CLOCK_PATH -> map.getString("clock")?.let { Face.adoptPushed(this, it) }
      }
    }
  }
}
