package com.kiranlama.mywork.wear

import android.app.Application
import android.content.SharedPreferences
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import java.time.Duration
import java.time.Instant

data class Screen(
  val signedIn: Boolean = false,
  val state: ClockState? = null,
  val busy: Boolean = false,
  val problem: String? = null,
  val pending: List<PendingTap> = emptyList(),
  val chosenWorkplace: Int? = null,
  val lang: String = "en",
) {
  val workplace: Workplace?
    get() {
      val s = state ?: return null
      s.shift?.workplace?.let { return it }
      val id = chosenWorkplace ?: s.selected
      return s.workplaces.firstOrNull { it.id == id } ?: s.workplaces.firstOrNull()
    }
}

/**
 * What the watch shows and does. A tap shows at once, is kept on the watch,
 * and is sent until the server has it — the same promise the phone's offline
 * queue makes, with the same `client_id` so a retry can never double up.
 */
class ClockModel(app: Application) : AndroidViewModel(app) {
  private val context get() = getApplication<Application>()
  private val store = context.getSharedPreferences("clock", 0)
  private val sending = Mutex()
  private val _screen = MutableStateFlow(Screen())
  val screen: StateFlow<Screen> = _screen.asStateFlow()

  /** How far the watch's clock is from the server's, so timers agree with the phone. */
  private var skew: Duration = Duration.ZERO

