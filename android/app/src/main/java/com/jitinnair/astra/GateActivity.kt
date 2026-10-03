package com.jitinnair.astra

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
import android.text.InputType
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.animation.PathInterpolator
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
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
 * Interactive approval / question popup (centered dialog, minimal).
 * Launched by the push notification (tap, or lock-screen full-screen intent).
 * Fetches the pending gate from the Astra server, renders it as a centered
 * card and posts the answer straight back.
 *
 * Layout: scrim + centered sheet. Sheet = scrollable body (capped at ~62% of
 * the screen, so long question lists scroll INSIDE the card) + fixed footer
 * that always holds the actions (Approve / Deny / Send never scroll away).
 *
 * States: loading (skeleton) -> ready -> sending (in-place) -> result
 * (approved / denied / already answered) -> animated dismiss.
 * Light/dark themed, Astra brand tokens, brand easing curve.
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
    private lateinit var sheet: LinearLayout       // centered card
    private lateinit var content: LinearLayout     // scrollable body
    private lateinit var foot: LinearLayout        // pinned actions

    // ---- brand tokens (index.css @theme + [data-theme="light"]) -------------
    // The ACTIVE palette, pushed from the web theme engine and read through AstraThemeRead, so the
    // card follows whichever theme the user picked. `light` is kept only to pick the FALLBACK
    // column when a token is missing from storage (fresh install / cleared prefs) — it is no
    // longer the sole source of colour.
    private var light = false
    private val theme: AstraTokenMath.Tokens get() = AstraThemeRead.tokens(this)
    private fun c(d: String, l: String) = Color.parseColor(if (light) l else d)
    private val surface get() = AstraThemeRead.parseHex(theme.surface, c("#12121A", "#FDFCF9"))
    private val surfaceHi get() = AstraThemeRead.parseHex(theme.surfaceHi, c("#1A1A2E", "#ECE8DF"))
    private val hairline get() = AstraThemeRead.parseHex(theme.hairline, c("#252538", "#E1DCD1"))
    private val well get() = AstraThemeRead.parseHex(theme.void, c("#0A0A0F", "#F5F2EC"))
    private val ink get() = AstraThemeRead.parseHex(theme.ink, c("#F8FAFC", "#0F172A"))
    private val muted get() = AstraThemeRead.parseHex(theme.muted, c("#9AA3B2", "#5B6472"))
    private val brand get() = AstraThemeRead.parseHex(theme.accent, c("#22D3EE", "#0369A1"))   // cyanx
    // Text ON the accent fill. Derived by luminance, not hardcoded: a pale accent (Fire/Wind light)
    // needs dark text or the Allow button fails contrast. Previously a fixed dark-ink/white pair,
    // which was wrong for every non-Astra palette.
    private val onBrand get() = AstraThemeRead.parseHex(AstraTokenMath.onAccent(theme.accent), Color.BLACK)
    private val danger get() = AstraThemeRead.parseHex(theme.danger, c("#F87171", "#B91C1C"))
    private val okay = AstraThemeRead.parseHex(theme.okay, Color.parseColor("#10B981"))

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

    /** ScrollView that never grows past maxPx — the card scrolls internally. */
    private class MaxHScrollView(ctx: Context, private val maxPx: Int) : ScrollView(ctx) {
        override fun onMeasure(w: Int, h: Int) {
            val capped = if (maxPx > 0) MeasureSpec.makeMeasureSpec(maxPx, MeasureSpec.AT_MOST) else h
            super.onMeasure(w, capped)
        }
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

    // ---- shell: scrim + centered card --------------------------------------
    private fun buildShell() {
        root = FrameLayout(this)
        // Scrim: derived from the theme so it reads as a themed veil over the app behind the popup,
        // not a fixed grey. Heavy enough in dark (the popup is the focus), much lighter in light
        // (paper does not need suppressing as hard). Built with tint() rather than an alpha hex,
        // because Android's Color.parseColor reads #AARRGGBB while CSS writes #rrggbbaa — mixing
        // the two silently swaps the channels.
        scrim = View(this).apply {
            setBackgroundColor(tint(well, if (light) 0x66 else 0xB3))
            alpha = 0f
            setOnClickListener { if (!busy) dismiss() }
        }
        root.addView(scrim, FrameLayout.LayoutParams(-1, -1))

        sheet = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = rounded(surface, 26, hairline)
            elevation = dp(18).toFloat()
            // stop taps inside the card from reaching the scrim
            isClickable = true
        }

        content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(22), dp(20), dp(22), dp(16))
        }
        // Body scrolls once the gate is taller than ~62% of the screen.
        val maxBody = (resources.displayMetrics.heightPixels * 0.62f).toInt()
        val scroll = MaxHScrollView(this, maxBody).apply {
            isVerticalScrollBarEnabled = false; overScrollMode = View.OVER_SCROLL_NEVER; addView(content)
        }
        sheet.addView(scroll, LinearLayout.LayoutParams(-1, ViewGroup.LayoutParams.WRAP_CONTENT))

        foot = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(22), dp(6), dp(22), dp(18))
        }
        sheet.addView(foot, LinearLayout.LayoutParams(-1, ViewGroup.LayoutParams.WRAP_CONTENT))

        val cardW = minOf(resources.displayMetrics.widthPixels - dp(40), dp(400))
        val lp = FrameLayout.LayoutParams(cardW, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER)
        root.addView(sheet, lp)
        setContentView(root)

        // stay inside the status bar / gesture bar / keyboard
        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            val b = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            lp.topMargin = b.top + dp(10)
            lp.bottomMargin = maxOf(b.bottom, ime.bottom) + dp(10)
            sheet.layoutParams = lp
            insets
        }

        // entrance: scrim fades, card scales in from 0.95 (never from 0)
        sheet.alpha = 0f; sheet.scaleX = 0.95f; sheet.scaleY = 0.95f
        sheet.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(260).setInterpolator(ease).start()
        scrim.animate().alpha(1f).setDuration(200).start()
    }

    private fun dismiss() {
        if (isFinishing || dismissing) return
        dismissing = true
        scrim.animate().alpha(0f).setDuration(160).start()
        sheet.animate().scaleX(0.96f).scaleY(0.96f).alpha(0f).setDuration(180)
            .setInterpolator(PathInterpolator(0.4f, 0f, 1f, 1f)).setListener(object : AnimatorListenerAdapter() {
                override fun onAnimationEnd(a: android.animation.Animator) { finish(); overridePendingTransition(0, 0) }
            }).start()
    }

    // ---- content swapping (crossfade, no layout jumps) ---------------------
    private fun swap(body: (LinearLayout.() -> Unit)?, footer: (LinearLayout.() -> Unit)? = null) {
        val apply = {
            content.removeAllViews(); body?.invoke(content)
            foot.removeAllViews(); footer?.invoke(foot)
            if (foot.childCount == 0) foot.visibility = View.GONE else {
                foot.visibility = View.VISIBLE
                // hairline divider between scroll area and pinned actions
                foot.addView(View(this).apply { background = rounded(hairline, 0) },
                    0, LinearLayout.LayoutParams(-1, dp(1)).apply { bottomMargin = dp(12) })
            }
            content.alpha = 0f; content.translationY = dp(6).toFloat()
            content.animate().alpha(1f).translationY(0f).setDuration(220).setInterpolator(ease).start()
            if (foot.visibility == View.VISIBLE) { foot.alpha = 0f; foot.animate().alpha(1f).setDuration(220).setInterpolator(ease).start() }
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

    /** Rounded icon badge with a glyph. */
    private fun badge(glyph: String, color: Int, sizeDp: Int = 34, glyphSp: Float = 16f) = TextView(this).apply {
        text = glyph; gravity = Gravity.CENTER; setTextColor(color); setTextSize(TypedValue.COMPLEX_UNIT_SP, glyphSp)
        typeface = Typeface.create("sans-serif-medium", Typeface.BOLD)
        includeFontPadding = false
        background = rounded(tint(color, 34), 11, tint(color, 90))
        layoutParams = LinearLayout.LayoutParams(dp(sizeDp), dp(sizeDp))
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
            minHeight = dp(if (kind == "quiet") 40 else 52)
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

    /** One-line header: badge + eyebrow. Owner 2026-10-02: the Waiting pill is
     *  gone — the accent badge + "decide" footer line already say it's blocked. */
    private fun header(isApproval: Boolean, accent: Int): View {
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        row.addView(badge(if (isApproval) "!" else "?", accent))
        row.addView(label(if (isApproval) "APPROVAL NEEDED" else "QUESTION FOR YOU", 10.5f, accent, Typeface.BOLD, mono = true)
            .apply { letterSpacing = 0.14f; setPadding(dp(12), 0, 0, 0) })
        return row
    }

    // ---- states ------------------------------------------------------------
    private fun showSkeleton() {
        swap(body = {
            fun bar(w: Int, h: Int, r: Int = 8, top: Int = 12) = View(this@GateActivity).apply {
                background = rounded(surfaceHi, r)
                layoutParams = LinearLayout.LayoutParams(if (w < 0) -1 else dp(w), dp(h)).apply { topMargin = dp(top) }
                ObjectAnimator.ofFloat(this, "alpha", 0.35f, 1f).apply { duration = 760; repeatMode = ObjectAnimator.REVERSE; repeatCount = ObjectAnimator.INFINITE }.start()
            }
            val r = LinearLayout(this@GateActivity).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            r.addView(bar(34, 34, 11, 0)); r.addView(bar(120, 12, 6, 0).apply { (layoutParams as LinearLayout.LayoutParams).marginStart = dp(12) })
            addView(r)
            addView(bar(-1, 20)); addView(bar(220, 20, 8, 8)); addView(bar(-1, 56, 12, 16))
        })
    }

    private fun showSending(picked: View?) {
        busy = true
        // In-place: the tapped button becomes a spinner row, the rest dim. No layout jump.
        for (i in 0 until sheet.childCount) walkDim(sheet.getChildAt(i), picked)
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

    /** In-card sent receipt (owner 2026-10-02): the confirmation lives in the
     *  SAME card — request content animates out, a compact receipt morphs in
     *  with a spring-pop mark, then the whole card exits via the standard
     *  dismiss animation. No second popup, ever. */
    private fun showSent(msg: String, sub: String, tone: Int) = runOnUiThread {
        busy = false
        val col = when (tone) { 1 -> okay; -1 -> danger; else -> muted }
        val glyph = when (tone) { 1 -> "✓"; -1 -> "✕"; else -> "•" }
        // Phase 1: the request sinks away (fade + slight rise), actions fade with it.
        content.animate().alpha(0f).translationY(dp(-8).toFloat()).setDuration(190)
            .setInterpolator(ease).setListener(object : AnimatorListenerAdapter() {
                override fun onAnimationEnd(a: android.animation.Animator) {
                    foot.visibility = View.GONE
                    content.removeAllViews()
                    content.translationY = dp(10).toFloat()
                    // Phase 2: horizontal receipt morphs in, mark springs.
                    val row = LinearLayout(this@GateActivity).apply {
                        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
                        setPadding(0, dp(4), 0, dp(2))
                    }
                    val mark = badge(glyph, col, 40, 17f).apply {
                        background = rounded(tint(col, 34), 20, col, 2)
                        scaleX = 0.4f; scaleY = 0.4f; alpha = 0f
                        animate().scaleX(1f).scaleY(1f).alpha(1f).setStartDelay(40).setDuration(340)
                            .setInterpolator(PathInterpolator(0.34f, 1.56f, 0.64f, 1f)).start()
                    }
                    row.addView(mark)
                    val textCol = LinearLayout(this@GateActivity).apply { orientation = LinearLayout.VERTICAL }
                    textCol.addView(label(msg, 15.5f, ink, Typeface.BOLD).apply { setPadding(dp(14), 0, 0, 0) })
                    if (sub.isNotEmpty()) textCol.addView(label(sub, 12.5f, muted).apply { setPadding(dp(14), dp(3), 0, 0) })
                    row.addView(textCol)
                    content.addView(row)
                    content.animate().alpha(1f).translationY(0f).setDuration(220)
                        .setInterpolator(ease).setListener(null).start()
                    sheet.performHapticFeedback(if (tone >= 0) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.REJECT)
                    sheet.postDelayed({ dismiss() }, 1050)
                }
            })
        foot.animate().alpha(0f).setDuration(150).start()
    }

    /** Result: mark pops in; tone 1 ok, -1 denied, 0 neutral. (Error/expiry states only —
     *  the success path uses showSent, which stays inside the original card.) */
    private fun showResult(msg: String, sub: String, tone: Int, autoClose: Boolean) = runOnUiThread {
        busy = false
        val col = when (tone) { 1 -> okay; -1 -> danger; else -> muted }
        val glyph = when (tone) { 1 -> "✓"; -1 -> "✕"; else -> "•" }
        swap(body = {
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(22), dp(26), dp(22), dp(10))
            val mark = badge(glyph, col, 64, 26f).apply {
                background = rounded(tint(col, 34), 32, col, 2)
                scaleX = 0.5f; scaleY = 0.5f; alpha = 0f
                animate().scaleX(1f).scaleY(1f).alpha(1f).setStartDelay(90).setDuration(380)
                    .setInterpolator(PathInterpolator(0.34f, 1.56f, 0.64f, 1f)).start()
            }
            addView(mark)
            addView(label(msg, 17f, ink, Typeface.BOLD).apply { gravity = Gravity.CENTER; setPadding(0, dp(14), 0, 0) })
            if (sub.isNotEmpty()) addView(label(sub, 13f, muted).apply { gravity = Gravity.CENTER; setPadding(dp(8), dp(6), dp(8), 0) })
        }, footer = {
            if (!autoClose) {
                addView(action("Close", "choice") { dismiss() }, LinearLayout.LayoutParams(-1, dp(52)))
            }
        })
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
            sheet.postDelayed({ showSent(if (denied) "Denied" else "Approval sent", "", if (denied) -1 else 1) }, 900)
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
                            val ok = if (denied) "Denied" else if (payload.has("choice")) "Approval sent" else "Answer sent"
                            showSent(ok, if (denied) "Astra won't run it." else "Astra is continuing.", if (denied) -1 else 1)
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
        // Owner order 2026-10-02: yellow is out — every gate wears the brand
        // teal; severity still reads on the meta row next to the command.
        val accent = brand
        swap(
            body = {
                addView(header(isApproval, accent))
                if (isApproval) renderApprovalBody(g, this, accent)
                else renderClarifyBody(g, this)
                if (errorLine != null) {
                    addView(label(errorLine, 12.5f, danger).apply { setPadding(0, dp(12), 0, 0) })
                }
            },
            footer = {
                if (isApproval) renderApprovalFooter(g, this)
                else renderClarifyFooter(g, this)
                addView(action("Open in chat", "quiet") { openChatFallback() },
                    LinearLayout.LayoutParams(-1, dp(40)).apply { topMargin = dp(4) })
            }
        )
    }

    /** Minimal approval body: heading -> command -> one severity line. */
    private fun renderApprovalBody(g: JSONObject, box: LinearLayout, accent: Int) {
        val cmd = g.optString("command")
        val desc = g.optString("description")
        val whatItDoes = g.optString("whatItDoes")
        val severity = g.optString("severity", "moderate")
        val risk = g.optString("risk")
        val impact = g.optString("impact")

        val sevColor = when (severity) {
            "low" -> muted
            "high" -> AstraThemeRead.parseHex(theme.amber, c("#FB923C", "#C2410C"))
            "critical" -> danger
            else -> brand   // moderate: brand teal (amber retired 2026-10-02)
        }

        val heading = whatItDoes.ifEmpty { desc.ifEmpty { if (cmd.isNotEmpty()) "Astra wants to run a command" else "Astra is asking permission to continue." } }
        box.addView(label(heading, 18f, ink, Typeface.BOLD)
            .apply { setLineSpacing(0f, 1.12f); setPadding(0, dp(16), 0, dp(14)) })

        if (cmd.isNotEmpty()) {
            val wellBox = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                setPadding(dp(12), dp(11), dp(12), dp(11))
                background = rounded(well, 12, hairline)
            }
            wellBox.addView(label("$", 13f, accent, Typeface.BOLD, mono = true).apply { setPadding(0, 0, dp(8), 0) })
            val tv = label(cmd, 13f, ink, mono = true).apply {
                maxLines = 2; ellipsize = TextUtils.TruncateAt.END; setLineSpacing(0f, 1.25f)
            }
            wellBox.addView(tv, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            box.addView(wellBox, LinearLayout.LayoutParams(-1, ViewGroup.LayoutParams.WRAP_CONTENT))

            val toggle = label("Show full command", 11.5f, muted).apply { setPadding(dp(2), dp(6), 0, 0) }
            wellBox.setOnClickListener {
                val open = tv.maxLines == Int.MAX_VALUE
                tv.maxLines = if (open) 2 else Int.MAX_VALUE
                toggle.text = if (open) "Show full command" else "Hide full command"
                it.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
            }
            tv.post { if (tv.layout != null && tv.layout.getEllipsisCount(tv.lineCount - 1) > 0)
                box.addView(toggle, box.indexOfChild(wellBox) + 1) }
        }

        // One meta line: severity dot + label, then risk (or impact) under it. No section eyebrows.
        val sevRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(0, dp(6), 0, 0) }
        sevRow.addView(View(this).apply {
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(sevColor) }
            layoutParams = LinearLayout.LayoutParams(dp(7), dp(7))
        })
        sevRow.addView(label(severity.uppercase(), 10.5f, sevColor, Typeface.BOLD, mono = true).apply {
            letterSpacing = 0.1f; setPadding(dp(8), 0, 0, 0)
        })
        val metaText = risk.ifEmpty { impact.ifEmpty { "Review before approving." } }
        sevRow.addView(label(metaText, 12f, muted).apply { setPadding(dp(8), 0, 0, 0) }, 
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        box.addView(sevRow)
    }

    /** Pinned footer for approvals. Owner order 2026-10-02: exactly three
     *  choices — Allow once / Allow for this chat / Deny — "Always allow" is
     *  removed even when the gateway offers it. Deny sits left (Material:
     *  dismissive left of confirming), primary fills right. */
    private fun renderApprovalFooter(g: JSONObject, box: LinearLayout) {
        val severity = g.optString("severity", "moderate")
        val choices = g.optJSONArray("choices") ?: JSONArray().put("once").put("deny")
        val labels = mapOf("once" to "Allow once", "session" to "Allow for this chat", "always" to "Always allow", "deny" to "Deny")
        val list = (0 until choices.length()).map { choices.getString(it) }.filter { it != "always" }
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
        for (e in extras) {
            var b: TextView? = null
            b = action(labels[e] ?: e, "choice") { post(JSONObject().put("choice", e), b) }
            box.addView(b, LinearLayout.LayoutParams(-1, dp(52)).apply { topMargin = dp(10) })
        }
        if (row.childCount > 0) box.addView(row, LinearLayout.LayoutParams(-1, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            // gap between the full-width "Allow for this chat" (extras) and the
            // Deny / Allow once row — was touching (owner 2026-10-02)
            if (box.childCount > 0) topMargin = dp(10)
        })
        box.addView(label("Astra is paused until you decide.", 12f, muted).apply { gravity = Gravity.CENTER; setPadding(0, dp(12), 0, 0) },
            LinearLayout.LayoutParams(-1, ViewGroup.LayoutParams.WRAP_CONTENT))
    }

    /** Question body: choices + free text per question (scrolls when long). */
    private fun renderClarifyBody(g: JSONObject, box: LinearLayout) {
        val qs = g.optJSONArray("questions") ?: JSONArray()
        clarifyPicks.clear(); clarifyTexts.clear(); clarifyKeys.clear()
        for (i in 0 until qs.length()) {
            val q = qs.getJSONObject(i)
            val question = q.optString("question")
            val key = q.optString("qid").ifEmpty { question }
            clarifyKeys.add(key)
            box.addView(label((if (qs.length() > 1) "${i + 1}. " else "") + question, 18f, ink, Typeface.BOLD)
                .apply { setLineSpacing(0f, 1.12f); setPadding(0, dp(if (i == 0) 16 else 22), 0, 0) })
            val multi = q.optBoolean("multi_select")
            if (multi) box.addView(label("Select all that apply", 12f, muted).apply { setPadding(0, dp(6), 0, 0) })
            val choices = q.optJSONArray("choices") ?: JSONArray()
            val list = clarifyPicks.getOrPut(key) { mutableListOf() }
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
                box.addView(r, LinearLayout.LayoutParams(-1, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(if (j == 0) 14 else 8) })
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
            clarifyTexts[key] = et
            box.addView(et, LinearLayout.LayoutParams(-1, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(10) })
        }
    }

    // clarify answer state lives between body (inputs) and footer (send button)
    private val clarifyPicks = HashMap<String, MutableList<String>>()
    private val clarifyTexts = HashMap<String, EditText>()
    private val clarifyKeys = ArrayList<String>()
    private var sendBtn: TextView? = null

    private fun answerOf(k: String): String {
        val p = (clarifyPicks[k] ?: mutableListOf()).joinToString(", ")
        val x = clarifyTexts[k]?.text?.toString()?.trim() ?: ""
        return if (p.isNotEmpty() && x.isNotEmpty()) "$p - $x" else p.ifEmpty { x }
    }

    /** Send stays quiet until every question has an answer, then lifts. */
    private fun refreshSend() {
        val send = sendBtn ?: return
        val ready = clarifyKeys.isNotEmpty() && clarifyKeys.all { answerOf(it).isNotEmpty() }
        send.isEnabled = ready
        (send.background as GradientDrawable).setColor(if (ready) brand else surfaceHi)
        send.setTextColor(if (ready) onBrand else muted)
        send.text = if (ready) "Send answer" else "Choose or type an answer"
    }

    private fun renderClarifyFooter(g: JSONObject, box: LinearLayout) {
        val qs = g.optJSONArray("questions") ?: JSONArray()
        val send = action("Send answer", "primary") {
            val single = qs.length() == 1 && qs.getJSONObject(0).optString("qid").isEmpty()
            val body = if (single) JSONObject().put("answer", answerOf(clarifyKeys[0]))
            else JSONObject().put("answers", JSONObject().also { a -> clarifyKeys.forEach { k -> a.put(k, answerOf(k)) } })
            post(body, sendBtn)
        }
        sendBtn = send
        box.addView(send, LinearLayout.LayoutParams(-1, dp(52)).apply { topMargin = dp(6) })
        refreshSend()
    }

    companion object {
        const val EXTRA_GATE_ID = "gate_id"
        const val EXTRA_NOTIF_ID = "notif_id"
        const val EXTRA_CLICK = "click"
        const val BASE = "https://astra.jitinnair.com"
    }
}
