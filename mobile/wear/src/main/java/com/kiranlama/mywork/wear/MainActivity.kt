package com.kiranlama.mywork.wear

import android.os.Bundle
import android.view.HapticFeedbackConstants
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.ScalingLazyListScope
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.ButtonDefaults
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.Icon
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.CircularProgressIndicator
import androidx.wear.compose.material.Colors
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.PositionIndicator
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import androidx.wear.compose.material.dialog.Alert
import androidx.wear.compose.material.dialog.Dialog
import kotlinx.coroutines.delay
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

// The phone's dark palette (src/ui/palette.ts).
private val Brand = Color(0xFF79CFA8)
private val BrandInk = Color(0xFF10261C)
private val Warn = Color(0xFFFCD34D)
private val Danger = Color(0xFFFCA5A5)
private val Muted = Color(0xFFA3A3A3)

class MainActivity : ComponentActivity() {
  private val clock: ClockModel by viewModels()

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContent {
      MaterialTheme(colors = Colors(primary = Brand, onPrimary = BrandInk, error = Danger)) {
        ClockApp(clock)
      }
    }
  }

  override fun onResume() {
    super.onResume()
    clock.refresh()
  }
}

@Composable
private fun ClockApp(clock: ClockModel) {
  val screen by clock.screen.collectAsStateWithLifecycle()
  var picking by remember { mutableStateOf(false) }
  var askClockOut by remember { mutableStateOf(false) }
  val listState = rememberScalingLazyListState()
  // Swiping back from the workplace list returns to the clock, not out of the app.
  BackHandler(enabled = picking) { picking = false }

  Scaffold(
    timeText = { TimeText() },
    positionIndicator = { PositionIndicator(scalingLazyListState = listState) },
  ) {
    val state = screen.state
    when {
      !screen.signedIn -> Message(tr("Sign in on your phone"), tr("Open KaamKoRecord on your phone and sign in. Your watch follows."))
      state == null && screen.problem != null -> Problem(screen.problem!!) { clock.refresh() }
      state == null -> Box { CircularProgressIndicator() }
      state.workplaces.isEmpty() -> Message(tr("Workplace"), tr("Add a workplace on your phone first."))
      picking -> ScalingLazyColumn(state = listState, modifier = Modifier.fillMaxSize()) {
        item { Text(tr("Workplace"), color = Muted, fontSize = 13.sp) }
        items(state.workplaces) { place ->
          Chip(
            label = { Text(place.name, maxLines = 2) },
            onClick = { clock.choose(place.id); picking = false },
            colors = if (place.id == screen.workplace?.id) ChipDefaults.primaryChipColors() else ChipDefaults.secondaryChipColors(),
            modifier = Modifier.fillMaxWidth(),
          )
        }
      }
      else -> ScalingLazyColumn(state = listState, modifier = Modifier.fillMaxSize()) {
        val shift = state.shift
        if (shift == null) offShift(screen, state.workplaces.size > 1, onPick = { picking = true }, onClockIn = clock::clockIn)
        else onShift(screen, clock, onClockOut = { askClockOut = true })
        footer(screen)
        week(screen, clock)
      }
    }
  }

  Dialog(showDialog = askClockOut, onDismissRequest = { askClockOut = false }) {
    Alert(
      title = { Text(tr("Clock out?"), textAlign = TextAlign.Center) },
      negativeButton = {
        Button(onClick = { askClockOut = false }, colors = ButtonDefaults.secondaryButtonColors()) {
          Icon(Icons.Default.Close, contentDescription = tr("Cancel"))
        }
      },
      positiveButton = {
        Button(onClick = { askClockOut = false; clock.clockOut() }, colors = ButtonDefaults.buttonColors(backgroundColor = Danger)) {
          Icon(Icons.Default.Check, contentDescription = tr("Clock out"), tint = Color.Black)
        }
      },
    )
  }
}

private fun ScalingLazyListScope.offShift(screen: Screen, canPick: Boolean, onPick: () -> Unit, onClockIn: () -> Unit) {
  item {
    Chip(
      label = { Text(screen.workplace?.name ?: "", maxLines = 1) },
      secondaryLabel = if (canPick) ({ Text(tr("Workplace"), color = Muted) }) else null,
      onClick = onPick,
      enabled = canPick,
      colors = ChipDefaults.secondaryChipColors(),
      modifier = Modifier.fillMaxWidth(),
    )
  }
  item {
    BigChip(tr("Clock in"), Brand, BrandInk, enabled = screen.workplace != null && !screen.busy, onClick = onClockIn)
  }
}

private fun ScalingLazyListScope.onShift(screen: Screen, clock: ClockModel, onClockOut: () -> Unit) {
  val shift = screen.state?.shift ?: return
  val onBreak = shift.status == "ON_BREAK"
  item { Text(shift.workplace?.name ?: "", color = Muted, fontSize = 13.sp, maxLines = 1) }
  item { Timer(onBreak, clock, shift) }
  item {
    if (onBreak) BigChip(tr("End break"), Brand, BrandInk, enabled = !screen.busy, onClick = clock::endBreak)
    else BigChip(tr("Start break"), Warn, Color.Black, enabled = !screen.busy, onClick = clock::startBreak)
  }
  item { BigChip(tr("Clock out"), Danger.copy(alpha = 0.22f), Danger, enabled = !screen.busy, onClick = onClockOut) }
}

