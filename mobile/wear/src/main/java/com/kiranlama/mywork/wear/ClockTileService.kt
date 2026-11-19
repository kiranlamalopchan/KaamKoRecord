package com.kiranlama.mywork.wear

import androidx.concurrent.futures.CallbackToFutureAdapter
import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.ColorBuilders.argb
import androidx.wear.protolayout.DimensionBuilders.dp
import androidx.wear.protolayout.DimensionBuilders.expand
import androidx.wear.protolayout.DimensionBuilders.sp
import androidx.wear.protolayout.LayoutElementBuilders
import androidx.wear.protolayout.ModifiersBuilders
import androidx.wear.protolayout.ResourceBuilders
import androidx.wear.protolayout.TimelineBuilders
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.TileBuilders
import androidx.wear.tiles.TileService
import com.google.common.util.concurrent.ListenableFuture
import java.time.Duration
import java.time.Instant

/**
 * The tile beside the watch face: the shift as it stands, this week's hours,
 * and the hours cap with what's left — amber when close, red when over.
 * Drawn again every minute while a shift runs, and whenever the clock moves.
 */
class ClockTileService : TileService() {

  override fun onTileRequest(requestParams: RequestBuilders.TileRequest): ListenableFuture<TileBuilders.Tile> {
    Words.lang = Link.lang(this)
    val now = Face.read(this)
    val running = now.state?.shift != null
    val tile = TileBuilders.Tile.Builder()
      .setResourcesVersion(RESOURCES)
      .setFreshnessIntervalMillis(if (running) 60_000 else 15 * 60_000)
      .setTileTimeline(TimelineBuilders.Timeline.fromLayoutElement(layout(now)))
      .build()
    return done(tile)
  }

  override fun onTileResourcesRequest(requestParams: RequestBuilders.ResourcesRequest): ListenableFuture<ResourceBuilders.Resources> =
    done(ResourceBuilders.Resources.Builder().setVersion(RESOURCES).build())

  private fun layout(now: Face.Now): LayoutElementBuilders.LayoutElement {
    val column = LayoutElementBuilders.Column.Builder()
      .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
    val state = now.state
    if (!now.signedIn) {
      column.addContent(text(tr("Sign in on your phone"), 15f, WHITE, bold = true))
    } else if (state == null) {
      column.addContent(text(tr("Open KaamKoRecord on your watch once."), 14f, MUTED))
    } else {
      val shift = state.shift
      val clock = Instant.now()
      when {
        shift == null -> {
          column.addContent(text(tr("Off shift"), 14f, MUTED))
          column.addContent(text(tr("Clock in"), 20f, BRAND, bold = true))
        }
        shift.status == "ON_BREAK" -> {
          column.addContent(text(tr("On break"), 14f, WARN, bold = true))
          column.addContent(text(hm(Face.breakStart(state, now.skew)?.let { Duration.between(it, clock).seconds } ?: 0), 26f, WHITE, bold = true))
        }
        else -> {
          column.addContent(text(listOfNotNull(tr("Working"), shift.workplace?.name).joinToString(" · "), 14f, BRAND, bold = true))
          column.addContent(text(hm(Face.workStart(state, now.skew)?.let { Duration.between(it, clock).seconds } ?: 0), 26f, WHITE, bold = true))
        }
      }
      column.addContent(gap())
      Face.weekSeconds(state, now.skew, clock)?.let { column.addContent(text("${tr("This week")}: ${hm(it)}", 13f, WHITE)) }
      val limit = state.limit
      val used = Face.limitUsed(state, now.skew, clock)
      if (limit != null && used != null) {
        val colour = when (Face.limitState(state, now.skew, clock)) { "over" -> DANGER; "close" -> WARN; else -> MUTED }
        val left = limit.capSeconds - used
        column.addContent(text(tr("{used} of {cap}", "used" to hm(used), "cap" to hm(limit.capSeconds)), 13f, colour))
        column.addContent(text(if (left >= 0) tr("{time} left", "time" to hm(left)) else tr("{time} over", "time" to hm(-left)), 12f, colour))
      }
    }
    val open = ModifiersBuilders.Clickable.Builder()
      .setId("open")
      .setOnClick(
        ActionBuilders.LaunchAction.Builder()
          .setAndroidActivity(
            ActionBuilders.AndroidActivity.Builder()
              .setPackageName(packageName)
              .setClassName(MainActivity::class.java.name)
              .build(),
          )
          .build(),
      )
      .build()
    return LayoutElementBuilders.Box.Builder()
      .setWidth(expand())
      .setHeight(expand())
      .setModifiers(ModifiersBuilders.Modifiers.Builder().setClickable(open).build())
      .addContent(column.build())
      .build()
  }

  private fun text(value: String, size: Float, colour: Int, bold: Boolean = false): LayoutElementBuilders.LayoutElement =
    LayoutElementBuilders.Text.Builder()
      .setText(value)
      .setMaxLines(2)
      .setFontStyle(
        LayoutElementBuilders.FontStyle.Builder()
          .setSize(sp(size))
          .setColor(argb(colour))
          .setWeight(if (bold) LayoutElementBuilders.FONT_WEIGHT_BOLD else LayoutElementBuilders.FONT_WEIGHT_NORMAL)
          .build(),
      )
      .build()

  private fun gap(): LayoutElementBuilders.LayoutElement =
    LayoutElementBuilders.Spacer.Builder().setHeight(dp(6f)).build()

  private fun hm(seconds: Long): String {
    val s = maxOf(0, seconds)
    val h = s / 3600
    val m = (s % 3600) / 60
    return when { h > 0 && m > 0 -> "${h}h ${m}m"; h > 0 -> "${h}h"; else -> "${m}m" }
  }

  private fun <T> done(value: T): ListenableFuture<T> = CallbackToFutureAdapter.getFuture { completer -> completer.set(value); "tile" }

  private companion object {
    const val RESOURCES = "1"
    // The phone's dark palette (src/ui/palette.ts), as on the clock screen.
    const val BRAND = 0xFF79CFA8.toInt()
    const val WARN = 0xFFFCD34D.toInt()
    const val DANGER = 0xFFFCA5A5.toInt()
    const val MUTED = 0xFFA3A3A3.toInt()
    const val WHITE = 0xFFFFFFFF.toInt()
  }
}
