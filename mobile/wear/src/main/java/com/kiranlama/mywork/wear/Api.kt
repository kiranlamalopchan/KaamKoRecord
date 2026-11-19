package com.kiranlama.mywork.wear

import android.content.Context
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.util.UUID

// ---- what the server sends (apps/api/views/timeclock.py `clock_state`) ----------

data class Workplace(val id: Int, val name: String)

data class OpenShift(
  val status: String,  // WORKING | ON_BREAK
  val workplace: Workplace?,
  val clockIn: String,
  val bankedBreakSeconds: Int,
  val runningBreakStart: String?,
)

/** The chosen workplace's hours cap, as of `serverNow` (apps/api `limit_card`). */
data class Limit(
  val workplaceId: Int?,
  val capSeconds: Long,
  val usedSeconds: Long,
  val period: String,      // week | fortnight | month
  val state: String,       // ok | close | over
  val resetsOn: String?,
)

data class ClockState(
  val serverNow: String,
  val workplaces: List<Workplace>,
  val selected: Int?,
  val shift: OpenShift?,
  /** Every workplace's hours since the week began, as of `serverNow`. */
  val weekSeconds: Long? = null,
  val limit: Limit? = null,
) {
  fun toJson(): JSONObject = JSONObject()
    .put("server_now", serverNow)
    .put("workplaces", JSONArray(workplaces.map { JSONObject().put("id", it.id).put("name", it.name) }))
    .put("selected", selected ?: JSONObject.NULL)
    .put("shift", shift?.let { s ->
      JSONObject()
        .put("status", s.status)
        .put("workplace", s.workplace?.let { JSONObject().put("id", it.id).put("name", it.name) } ?: JSONObject.NULL)
        .put("clock_in", s.clockIn)
        .put("banked_break_seconds", s.bankedBreakSeconds)
        .put("running_break", s.runningBreakStart?.let { JSONObject().put("start", it) } ?: JSONObject.NULL)
    } ?: JSONObject.NULL)
    .put("week", weekSeconds?.let { JSONObject().put("worked", JSONObject().put("seconds", it)) } ?: JSONObject.NULL)
    .put("limit", limit?.let { l ->
      JSONObject()
        .put("workplace", l.workplaceId?.let { JSONObject().put("id", it).put("name", "") } ?: JSONObject.NULL)
        .put("cap", JSONObject().put("seconds", l.capSeconds))
        .put("used", JSONObject().put("seconds", l.usedSeconds))
        .put("period_label", l.period)
        .put("state", l.state)
        .put("resets_on", l.resetsOn ?: JSONObject.NULL)
    } ?: JSONObject.NULL)

  companion object {
    fun fromJson(json: JSONObject): ClockState {
      fun place(o: JSONObject?) = o?.let { Workplace(it.getInt("id"), it.getString("name")) }
      val list = json.optJSONArray("workplaces") ?: JSONArray()
      val shift = json.optJSONObject("shift")
      return ClockState(
        serverNow = json.getString("server_now"),
        workplaces = (0 until list.length()).map { place(list.getJSONObject(it))!! },
        selected = if (json.isNull("selected")) null else json.optInt("selected"),
        shift = shift?.let {
          OpenShift(
            status = it.getString("status"),
            workplace = place(it.optJSONObject("workplace")),
            clockIn = it.getString("clock_in"),
            bankedBreakSeconds = it.optInt("banked_break_seconds"),
            runningBreakStart = it.optJSONObject("running_break")?.getString("start"),
          )
        },
        weekSeconds = json.optJSONObject("week")?.optJSONObject("worked")?.optLong("seconds"),
        limit = json.optJSONObject("limit")?.let {
          Limit(
            workplaceId = it.optJSONObject("workplace")?.optInt("id"),
            capSeconds = it.optJSONObject("cap")?.optLong("seconds") ?: 0,
            usedSeconds = it.optJSONObject("used")?.optLong("seconds") ?: 0,
            period = it.optString("period_label", "week"),
            state = it.optString("state", "ok"),
            resetsOn = if (it.isNull("resets_on")) null else it.optString("resets_on"),
          )
        },
      )
    }
  }
}

// ---- one clock tap, kept until the server has it ------------------------------

enum class ClockAction(val wire: String, val path: String) {
  CLOCK_IN("clock_in", "timesheet/clock-in/"),
  START_BREAK("start_break", "timesheet/break/start/"),
  END_BREAK("end_break", "timesheet/break/end/"),
  CLOCK_OUT("clock_out", "timesheet/clock-out/");

  companion object { fun of(wire: String) = entries.first { it.wire == wire } }
}

/**
 * The same fields the phone's offline queue sends (src/offline/clock.ts):
 * `client_id` lets the server recognise a retry, `client_time` keeps the
 * moment of the tap rather than the moment it got through.
 */
data class PendingTap(
  val action: ClockAction,
  val clientId: String = UUID.randomUUID().toString(),
  val clientTime: String = Instant.now().toString(),
  val clientTz: String = ZoneId.systemDefault().id,
  val workplace: Int? = null,
) {
  fun toJson(): JSONObject = JSONObject()
    .put("action", action.wire).put("client_id", clientId).put("client_time", clientTime)
    .put("client_tz", clientTz).put("workplace", workplace ?: JSONObject.NULL)

  companion object {
    fun fromJson(o: JSONObject) = PendingTap(
      ClockAction.of(o.getString("action")), o.getString("client_id"), o.getString("client_time"),
      o.getString("client_tz"), if (o.isNull("workplace")) null else o.getInt("workplace"),
    )
  }
}

