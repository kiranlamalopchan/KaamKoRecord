package com.kiranlama.mywork.wear

import android.content.ComponentName
import android.content.Context
import androidx.wear.tiles.TileService
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceUpdateRequester
import org.json.JSONArray
import org.json.JSONObject
import java.time.Duration
import java.time.Instant

/**
 * What the watch face and the tile show, read from what the app saved.
 *
 * ClockModel saves the clock (taps drawn in already) and how far this watch's
 * clock is from the server's; the phone can also push a fresh clock when it
 * moves it. Everything here is read on demand by the complication and the
 * tile, which may run while the app itself is closed.
 */
object Face {
  private fun store(context: Context) = context.getSharedPreferences("clock", Context.MODE_PRIVATE)

  data class Now(val signedIn: Boolean, val state: ClockState?, val skew: Duration)

  fun read(context: Context): Now {
    val prefs = store(context)
    val state = prefs.getString("state", null)?.let { runCatching { ClockState.fromJson(JSONObject(it)) }.getOrNull() }
    return Now(Link.signedIn(context), state, Duration.ofMillis(prefs.getLong("skew_ms", 0)))
  }

  /** A moment on the server's clock, on this watch's clock. */
  fun local(server: Instant, skew: Duration): Instant = server.minus(skew)

  /** When the worked timer would read zero: clock-in plus the breaks already taken. */
  fun workStart(state: ClockState, skew: Duration): Instant? {
    val shift = state.shift ?: return null
    val start = parseInstant(shift.clockIn) ?: return null
    return local(start, skew).plusSeconds(shift.bankedBreakSeconds.toLong())
  }

  fun breakStart(state: ClockState, skew: Duration): Instant? =
    parseInstant(state.shift?.runningBreakStart)?.let { local(it, skew) }

  /** Seconds worked since `serverNow` on a shift still running — what the saved totals lack. */
  private fun sinceSaved(state: ClockState, skew: Duration, now: Instant): Long {
    if (state.shift?.status != "WORKING") return 0
    val saved = parseInstant(state.serverNow)?.let { local(it, skew) } ?: return 0
    val shiftStart = workStart(state, skew) ?: saved
    // A shift clocked in on the watch after the last fetch counts from its own start.
    return maxOf(0, Duration.between(maxOf(saved, shiftStart), now).seconds)
  }

  fun weekSeconds(state: ClockState, skew: Duration, now: Instant = Instant.now()): Long? =
    state.weekSeconds?.let { it + sinceSaved(state, skew, now) }

  /** The cap's hours used, counting a shift running at that workplace. */
  fun limitUsed(state: ClockState, skew: Duration, now: Instant = Instant.now()): Long? {
    val limit = state.limit ?: return null
    val here = state.shift?.workplace?.id != null && state.shift.workplace.id == limit.workplaceId
    return limit.usedSeconds + if (here) sinceSaved(state, skew, now) else 0
  }

  /** ok, close or over, as the server works it out (`_limit_for`): close from 90%, over at the cap. */
  fun limitState(state: ClockState, skew: Duration, now: Instant = Instant.now()): String? {
    val limit = state.limit ?: return null
    val used = limitUsed(state, skew, now) ?: return null
    if (limit.capSeconds <= 0) return limit.state
    return when {
      used >= limit.capSeconds -> "over"
      used * 10 >= limit.capSeconds * 9 -> "close"
      else -> "ok"
    }
  }

  /** The phone moved the clock: keep it, unless taps made here are still on their way. */
  fun adoptPushed(context: Context, json: String) {
    val fresh = runCatching { ClockState.fromJson(JSONObject(json)) }.getOrNull() ?: return
    val prefs = store(context)
    val pending = runCatching { JSONArray(prefs.getString("pending", "[]")).length() }.getOrDefault(0)
    if (pending > 0) return
    val saved = prefs.getString("state", null)?.let { runCatching { ClockState.fromJson(JSONObject(it)) }.getOrNull() }
    val newer = saved == null || (parseInstant(fresh.serverNow) ?: Instant.EPOCH) >= (parseInstant(saved.serverNow) ?: Instant.EPOCH)
    if (!newer) return
    prefs.edit().putString("state", fresh.toJson().toString()).putLong("pushed_at", System.currentTimeMillis()).apply()
    update(context)
  }

  /** Ask the watch face and the tile to draw again. */
  fun update(context: Context) {
    runCatching {
      ComplicationDataSourceUpdateRequester
        .create(context, ComponentName(context, ClockComplicationService::class.java))
        .requestUpdateAll()
    }.onFailure { Failures.report(it) }
    runCatching { TileService.getUpdater(context).requestUpdate(ClockTileService::class.java) }
      .onFailure { Failures.report(it) }
  }
}
