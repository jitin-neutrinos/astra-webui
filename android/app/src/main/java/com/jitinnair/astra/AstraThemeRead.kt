package com.jitinnair.astra

import android.content.Context
import android.content.SharedPreferences
import android.graphics.Color

/**
 * Reads the ACTIVE palette out of CapacitorStorage and hands native surfaces a typed token set.
 *
 * The web theme engine is the single source of truth. On every `astra-theme-change` it writes the
 * resolved palette here (src/native/shell-theme.ts) as flat `#rrggbb` keys; every native surface
 * reads through this object, so there is exactly one place a colour can come from.
 *
 * CACHING: CapacitorStorage is a disk-backed SharedPreferences, and the notification service builds
 * notifications in bursts. Reading it once per notification would be wasteful, so values are
 * cached and invalidated by [stamp] — the web layer bumps the stamp whenever it rewrites the
 * tokens, which is exactly when a repaint is needed anyway. A stamp the app never wrote (fresh
 * install, cleared storage) falls through to the Astra baseline.
 */
object AstraThemeRead {

    private const val PREFS = "CapacitorStorage"
    private const val KEY_STAMP = "astra_theme_stamp"

    // token key -> AstraTokenMath.Tokens field, so one read fills the whole set.
    private val KEYS = mapOf(
        "astra_accent" to "accent",
        "astra_void" to "void",
        "astra_surface" to "surface",
        "astra_surface_hi" to "surfaceHi",
        "astra_hairline" to "hairline",
        "astra_ink" to "ink",
        "astra_muted" to "muted",
        "astra_danger" to "danger",
        "astra_okay" to "okay",
        "astra_amber" to "amber",
    )

    @Volatile private var cached: AstraTokenMath.Tokens? = null
    @Volatile private var cachedStamp: String? = null

    /** Force the next [tokens] call to re-read disk. Used by the plugin's refresh(). */
    fun invalidate() {
        cached = null
        cachedStamp = null
    }

    /** The active tokens, cached against the stamp the web layer writes. */
    fun tokens(ctx: Context): AstraTokenMath.Tokens {
        val prefs = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val stamp = prefs.getString(KEY_STAMP, "") ?: ""
        val hit = cached
        if (hit != null && stamp == cachedStamp) return hit
        val map = HashMap<String, String?>(KEYS.size)
        for ((prefKey, _) in KEYS) map[prefKey] = prefs.getString(prefKey, null)
        val resolved = AstraTokenMath.resolve(prefs.getString("astra_theme", "dark"), map)
        cachedStamp = stamp
        cached = resolved
        return resolved
    }

    /** The tokens as Android ARGB ints. parseColor on an invalid hex throws, so guard it. */
    fun argb(tokens: AstraTokenMath.Tokens, pick: (AstraTokenMath.Tokens) -> String): Int =
        parseHex(pick(tokens))

    /** `Color.parseColor` that returns [fallback] instead of throwing on a malformed value. */
    fun parseHex(hex: String, fallback: Int = Color.parseColor("#22D3EE")): Int =
        try {
            if (AstraTokenMath.isHex(hex)) Color.parseColor(hex) else fallback
        } catch (e: IllegalArgumentException) {
            fallback
        }
}