// ---- failures, worded for people and reported for developers ------------------

class ApiFailure(
  val status: Int,          // 0 = never reached the server
  val detail: String?,      // the server's sentence, when it wrote one for people
  val method: String,
  val path: String,
  val requestId: String,
  val underlying: String?,
) : Exception("HTTP $status") {
  val isNetwork get() = status == 0
  val isAuth get() = status == 401 || status == 403
  /** The server looked at the tap and said no: retrying won't help. */
  val isRefusal get() = status == 400 || status == 409
}

object Failures {
  private val machineMade = Regex("""Traceback|Exception|\bat .+:\d+|HTTP \d|[<>]""")

  /** The one way an error becomes words on the watch. */
  fun describe(error: Throwable): String {
    val f = error as? ApiFailure ?: return tr("Something went wrong. Please try again.")
    return when {
      f.isNetwork -> tr("We couldn't connect. Check your internet and try again.")
      f.status >= 500 -> tr("Something went wrong on our side. Please try again.")
      f.status == 401 -> tr("Open KaamKoRecord on your phone and sign in. Your watch follows.")
      f.status == 429 -> tr("Too many tries. Wait a minute, then try again.")
      f.isRefusal && f.detail != null && !machineMade.containsMatchIn(f.detail) -> f.detail
      else -> tr("Something went wrong. Please try again.")
    }
  }

  /** A one-line JSON report for developers. Never the token, a body or a query string. */
  fun report(error: Throwable) {
    val report = JSONObject().put("at", Instant.now().toString()).put("app", "KaamKoRecord").put("platform", "wearos")
    if (error is ApiFailure) {
      report.put("kind", when {
        error.isNetwork -> "network"; error.isAuth -> "auth"; error.status >= 500 -> "server"
        error.isRefusal -> "validation"; else -> "request"
      })
      report.put("status", error.status)
      report.put("request", JSONObject().put("method", error.method).put("path", error.path.substringBefore('?')).put("id", error.requestId))
      report.put("message", if (error.isRefusal) "Request validation failed" else error.underlying ?: "HTTP ${error.status}")
    } else {
      report.put("kind", "app").put("name", error.javaClass.simpleName)
      report.put("message", error.message ?: "Unknown failure")
      report.put("stack", error.stackTrace.take(8).joinToString("\n"))
    }
    Log.w("KaamKoRecord", report.toString())
  }
}

// ---- the requests ----------------------------------------------------------------

object Api {
  suspend fun clock(context: Context): ClockState = send(context, "GET", "timesheet/clock/", null)

  suspend fun perform(context: Context, tap: PendingTap): ClockState {
    val body = JSONObject().put("client_id", tap.clientId).put("client_time", tap.clientTime).put("client_tz", tap.clientTz)
    tap.workplace?.let { body.put("workplace", it) }
    return send(context, "POST", tap.action.path, body)
  }

  private suspend fun send(context: Context, method: String, path: String, body: JSONObject?): ClockState =
    withContext(Dispatchers.IO) {
      val requestId = UUID.randomUUID().toString()
      val token = Link.token(context)
      val server = Link.server(context)
      if (token == null || server.isEmpty()) throw ApiFailure(401, null, method, path, requestId, "not signed in")

      val connection = try {
        (URL("$server/api/v1/$path").openConnection() as HttpURLConnection)
      } catch (error: Exception) {
        throw ApiFailure(0, null, method, path, requestId, error.javaClass.simpleName)
      }
      try {
        connection.requestMethod = method
        connection.connectTimeout = 15_000
        connection.readTimeout = 15_000
        connection.setRequestProperty("Accept", "application/json")
        connection.setRequestProperty("Authorization", "Token $token")
        connection.setRequestProperty("X-Request-ID", requestId)
        connection.setRequestProperty("Accept-Language", Link.lang(context))
        if (body != null) {
          connection.doOutput = true
          connection.setRequestProperty("Content-Type", "application/json")
          connection.outputStream.use { it.write(body.toString().toByteArray()) }
        }
        val status = connection.responseCode
        val text = (if (status in 200..299) connection.inputStream else connection.errorStream)
          ?.bufferedReader()?.use { it.readText() } ?: ""
        if (status !in 200..299) {
          val detail = try { JSONObject(text).optString("detail").ifEmpty { null } } catch (_: Exception) { null }
          throw ApiFailure(status, detail, method, path, requestId, null)
        }
        try {
          ClockState.fromJson(JSONObject(text))
        } catch (_: Exception) {
          throw ApiFailure(502, null, method, path, requestId, "unreadable reply")
        }
      } catch (error: IOException) {
        throw ApiFailure(0, null, method, path, requestId, error.javaClass.simpleName)
      } finally {
        connection.disconnect()
      }
    }
}

/** Dates as Django writes them ("2026-11-19T03:12:45.123456+00:00") or as the watch does ("…Z"). */
fun parseInstant(text: String?): Instant? = try {
  text?.let { OffsetDateTime.parse(it).toInstant() }
} catch (_: Exception) {
  try { text?.let { Instant.parse(it) } } catch (_: Exception) { null }
}
