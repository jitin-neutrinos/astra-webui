package com.jitinnair.astra

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ObjectAnimator
import android.app.Activity
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.VelocityTracker
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.animation.PathInterpolator
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import kotlin.concurrent.thread

/**
 * Interactive approval / question sheet (Authenticator / Okta Verify style).
 * Launched by the push notification (tap, or lock-screen full-screen intent).
 * Fetches the pending gate from the Astra server, renders it as a bottom-docked
 * card and posts the answer straight back.
 *
 * States: loading (skeleton) -> ready -> sending (in-place) -> result
 * (approved / denied / already answered) -> animated dismiss.
 * Follows the app's light/dark theme, uses the Astra brand tokens (same values as
 * the in-chat approval card) and the brand easing curve.
 */
class GateActivity : Activity() {

    private val http = OkHttpClient()
    private var gateId = ""
    private var notifId = 0
    private var busy = false
    private var debugJson: String? = null
    private var dismissing = false

    private lateinit var root: FrameLayout
    private lateinit var scrim: View
    private lateinit var sheet: LinearLayout       // docked container (drag target)
    private lateinit var content: LinearLayout     // swappable body inside the sheet

    // ---- brand tokens (index.css @theme + [data-theme="light"]) -------------
    private var light = false
    private fun c(d: String, l: String) = Color.parseColor(if (light) l else d)
    private val surface get() = c("#12121A", "#FDFCF9")
    private val surfaceHi get() = c("#1A1A2E", "#ECE8DF")
    private val hairline get() = c("#252538", "#E1DCD1")
    private val well get() = c("#0A0A0F", "#F5F2EC")
    private val ink get() = c("#F8FAFC", "#0F172A")
    private val muted get() = c("#9AA3B2", "#5B6472")
    private val brand get() = c("#22D3EE", "#0369A1")           // cyanx
    private val onBrand get() = c("#0A0A0F", "#FFFFFF")
    private val danger get() = c("#F87171", "#B91C1C")
    private val okay = Color.parseColor("#10B981")
    private val warn get() = c("#FBBF24", "#B45309")

    private fun tint(color: Int, a: Int) = Color.argb(a, Color.red(color), Color.green(color), Color.blue(color))

    // brand easing: cubic-bezier(.23,1,.32,1)
    private val ease = PathInterpolator(0.23f, 1f, 0.32f, 1f)

