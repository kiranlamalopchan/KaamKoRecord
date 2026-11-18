package expo.modules.liveshift

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The running shift as Android's counterpart of the iOS Live Activity: one
 * ongoing notification with a ticking timer, green at work and amber on a
 * break, with the clock's buttons. On Android 16 it asks to be promoted to
 * a Live Update, which adds the timer chip in the status bar.
 *
 * A button opens the app (as the old notification's did) carrying which
 * button and which shift; JS takes that with takePendingAction() and makes
 * the move only if that shift is still the one running.
 */
class LiveShiftModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context is not available" }

  override fun definition() = ModuleDefinition {
    Name("LiveShift")
    Events("onAction")

    Function("show") { options: Map<String, Any?> -> show(options) }

    Function("hide") {
      context.getSystemService(NotificationManager::class.java)?.cancel(NOTIFICATION_ID)
    }

    Function("takePendingAction") {
      val stored = pending
      pending = null
      if (stored != null) return@Function stored
      val intent = appContext.currentActivity?.intent ?: return@Function null
      val found = read(intent) ?: return@Function null
      intent.removeExtra(EXTRA_ACTION)
      intent.removeExtra(EXTRA_SHIFT)
      found
    }

    OnNewIntent { intent ->
      val found = read(intent) ?: return@OnNewIntent
      intent.removeExtra(EXTRA_ACTION)
      intent.removeExtra(EXTRA_SHIFT)
      pending = found
      sendEvent("onAction", found)
    }
  }

  private fun read(intent: Intent): Map<String, Any>? {
    val action = intent.getStringExtra(EXTRA_ACTION) ?: return null
    return mapOf("action" to action, "shiftId" to intent.getIntExtra(EXTRA_SHIFT, -1))
  }

  private fun show(o: Map<String, Any?>): Boolean {
    val ctx = context
    if (Build.VERSION.SDK_INT >= 33 &&
      ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false
    val manager = ctx.getSystemService(NotificationManager::class.java) ?: return false

    if (Build.VERSION.SDK_INT >= 26) {
      val channel = NotificationChannel(CHANNEL_ID, o["channelName"] as? String ?: "Running shift", NotificationManager.IMPORTANCE_DEFAULT).apply {
        // A standing fact, not news: never a sound or a buzz.
        setSound(null, null)
        enableVibration(false)
        setShowBadge(false)
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      }
      manager.createNotificationChannel(channel)
    }

    val onBreak = o["mode"] == "break"
    val accent = Color.parseColor(if (onBreak) "#D97706" else "#059669")
    val shiftId = (o["shiftId"] as? Number)?.toInt() ?: -1
    val title = o["title"] as? String ?: ""
    val text = o["text"] as? String ?: ""
    val icon = ctx.resources.getIdentifier("notification_icon", "drawable", ctx.packageName)
      .takeIf { it != 0 } ?: ctx.applicationInfo.icon

    val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(ctx, CHANNEL_ID)
    else @Suppress("DEPRECATION") Notification.Builder(ctx)
    builder
      .setSmallIcon(icon)
      .setColor(accent)
      .setContentTitle(title)
      .setContentText(text)
      .setStyle(Notification.BigTextStyle().bigText(text))
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(Notification.CATEGORY_STATUS)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .setContentIntent(open(ctx, 0, null, shiftId))

    val since = (o["since"] as? Number)?.toLong()
    if (since != null && since > 0) {
      builder.setWhen(since).setShowWhen(true).setUsesChronometer(true)
    } else {
      builder.setShowWhen(false)
    }

    @Suppress("UNCHECKED_CAST")
    val actions = (o["actions"] as? List<Map<String, Any?>>).orEmpty()
    actions.take(3).forEachIndexed { index, action ->
      val id = action["id"] as? String ?: return@forEachIndexed
      val label = action["label"] as? String ?: return@forEachIndexed
      builder.addAction(Notification.Action.Builder(Icon.createWithResource(ctx, icon), label, open(ctx, index + 1, id, shiftId)).build())
    }

    if (Build.VERSION.SDK_INT >= 36) builder.setRequestPromotedOngoing(true)

    manager.notify(NOTIFICATION_ID, builder.build())
    return true
  }

  /** Opens the app at the clock; a button also says which button it was and for which shift. */
  private fun open(ctx: Context, requestCode: Int, action: String?, shiftId: Int): PendingIntent {
    val intent = (ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: Intent(Intent.ACTION_MAIN))
      .setPackage(ctx.packageName)
      .setAction(Intent.ACTION_VIEW)
      .setData(Uri.parse(CLOCK_URL))
      .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
    if (action != null) intent.putExtra(EXTRA_ACTION, action).putExtra(EXTRA_SHIFT, shiftId)
    return PendingIntent.getActivity(ctx, REQUEST_BASE + requestCode, intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  companion object {
    private const val CHANNEL_ID = "running-shift"
    private const val NOTIFICATION_ID = 7301
    private const val REQUEST_BASE = 7300
    private const val CLOCK_URL = "mywork://clock"
    private const val EXTRA_ACTION = "liveShiftAction"
    private const val EXTRA_SHIFT = "liveShiftId"
    @Volatile private var pending: Map<String, Any>? = null
  }
}