@Composable
private fun Timer(onBreak: Boolean, clock: ClockModel, shift: OpenShift) {
  var tick by remember { mutableLongStateOf(0L) }
  val lifecycle = LocalLifecycleOwner.current.lifecycle
  LaunchedEffect(lifecycle) {
    lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
      while (true) { tick = System.currentTimeMillis(); delay(1000) }
    }
  }
  @Suppress("UNUSED_EXPRESSION") tick  // read so the timer draws again each second
  val seconds = if (onBreak) clock.breakSeconds() else clock.workedSeconds()
  val caption = if (onBreak) tr("Worked {time}", "time" to hm(clock.workedSeconds()))
    else tr("Since {time}", "time" to (parseInstant(shift.clockIn)?.atZone(ZoneId.systemDefault())
      ?.format(DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT)) ?: ""))
  Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
    Text(if (onBreak) tr("On break") else tr("Working"), color = if (onBreak) Warn else Brand, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
    Text(hms(seconds), fontSize = 30.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
    Text(caption, color = Muted, fontSize = 12.sp)
  }
}

@Composable
private fun BigChip(title: String, fill: Color, ink: Color, enabled: Boolean, onClick: () -> Unit) {
  val view = LocalView.current
  Chip(
    label = { Text(title, color = ink, fontWeight = FontWeight.SemiBold, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center) },
    onClick = { view.performHapticFeedback(HapticFeedbackConstants.CONFIRM); onClick() },
    enabled = enabled,
    colors = ChipDefaults.chipColors(backgroundColor = fill, contentColor = ink),
    modifier = Modifier.fillMaxWidth(),
  )
}

private fun ScalingLazyListScope.footer(screen: Screen) {
  if (screen.pending.isNotEmpty()) {
    item { Text(tr("Saved on your watch · Syncing when connected"), color = Muted, fontSize = 11.sp, textAlign = TextAlign.Center) }
  }
  screen.problem?.let { problem ->
    item {
      Text(problem, color = Danger, fontSize = 12.sp, textAlign = TextAlign.Center,
        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
    }
  }
}

/** This week at a glance, under the buttons: hours so far and the cap, amber when close, red when over. */
private fun ScalingLazyListScope.week(screen: Screen, clock: ClockModel) {
  val state = screen.state ?: return
  if (state.weekSeconds == null && state.limit == null) return
  item { WeekCard(clock, state.limit) }
}

@Composable
private fun WeekCard(clock: ClockModel, limit: Limit?) {
  // Once a minute is plenty for hours and minutes.
  var tick by remember { mutableLongStateOf(0L) }
  val lifecycle = LocalLifecycleOwner.current.lifecycle
  LaunchedEffect(lifecycle) {
    lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
      while (true) { tick = System.currentTimeMillis(); delay(30_000) }
    }
  }
  @Suppress("UNUSED_EXPRESSION") tick
  val week = clock.weekSeconds()
  val used = clock.limitUsed()
  val colour = when (clock.limitState()) { "over" -> Danger; "close" -> Warn; else -> Muted }
  Column(
    horizontalAlignment = Alignment.CenterHorizontally,
    modifier = Modifier.fillMaxWidth().padding(top = 10.dp).semantics(mergeDescendants = true) {},
  ) {
    Text(tr("This week"), color = Muted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
    if (week != null) Text(hm(week), fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
    if (limit != null && used != null) {
      val title = when (limit.period) { "fortnight" -> tr("Fortnightly limit"); "month" -> tr("Monthly limit"); else -> tr("Weekly limit") }
      val left = limit.capSeconds - used
      Text(title, color = Muted, fontSize = 11.sp, modifier = Modifier.padding(top = 4.dp))
      Text(tr("{used} of {cap}", "used" to hm(used), "cap" to hm(limit.capSeconds)), color = colour, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
      Text(if (left >= 0) tr("{time} left", "time" to hm(left)) else tr("{time} over", "time" to hm(-left)), color = colour, fontSize = 12.sp)
      limit.resetsOn?.let { Text(tr("Resets {day}", "day" to it), color = Muted, fontSize = 11.sp) }
    } else {
      Text(tr("No hours limit set"), color = Muted, fontSize = 11.sp, textAlign = TextAlign.Center)
    }
  }
}

@Composable
private fun Message(title: String, text: String) {
  Column(
    modifier = Modifier.fillMaxSize().padding(horizontal = 20.dp),
    verticalArrangement = Arrangement.Center,
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    Text(title, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
    Text(text, color = Muted, fontSize = 12.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 4.dp))
  }
}

@Composable
private fun Problem(text: String, retry: () -> Unit) {
  Column(
    modifier = Modifier.fillMaxSize().padding(horizontal = 20.dp),
    verticalArrangement = Arrangement.Center,
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    Text(text, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
    Chip(label = { Text(tr("Try again")) }, onClick = retry, colors = ChipDefaults.primaryChipColors(), modifier = Modifier.padding(top = 8.dp))
  }
}

@Composable
private fun Box(content: @Composable () -> Unit) {
  Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) { content() }
}

private fun hms(seconds: Long) = "%d:%02d:%02d".format(seconds / 3600, (seconds % 3600) / 60, seconds % 60)
private fun hm(seconds: Long): String {
  val h = seconds / 3600; val m = (seconds % 3600) / 60
  return when { h > 0 && m > 0 -> "${h}h ${m}m"; h > 0 -> "${h}h"; else -> "${m}m" }
}
