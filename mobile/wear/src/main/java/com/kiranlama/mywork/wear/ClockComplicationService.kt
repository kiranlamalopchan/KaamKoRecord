package com.kiranlama.mywork.wear

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import androidx.wear.watchface.complications.data.ComplicationData
import androidx.wear.watchface.complications.data.ComplicationText
import androidx.wear.watchface.complications.data.ComplicationType
import androidx.wear.watchface.complications.data.CountUpTimeReference
import androidx.wear.watchface.complications.data.LongTextComplicationData
import androidx.wear.watchface.complications.data.MonochromaticImage
import androidx.wear.watchface.complications.data.PlainComplicationText
import androidx.wear.watchface.complications.data.ShortTextComplicationData
import androidx.wear.watchface.complications.data.TimeDifferenceComplicationText
import androidx.wear.watchface.complications.data.TimeDifferenceStyle
import androidx.wear.watchface.complications.datasource.ComplicationRequest
import androidx.wear.watchface.complications.datasource.SuspendingComplicationDataSourceService
import java.time.Instant
import java.util.concurrent.TimeUnit

/**
 * The shift on the watch face: how long you've worked, or how long the break
 * has run, counting by itself. Off shift it says so; a tap opens the app.
 *
 * The watch face counts the time itself, so this only has to answer when the
 * clock changes — Face.update asks for that.
 */
class ClockComplicationService : SuspendingComplicationDataSourceService() {

  override suspend fun onComplicationRequest(request: ComplicationRequest): ComplicationData? {
    Words.lang = Link.lang(this)
    val now = Face.read(this)
    val state = now.state
    val open = openApp(this)
    val shift = state?.shift
    return when {
      !now.signedIn || state == null -> build(request.complicationType, plain("—"), plain("KaamKoRecord"), open)
      shift == null -> build(request.complicationType, plain(tr("Off")), plain(tr("Off shift")), open)
      shift.status == "ON_BREAK" -> {
        val from = Face.breakStart(state, now.skew) ?: Instant.now()
        build(request.complicationType, counting(from), plain(tr("Break")), open, longTitle = tr("On break"))
      }
      else -> {
        val from = Face.workStart(state, now.skew) ?: Instant.now()
        val where = shift.workplace?.name?.takeIf { it.isNotBlank() }
        build(request.complicationType, counting(from), plain(tr("Work")), open,
          longTitle = listOfNotNull(tr("Working"), where).joinToString(" · "))
      }
    }
  }

  override fun getPreviewData(type: ComplicationType): ComplicationData? =
    build(type, counting(Instant.now().minusSeconds(3 * 3600 + 42 * 60)), plain(tr("Work")), null, longTitle = tr("Working"))

  private fun build(type: ComplicationType, text: ComplicationText, title: ComplicationText, tap: PendingIntent?, longTitle: String? = null): ComplicationData? {
    val icon = MonochromaticImage.Builder(Icon.createWithResource(this, R.drawable.ic_complication)).build()
    return when (type) {
      ComplicationType.SHORT_TEXT -> ShortTextComplicationData.Builder(text, text)
        .setTitle(title).setMonochromaticImage(icon).setTapAction(tap).build()
      ComplicationType.LONG_TEXT -> LongTextComplicationData.Builder(text, text)
        .setTitle(longTitle?.let { plain(it) } ?: title).setMonochromaticImage(icon).setTapAction(tap).build()
      else -> null
    }
  }

  private fun plain(text: String) = PlainComplicationText.Builder(text).build()

  /** "3h 42m", kept current by the watch face itself. */
  private fun counting(from: Instant): ComplicationText =
    TimeDifferenceComplicationText.Builder(TimeDifferenceStyle.SHORT_DUAL_UNIT, CountUpTimeReference(from))
      .setMinimumTimeUnit(TimeUnit.MINUTES)
      .build()

  companion object {
    fun openApp(context: Context): PendingIntent = PendingIntent.getActivity(
      context, 0,
      Intent(context, MainActivity::class.java),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }
}