  private val linkChanged = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
    if (key == "token" || key == "server") sessionChanged()
    if (key == "lang") applyLang()
  }

  /** The phone pushed a newer clock (Face.adoptPushed kept it): show it. */
  private val clockPushed = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
    if (key != "pushed_at" || _screen.value.pending.isNotEmpty()) return@OnSharedPreferenceChangeListener
    val fresh = Face.read(context).state ?: return@OnSharedPreferenceChangeListener
    _screen.update { it.copy(state = fresh, chosenWorkplace = if (fresh.shift != null) null else it.chosenWorkplace) }
  }

  /** The connection is back: send what was saved while it was gone. */
  private val network = object : ConnectivityManager.NetworkCallback() {
    override fun onAvailable(network: Network) {
      if (_screen.value.pending.isNotEmpty()) refresh()
    }
  }

  init {
    val pending = store.getString("pending", null)?.let { raw ->
      val list = JSONArray(raw)
      (0 until list.length()).map { PendingTap.fromJson(list.getJSONObject(it)) }
    } ?: emptyList()
    val saved = store.getString("state", null)?.let { runCatching { ClockState.fromJson(JSONObject(it)) }.getOrNull() }
    skew = Duration.ofMillis(store.getLong("skew_ms", 0))
    _screen.value = Screen(signedIn = Link.signedIn(context), state = saved, pending = pending)
    applyLang()
    Link.prefs(context).registerOnSharedPreferenceChangeListener(linkChanged)
    store.registerOnSharedPreferenceChangeListener(clockPushed)
    context.getSystemService(ConnectivityManager::class.java)?.registerDefaultNetworkCallback(network)
    viewModelScope.launch {
      Link.pull(context)
      _screen.update { it.copy(signedIn = Link.signedIn(context)) }
      applyLang()
      refresh()
    }
  }

  override fun onCleared() {
    Link.prefs(context).unregisterOnSharedPreferenceChangeListener(linkChanged)
    store.unregisterOnSharedPreferenceChangeListener(clockPushed)
    runCatching { context.getSystemService(ConnectivityManager::class.java)?.unregisterNetworkCallback(network) }
  }

  private fun applyLang() {
    Words.lang = Link.lang(context)
    _screen.update { it.copy(lang = Words.lang) }
  }

  private fun sessionChanged() {
    // Someone else signing in on the phone: nothing of the last person stays.
    _screen.value = Screen(signedIn = Link.signedIn(context), lang = Words.lang)
    save()
    viewModelScope.launch { refresh() }
  }

  fun choose(workplace: Int) = _screen.update { it.copy(chosenWorkplace = workplace) }

  // ---- loading

  fun refresh() {
    viewModelScope.launch {
      if (!Link.signedIn(context)) return@launch
      flush()
      if (_screen.value.pending.isNotEmpty()) return@launch  // still offline: keep the taps as made
      try {
        take(Api.clock(context))
        _screen.update { it.copy(problem = null) }
      } catch (error: Exception) {
        handle(error, quietWhenOffline = _screen.value.state != null)
      }
    }
  }

  // ---- the four taps

  fun clockIn() = act(PendingTap(ClockAction.CLOCK_IN, workplace = _screen.value.workplace?.id))
  fun startBreak() = act(PendingTap(ClockAction.START_BREAK))
  fun endBreak() = act(PendingTap(ClockAction.END_BREAK))
  fun clockOut() = act(PendingTap(ClockAction.CLOCK_OUT))

  private fun act(tap: PendingTap) {
    if (_screen.value.busy) return
    _screen.update { s -> s.copy(problem = null, pending = s.pending + tap, state = s.state?.let { apply(tap, it) }) }
    save()
    viewModelScope.launch {
      _screen.update { it.copy(busy = true) }
      flush()
      _screen.update { it.copy(busy = false) }
    }
  }

  /** Send what is waiting, oldest first. Stops at the first tap that can't get through. */
  private suspend fun flush() = sending.withLock {
    // Known to be offline: keep the taps saved rather than wait out a timeout.
    if (!online()) return@withLock
    while (true) {
      val tap = _screen.value.pending.firstOrNull() ?: return@withLock
      try {
        val fresh = Api.perform(context, tap)
        _screen.update { it.copy(pending = it.pending.drop(1)) }
        if (_screen.value.pending.isEmpty()) take(fresh) else save()
        Link.tellPhoneClockChanged(context)
      } catch (failure: ApiFailure) {
        if (failure.isRefusal) {
          // The server said no (say, already clocked out on the phone). Drop this
          // tap and the ones built on it, say why, and show the real state.
          Failures.report(failure)
          _screen.update { it.copy(pending = emptyList(), problem = Failures.describe(failure)) }
          save()
          runCatching { take(Api.clock(context)) }
        } else {
          handle(failure, quietWhenOffline = true)
        }
        return@withLock
      } catch (error: Exception) {
        handle(error, quietWhenOffline = true)
        return@withLock
      }
    }
  }

  private fun online(): Boolean {
    val manager = context.getSystemService(ConnectivityManager::class.java) ?: return true
    val caps = manager.getNetworkCapabilities(manager.activeNetwork) ?: return false
    return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
  }

  private fun handle(error: Throwable, quietWhenOffline: Boolean) {
    Failures.report(error)
    if (error is ApiFailure && error.status == 401) {
      Link.forgetToken(context)
      _screen.update { it.copy(state = null, pending = emptyList(), signedIn = false) }
      save()
    }
    // Offline with taps saved: the "saved on your watch" line says it all.
    if (quietWhenOffline && error is ApiFailure && error.isNetwork) return
    _screen.update { it.copy(problem = Failures.describe(error)) }
  }

  private fun take(fresh: ClockState) {
    parseInstant(fresh.serverNow)?.let { skew = Duration.between(Instant.now(), it) }
    _screen.update { it.copy(state = fresh, chosenWorkplace = if (fresh.shift != null) null else it.chosenWorkplace) }
    save()
  }

  private fun save() {
    val s = _screen.value
    store.edit()
      .putString("pending", JSONArray(s.pending.map { it.toJson() }).toString())
      .putString("state", s.state?.toJson()?.toString())
      .putLong("skew_ms", skew.toMillis())
      .apply()
    // The watch face and the tile read what was just saved.
    Face.update(context)
  }

  // ---- drawing a tap before the server has it (as applyClockAction does on the phone)

  private fun apply(tap: PendingTap, state: ClockState): ClockState = when (tap.action) {
    ClockAction.CLOCK_IN -> state.copy(
      selected = tap.workplace ?: state.selected,
      shift = OpenShift("WORKING", state.workplaces.firstOrNull { it.id == tap.workplace }, tap.clientTime, 0, null),
    )
    ClockAction.START_BREAK -> state.shift?.let { state.copy(shift = it.copy(status = "ON_BREAK", runningBreakStart = tap.clientTime)) } ?: state
    ClockAction.END_BREAK -> state.shift?.let { shift ->
      val start = parseInstant(shift.runningBreakStart)
      val end = parseInstant(tap.clientTime)
      val added = if (start != null && end != null) maxOf(0L, Duration.between(start, end).seconds).toInt() else 0
      state.copy(shift = shift.copy(status = "WORKING", bankedBreakSeconds = shift.bankedBreakSeconds + added, runningBreakStart = null))
    } ?: state
    ClockAction.CLOCK_OUT -> state.copy(shift = null)
  }

  // ---- timers

  private fun now(): Instant = Instant.now().plus(skew)

  /** Seconds worked so far: since clock-in, less every break (the running one included). */
  fun workedSeconds(): Long {
    val shift = _screen.value.state?.shift ?: return 0
    val start = parseInstant(shift.clockIn) ?: return 0
    var seconds = Duration.between(start, now()).seconds - shift.bankedBreakSeconds
    parseInstant(shift.runningBreakStart)?.let { seconds -= Duration.between(it, now()).seconds }
    return maxOf(0, seconds)
  }

  /** This week's hours and the cap, counting the shift still running (see Face). */
  fun weekSeconds(): Long? = _screen.value.state?.let { Face.weekSeconds(it, skew) }
  fun limitUsed(): Long? = _screen.value.state?.let { Face.limitUsed(it, skew) }
  fun limitState(): String? = _screen.value.state?.let { Face.limitState(it, skew) }

  fun breakSeconds(): Long {
    val start = parseInstant(_screen.value.state?.shift?.runningBreakStart) ?: return 0
    return maxOf(0, Duration.between(start, now()).seconds)
  }
}