    private fun dp(v: Int) = TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics
    ).toInt()

    private fun rounded(fill: Int, radiusDp: Int, stroke: Int? = null, strokeDp: Int = 1) = GradientDrawable().apply {
        setColor(fill); cornerRadius = dp(radiusDp).toFloat()
        if (stroke != null) setStroke(dp(strokeDp), stroke)
    }

    // ---- lifecycle ---------------------------------------------------------
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        overridePendingTransition(0, 0)
        light = getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE).getString("astra_theme", "dark") == "light"
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true); setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
        }
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)

        gateId = intent.getStringExtra(EXTRA_GATE_ID) ?: ""
        notifId = intent.getIntExtra(EXTRA_NOTIF_ID, 0)
        buildShell()
        // Non-exported activity: only adb / our own process can pass this. Renders a gate
        // offline so the visuals can be checked without a live request.
        debugJson = intent.getStringExtra("debug_gate_json")
        if (debugJson != null) { render(JSONObject(debugJson!!)); return }
        if (gateId.isEmpty()) { openChatFallback(); return }
        showSkeleton()
        thread { load() }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        recreate()
    }

    @Suppress("OVERRIDE_DEPRECATION")
    override fun onBackPressed() { if (!busy) dismiss() }

    // ---- shell: scrim + docked sheet + drag-to-dismiss ---------------------
    private fun buildShell() {
        root = FrameLayout(this)
        scrim = View(this).apply {
            setBackgroundColor(Color.parseColor(if (light) "#66101820" else "#B3000000"))
            alpha = 0f
            setOnClickListener { if (!busy) dismiss() }
        }
        root.addView(scrim, FrameLayout.LayoutParams(-1, -1))

        sheet = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = rounded(surface, 26, hairline)
            elevation = dp(16).toFloat()
            // stop taps inside the sheet from reaching the scrim
            isClickable = true
        }
        // handle + drag zone
        val handle = View(this).apply { background = rounded(tint(muted, 90), 3) }
        val dragZone = FrameLayout(this).apply {
            addView(handle, FrameLayout.LayoutParams(dp(36), dp(4), Gravity.CENTER))
            setOnTouchListener(dragListener())
        }
        sheet.addView(dragZone, LinearLayout.LayoutParams(-1, dp(22)))

        content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(2), dp(20), dp(18))
        }
        val scroll = ScrollView(this).apply { isVerticalScrollBarEnabled = false; overScrollMode = View.OVER_SCROLL_NEVER; addView(content) }
        sheet.addView(scroll, LinearLayout.LayoutParams(-1, ViewGroup.LayoutParams.WRAP_CONTENT))

        val lp = FrameLayout.LayoutParams(-1, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM).apply {
            setMargins(dp(10), dp(48), dp(10), dp(10))
        }
        root.addView(sheet, lp)
        setContentView(root)

        // dock above the gesture bar / 3-button nav, below the status bar
        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            val b = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            lp.topMargin = b.top + dp(12)
            lp.bottomMargin = maxOf(b.bottom, ime.bottom) + dp(10)
            sheet.layoutParams = lp
            insets
        }

        // entrance: scrim fades, sheet rises with the brand curve
        sheet.alpha = 0f
        sheet.post {
            sheet.translationY = sheet.height.coerceAtLeast(dp(240)).toFloat() * 0.35f + dp(40)
            sheet.animate().alpha(1f).translationY(0f).setDuration(340).setInterpolator(ease).start()
            scrim.animate().alpha(1f).setDuration(260).start()
        }
    }

    /** Velocity-aware swipe-down. A quick flick dismisses regardless of distance. */
    private fun dragListener(): View.OnTouchListener {
        var startY = 0f
        var vt: VelocityTracker? = null
        return View.OnTouchListener { v, e ->
            if (busy || dismissing) return@OnTouchListener false
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> { startY = e.rawY; vt = VelocityTracker.obtain().also { it.addMovement(e) }; v.parent.requestDisallowInterceptTouchEvent(true); true }
                MotionEvent.ACTION_MOVE -> {
                    vt?.addMovement(e)
                    val dy = e.rawY - startY
                    // rubber-band upwards, follow downwards
                    sheet.translationY = if (dy > 0) dy else dy * 0.12f
                    scrim.alpha = (1f - (dy / (sheet.height * 1.2f)).coerceIn(0f, 1f) * 0.8f)
                    true
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    vt?.computeCurrentVelocity(1000)
                    val vy = vt?.yVelocity ?: 0f
                    vt?.recycle(); vt = null
                    val dy = sheet.translationY
                    if (e.actionMasked == MotionEvent.ACTION_UP && (dy > sheet.height * 0.33f || vy > 1400f)) dismiss()
                    else {
                        sheet.animate().translationY(0f).setDuration(260).setInterpolator(ease).start()
                        scrim.animate().alpha(1f).setDuration(200).start()
                    }
                    true
                }
                else -> false
            }
        }
    }

    private fun dismiss() {
        if (isFinishing || dismissing) return
        dismissing = true
        scrim.animate().alpha(0f).setDuration(200).start()
        sheet.animate().translationY(sheet.height.toFloat() + dp(60)).alpha(0.4f).setDuration(220)
            .setInterpolator(PathInterpolator(0.4f, 0f, 1f, 1f)).setListener(object : AnimatorListenerAdapter() {
                override fun onAnimationEnd(a: Animator) { finish(); overridePendingTransition(0, 0) }
            }).start()
    }

    // ---- content swapping (crossfade, no layout jumps) ---------------------
    private fun swap(build: () -> Unit) {
        val apply = {
            content.removeAllViews(); build()
            content.alpha = 0f; content.translationY = dp(6).toFloat()
            content.animate().alpha(1f).translationY(0f).setDuration(220).setInterpolator(ease).start()
        }
        if (content.childCount == 0) apply()
        else content.animate().alpha(0f).setDuration(110).withEndAction { apply() }.start()
    }

    // ---- small view factories ---------------------------------------------
    private fun label(s: String, sp: Float, color: Int, style: Int = Typeface.NORMAL, mono: Boolean = false) = TextView(this).apply {
        text = s; setTextSize(TypedValue.COMPLEX_UNIT_SP, sp); setTextColor(color)
        typeface = if (mono) Typeface.create(Typeface.MONOSPACE, style) else Typeface.create("sans-serif-medium".takeIf { style == Typeface.BOLD } ?: "sans-serif", Typeface.NORMAL)
        includeFontPadding = false
    }

    private fun space(h: Int) = View(this).apply { layoutParams = LinearLayout.LayoutParams(-1, dp(h)) }

    /** Rounded icon badge with a glyph. */
    private fun badge(glyph: String, color: Int, sizeDp: Int = 34, glyphSp: Float = 16f) = TextView(this).apply {
        text = glyph; gravity = Gravity.CENTER; setTextColor(color); setTextSize(TypedValue.COMPLEX_UNIT_SP, glyphSp)
        typeface = Typeface.create("sans-serif-medium", Typeface.BOLD)
        includeFontPadding = false
        background = rounded(tint(color, 34), 11, tint(color, 90))
        layoutParams = LinearLayout.LayoutParams(dp(sizeDp), dp(sizeDp))
    }

    /** "Waiting" pill with a pinging dot: communicates the agent is blocked on the user. */
    private fun waitingPill(color: Int): View {
        val dot = View(this).apply { background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(color) } }
        val ring = View(this).apply { background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(color) }; alpha = 0f }
        val holder = FrameLayout(this).apply {
            addView(ring, FrameLayout.LayoutParams(dp(6), dp(6), Gravity.CENTER))
            addView(dot, FrameLayout.LayoutParams(dp(6), dp(6), Gravity.CENTER))
        }
        ring.animate().cancel()
        val ping = android.animation.ValueAnimator.ofFloat(0f, 1f).apply {
            duration = 1600; repeatCount = android.animation.ValueAnimator.INFINITE
            interpolator = PathInterpolator(0f, 0f, 0.2f, 1f)
            addUpdateListener { val t = it.animatedValue as Float; ring.scaleX = 0.7f + 1.6f * t; ring.scaleY = ring.scaleX; ring.alpha = 0.9f * (1f - t) }
        }
        ping.start()
        return LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(10), dp(5), dp(11), dp(5))
            background = rounded(tint(color, 24), 20)
            addView(holder, LinearLayout.LayoutParams(dp(10), dp(10)))
            addView(label("Waiting", 11f, color, Typeface.BOLD).apply { setPadding(dp(6), 0, 0, 0); letterSpacing = 0.04f })
        }
    }

    /** Press-scale + haptic. kind: primary | deny | quiet | choice */
    private fun action(text: String, kind: String, onClick: () -> Unit): TextView {
        val fill = when (kind) { "primary" -> brand; "deny" -> tint(danger, 28); "choice" -> surfaceHi; else -> Color.TRANSPARENT }
        val fg = when (kind) { "primary" -> onBrand; "deny" -> danger; "choice" -> ink; else -> muted }
        val stroke = when (kind) { "deny" -> tint(danger, 160); "choice" -> hairline; else -> null }
        return TextView(this).apply {
            this.text = text; gravity = Gravity.CENTER; setTextColor(fg)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, if (kind == "quiet") 13f else 15f)
            typeface = Typeface.create("sans-serif-medium", Typeface.BOLD)
            includeFontPadding = false
            background = rounded(fill, 14, stroke)
            minHeight = dp(if (kind == "quiet") 44 else 52)
            isClickable = true; isFocusable = true
            setOnTouchListener { v, e ->
                when (e.actionMasked) {
                    MotionEvent.ACTION_DOWN -> v.animate().scaleX(0.97f).scaleY(0.97f).setDuration(90).start()
                    MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> v.animate().scaleX(1f).scaleY(1f).setDuration(160).setInterpolator(ease).start()
                }
                false
            }
            setOnClickListener { if (!busy) { it.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY); onClick() } }
        }
    }

    private fun header(isApproval: Boolean, title: String, accent: Int): View {
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        row.addView(badge(if (isApproval) "!" else "?", accent))
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(12), 0, dp(8), 0) }
        col.addView(label(if (isApproval) "APPROVAL NEEDED" else "QUESTION FOR YOU", 10.5f, accent, Typeface.BOLD, mono = true).apply { letterSpacing = 0.14f })
        col.addView(label("Astra", 12.5f, muted).apply { setPadding(0, dp(3), 0, 0) })
        row.addView(col, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        row.addView(waitingPill(accent))
        return row
    }

    // ---- states ------------------------------------------------------------
    private fun showSkeleton() {
        content.removeAllViews()
        fun bar(w: Int, h: Int, r: Int = 8, top: Int = 12) = View(this).apply {
            background = rounded(surfaceHi, r)
            layoutParams = LinearLayout.LayoutParams(if (w < 0) -1 else dp(w), dp(h)).apply { topMargin = dp(top) }
            ObjectAnimator.ofFloat(this, "alpha", 0.35f, 1f).apply { duration = 760; repeatMode = ObjectAnimator.REVERSE; repeatCount = ObjectAnimator.INFINITE }.start()
        }
        val r = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        r.addView(bar(34, 34, 11, 0)); r.addView(bar(120, 12, 6, 0).apply { (layoutParams as LinearLayout.LayoutParams).marginStart = dp(12) })
        content.addView(r)
        content.addView(bar(-1, 20)); content.addView(bar(220, 20, 8, 8)); content.addView(bar(-1, 56, 12, 16))
        content.addView(bar(-1, 52, 14, 14))
    }

    private fun showSending(picked: View?) {
        busy = true
        // In-place: the tapped button becomes a spinner row, the rest dim. No layout jump.
        for (i in 0 until content.childCount) walkDim(content.getChildAt(i), picked)
        (picked as? TextView)?.let {
            it.text = "Sending…"
            it.animate().scaleX(1f).scaleY(1f).setDuration(120).start()
        }
    }

    private fun walkDim(v: View, keep: View?) {
        if (v === keep) return
        if (v is LinearLayout || v is FrameLayout) { for (i in 0 until (v as ViewGroup).childCount) walkDim(v.getChildAt(i), keep); return }
        if (v.isClickable) v.animate().alpha(0.35f).setDuration(160).start()
    }

    /** Result: mark pops in; tone 1 ok, -1 denied, 0 neutral. */
    private fun showResult(msg: String, sub: String, tone: Int, autoClose: Boolean) = runOnUiThread {
        busy = false
        val col = when (tone) { 1 -> okay; -1 -> danger; else -> muted }
        val glyph = when (tone) { 1 -> "✓"; -1 -> "✕"; else -> "•" }
        swap {
            val wrap = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL; setPadding(0, dp(14), 0, dp(6)) }
            val mark = badge(glyph, col, 64, 26f).apply {
                background = rounded(tint(col, 34), 32, col, 2)
                scaleX = 0.5f; scaleY = 0.5f; alpha = 0f
                animate().scaleX(1f).scaleY(1f).alpha(1f).setStartDelay(90).setDuration(380)
                    .setInterpolator(PathInterpolator(0.34f, 1.56f, 0.64f, 1f)).start()
            }
            wrap.addView(mark)
            wrap.addView(label(msg, 17f, ink, Typeface.BOLD).apply { gravity = Gravity.CENTER; setPadding(0, dp(14), 0, 0) })
            if (sub.isNotEmpty()) wrap.addView(label(sub, 13f, muted).apply { gravity = Gravity.CENTER; setPadding(dp(8), dp(6), dp(8), 0) })
            content.addView(wrap, LinearLayout.LayoutParams(-1, ViewGroup.LayoutParams.WRAP_CONTENT))
            if (!autoClose) {
                content.addView(space(14))
                content.addView(action("Close", "choice") { dismiss() }, LinearLayout.LayoutParams(-1, dp(52)))
            }
        }
        if (autoClose) {
            sheet.performHapticFeedback(if (tone >= 0) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.REJECT)
            sheet.postDelayed({ dismiss() }, 1100)
        }
    }

    // ---- data --------------------------------------------------------------
    private fun creds(): Pair<String, String>? {
        val prefs = getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
        val parts = (prefs.getString("ntfy_conn", "") ?: "").split("|")
        return if (parts.size >= 3) Pair(BASE, "Basic ${parts[2]}") else null
    }

    private fun load() {
        val (base, auth) = creds() ?: run { runOnUiThread { openChatFallback() }; return }
        try {
            http.newCall(Request.Builder().url("$base/api/gate/$gateId").header("Authorization", auth).build())
                .execute().use { r ->
                    val body = r.body?.string() ?: ""
                    when {
                        r.code == 404 -> showResult("No longer pending", "This request expired or was answered elsewhere.", 0, false)
                        !r.isSuccessful -> runOnUiThread { openChatFallback() }
                        else -> {
                            val g = JSONObject(body)
                            if (g.optBoolean("answered")) showResult("Already answered", "Answered on another device.", 0, false)
                            else runOnUiThread { render(g) }
                        }
                    }
                }
        } catch (e: Exception) {
            runOnUiThread { openChatFallback() }
        }
    }

    private fun post(payload: JSONObject, picked: View?, denied: Boolean = false) {
        showSending(picked)
        if (debugJson != null) {
            sheet.postDelayed({ showResult(if (denied) "Denied" else "Approved", "", if (denied) -1 else 1, true) }, 900)
            return
        }
        val (base, auth) = creds() ?: run { busy = false; openChatFallback(); return }
        thread {
            try {
                val req = Request.Builder().url("$base/api/gate/$gateId").header("Authorization", auth)
                    .post(payload.toString().toRequestBody("application/json".toMediaType())).build()
                http.newCall(req).execute().use { r ->
                    when {
                        r.isSuccessful -> {
                            cancelNotification()
                            val ok = if (denied) "Denied" else if (payload.has("choice")) "Approved" else "Answer sent"
                            showResult(ok, if (denied) "Astra will not run it." else "Astra is continuing.", if (denied) -1 else 1, true)
                        }
                        r.code == 409 -> showResult("Already answered", "Answered on another device.", 0, false)
                        else -> runOnUiThread { failBack("Couldn't deliver (${r.code}). Try again or open the chat.") }
                    }
                }
            } catch (e: Exception) {
                runOnUiThread { failBack("No connection. Try again or open the chat.") }
            }
        }
    }

    /** Delivery failed: restore the controls in place with an inline error, never a toast + bounce. */
    private var lastGate: JSONObject? = null
    private fun failBack(msg: String) {
        busy = false
        lastGate?.let { render(it, errorLine = msg) } ?: openChatFallback()
        sheet.performHapticFeedback(HapticFeedbackConstants.REJECT)
    }

    private fun cancelNotification() {
        if (notifId != 0) (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).cancel(notifId)
    }

    private fun openChatFallback() {
        val chat = intent.getStringExtra(EXTRA_CLICK) ?: ""
        val i = Intent(this, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            data = Uri.parse("astra://open?path=" + (try { Uri.parse(chat).path ?: "/" } catch (e: Exception) { "/" }))
            addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        startActivity(i)
        finish()
        overridePendingTransition(0, 0)
    }

    // ---- render ------------------------------------------------------------
    private fun render(g: JSONObject, errorLine: String? = null) {
        lastGate = g
        val isApproval = g.optString("kind") == "approval"
        // A command about to run is the riskier gate: amber accent. Questions use brand cyan.
        val accent = if (isApproval && g.optString("command").isNotEmpty()) warn else brand
        swap {
            content.addView(header(isApproval, g.optString("title"), accent))
            if (isApproval) renderApproval(g, accent) else renderClarify(g)
            if (errorLine != null) {
                content.addView(label(errorLine, 12.5f, danger).apply { setPadding(0, dp(12), 0, 0) })
            }
            content.addView(action("Open in chat", "quiet") { openChatFallback() },
                LinearLayout.LayoutParams(-1, dp(44)).apply { topMargin = dp(6) })
        }
    }

    private fun renderApproval(g: JSONObject, accent: Int) {
        val cmd = g.optString("command")
        val desc = g.optString("description")
        val whatItDoes = g.optString("whatItDoes")
        val impact = g.optString("impact")
        val severity = g.optString("severity", "moderate")
        val risk = g.optString("risk")
        
        val sevColor = when (severity) {
            "low" -> muted
            "high" -> c("#FB923C", "#C2410C")
            "critical" -> danger
            else -> warn
        }

        if (cmd.isNotEmpty()) {
            val box = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                setPadding(dp(12), dp(11), dp(12), dp(11))
                background = rounded(well, 12, hairline)
            }
            box.addView(label("$", 13f, accent, Typeface.BOLD, mono = true).apply { setPadding(0, 0, dp(8), 0) })
            val tv = label(cmd, 13f, ink, mono = true).apply {
                maxLines = 2; ellipsize = TextUtils.TruncateAt.END; setLineSpacing(0f, 1.25f)
            }
            box.addView(tv, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            content.addView(box, LinearLayout.LayoutParams(-1, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(14) })
            
            val toggle = label("Show full command", 11.5f, muted).apply { setPadding(dp(2), dp(6), 0, 0) }
            box.setOnClickListener {
                val open = tv.maxLines == Int.MAX_VALUE
                tv.maxLines = if (open) 2 else Int.MAX_VALUE
                toggle.text = if (open) "Show full command" else "Hide full command"
                it.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
            }
            tv.post { if (tv.layout != null && tv.layout.getEllipsisCount(tv.lineCount - 1) > 0)
                content.addView(toggle, content.indexOfChild(box) + 1) }
        }

        val heading = whatItDoes.ifEmpty { desc.ifEmpty { if (cmd.isNotEmpty()) "Astra wants to run a command" else "Astra is asking permission to continue." } }
        content.addView(label(
            heading,
            18f, ink, Typeface.BOLD
        ).apply { setLineSpacing(0f, 1.12f); setPadding(0, dp(16), 0, dp(14)) })

        content.addView(label("IMPACT", 9.5f, muted, mono = true).apply { letterSpacing = 0.14f })
        val impactRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(0, dp(6), 0, dp(14)) }
        impactRow.addView(label(severity.uppercase(), 10.5f, sevColor, Typeface.BOLD, mono = true).apply {
            letterSpacing = 0.1f; background = rounded(tint(sevColor, 26), 12); setPadding(dp(8), dp(2), dp(8), dp(2))
        })
        impactRow.addView(label(impact.ifEmpty { "System state modified" }, 13f, ink).apply { setPadding(dp(8), 0, 0, 0) })
        content.addView(impactRow)

        content.addView(label("RISK", 9.5f, muted, mono = true).apply { letterSpacing = 0.14f })
        val riskRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.TOP; setPadding(0, dp(6), 0, dp(14)) }
        val rIcon = if (severity == "high" || severity == "critical") badge("⚠", warn, 16, 10f) else badge("•", muted, 16, 12f)
        riskRow.addView(rIcon.apply { (layoutParams as LinearLayout.LayoutParams).topMargin = dp(2) })
        riskRow.addView(label(risk.ifEmpty { "Please review carefully." }, 13f, muted).apply { setLineSpacing(0f, 1.2f); setPadding(dp(8), 0, 0, 0) })
        content.addView(riskRow)

        if (severity == "critical") {
            content.addView(View(this).apply { background = GradientDrawable().apply { setColor(tint(danger, 70)) }; layoutParams = LinearLayout.LayoutParams(-1, dp(2)).apply { topMargin = dp(4); bottomMargin = dp(10) } })
        }

        val choices = g.optJSONArray("choices") ?: JSONArray().put("once").put("deny")
        val labels = mapOf("once" to "Approve", "session" to "Allow for this chat", "always" to "Always allow", "deny" to "Deny")
        val list = (0 until choices.length()).map { choices.getString(it) }
        val extras = list.filter { it != "once" && it != "deny" }
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val gap = dp(10)
        
        if ("deny" in list) {
            var b: TextView? = null
            b = action(labels["deny"]!!, "deny") { post(JSONObject().put("choice", "deny"), b, denied = true) }
            if (severity == "critical") b.background = rounded(tint(danger, 28), 14, tint(danger, 200), 2)
            row.addView(b, LinearLayout.LayoutParams(0, dp(52), 1f))
        }
        if ("once" in list) {
            var b: TextView? = null
            b = action(labels["once"]!!, "primary") { post(JSONObject().put("choice", "once"), b) }
            row.addView(b, LinearLayout.LayoutParams(0, dp(52), 1.5f).apply { if (row.childCount > 0) marginStart = gap })
        }
        for (c in extras) {
            var b: TextView? = null
            b = action(labels[c] ?: c, "choice") { post(JSONObject().put("choice", c), b) }
            content.addView(b, LinearLayout.LayoutParams(-1, dp(52)).apply { topMargin = dp(10) })
        }
        content.addView(row, LinearLayout.LayoutParams(-1, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(10) })
        content.addView(label("Astra is paused until you decide.", 12f, muted).apply { gravity = Gravity.CENTER; setPadding(0, dp(12), 0, 0) },
            LinearLayout.LayoutParams(-1, ViewGroup.LayoutParams.WRAP_CONTENT))
    }

    private fun renderClarify(g: JSONObject) {
        val qs = g.optJSONArray("questions") ?: JSONArray()
        val picks = HashMap<String, MutableList<String>>()
        val freeTexts = HashMap<String, EditText>()
        val keys = ArrayList<String>()
        lateinit var send: TextView
        fun answerOf(k: String): String {
            val p = (picks[k] ?: mutableListOf()).joinToString(", ")
            val x = freeTexts[k]?.text?.toString()?.trim() ?: ""
            return if (p.isNotEmpty() && x.isNotEmpty()) "$p - $x" else p.ifEmpty { x }
        }
        // Send stays quiet until every question has an answer, then lifts.
        fun refreshSend() {
            val ready = keys.isNotEmpty() && keys.all { answerOf(it).isNotEmpty() }
            send.isEnabled = ready
            (send.background as GradientDrawable).setColor(if (ready) brand else surfaceHi)
            send.setTextColor(if (ready) onBrand else muted)
            send.text = if (ready) "Send answer" else "Choose or type an answer"
        }
        for (i in 0 until qs.length()) {
            val q = qs.getJSONObject(i)
            val question = q.optString("question")
            val key = q.optString("qid").ifEmpty { question }
            keys.add(key)
            content.addView(label((if (qs.length() > 1) "${i + 1}. " else "") + question, 18f, ink, Typeface.BOLD)
                .apply { setLineSpacing(0f, 1.12f); setPadding(0, dp(if (i == 0) 16 else 22), 0, 0) })
            val multi = q.optBoolean("multi_select")
            if (multi) content.addView(label("Select all that apply", 12f, muted).apply { setPadding(0, dp(6), 0, 0) })
            val choices = q.optJSONArray("choices") ?: JSONArray()
            val list = picks.getOrPut(key) { mutableListOf() }
            val rows = ArrayList<Triple<String, LinearLayout, TextView>>()
            fun paint() = rows.forEach { (c, r, mark) ->
                val on = list.contains(c)
                r.background = rounded(if (on) tint(brand, 30) else surfaceHi, 14, if (on) brand else tint(muted, 110), if (on) 2 else 1)
                mark.text = if (on) "✓" else ""
                mark.background = if (on) rounded(brand, if (multi) 7 else 11) else rounded(Color.TRANSPARENT, if (multi) 7 else 11, muted, 2)
                mark.setTextColor(onBrand)
            }
            for (j in 0 until choices.length()) {
                val c = choices.getString(j)
                val mark = TextView(this).apply {
                    gravity = Gravity.CENTER; setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f); includeFontPadding = false
                    typeface = Typeface.create("sans-serif-medium", Typeface.BOLD)
                }
                val r = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
                    setPadding(dp(14), dp(12), dp(14), dp(12)); minimumHeight = dp(52)
                    isClickable = true
                    setOnTouchListener { v, e ->
                        when (e.actionMasked) {
                            MotionEvent.ACTION_DOWN -> v.animate().scaleX(0.985f).scaleY(0.985f).setDuration(90).start()
                            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> v.animate().scaleX(1f).scaleY(1f).setDuration(160).setInterpolator(ease).start()
                        }
                        false
                    }
                    setOnClickListener {
                        it.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                        if (multi) { if (!list.remove(c)) list.add(c) } else { list.clear(); list.add(c) }
                        paint(); refreshSend()
                    }
                }
                r.addView(mark, LinearLayout.LayoutParams(dp(22), dp(22)).apply { marginEnd = dp(12) })
                r.addView(label(c, 15f, ink, Typeface.BOLD).apply { setLineSpacing(0f, 1.1f) }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
                rows.add(Triple(c, r, mark))
                content.addView(r, LinearLayout.LayoutParams(-1, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(if (j == 0) 14 else 8) })
            }
            paint()
            val et = EditText(this).apply {
                hint = if (choices.length() > 0) "Or type your own answer" else "Type your answer"
                setHintTextColor(tint(muted, 200)); setTextColor(ink); setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
                inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
                background = rounded(well, 14, tint(muted, 110))
                setPadding(dp(14), dp(13), dp(14), dp(13))
                addTextChangedListener(object : android.text.TextWatcher {
                    override fun afterTextChanged(s: android.text.Editable?) { refreshSend() }
                    override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                    override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                })
                setOnFocusChangeListener { v, f -> v.background = rounded(well, 14, if (f) brand else tint(muted, 110), if (f) 2 else 1) }
            }
            freeTexts[key] = et
            content.addView(et, LinearLayout.LayoutParams(-1, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(10) })
        }
        send = action("Send answer", "primary") {
            val single = qs.length() == 1 && qs.getJSONObject(0).optString("qid").isEmpty()
            val body = if (single) JSONObject().put("answer", answerOf(keys[0]))
            else JSONObject().put("answers", JSONObject().also { a -> keys.forEach { k -> a.put(k, answerOf(k)) } })
            post(body, send)
        }
        content.addView(send, LinearLayout.LayoutParams(-1, dp(52)).apply { topMargin = dp(16) })
        refreshSend()
    }

    companion object {
        const val EXTRA_GATE_ID = "gate_id"
        const val EXTRA_NOTIF_ID = "notif_id"
        const val EXTRA_CLICK = "click"
        const val BASE = "https://astra.jitinnair.com"
    }
}
