package com.jitinnair.astra

/**
 * Pure theme-token maths for every NATIVE surface (notifications, the gate popup).
 *
 * WHY THIS FILE HAS NO ANDROID IMPORTS: it is the only part of the theme bridge that can be
 * unit-tested on the JVM. `android.graphics.Color` is a stub in local unit tests, so any logic
 * that needs it can only be verified on a device. Everything that can be a pure function lives
 * here instead, and `AstraThemeRead` does the (one-line) Android translation on top.
 *
 * The web theme engine writes the active palette into CapacitorStorage as hex strings; this
 * resolves that map into a typed token set with a hard Astra fallback, so a missing key, a
 * truncated write or a stale build still paints the known-good Astra colours instead of black.
 */
object AstraTokenMath {

    /** A theme resolved to hex strings. `mode` is "dark" or "light". */
    data class Tokens(
        val mode: String,
        val accent: String,   // --color-cyanx     brand / notification tint
        val void: String,     // --color-void      page ground
        val surface: String,  // --color-midnight  card
        val surfaceHi: String,// --color-depth     raised fill
        val hairline: String, // --color-surface   1px borders
        val ink: String,      // --color-brandtext primary text
        val muted: String,    // --color-muted     secondary text
        val danger: String,   // --color-redx
        val okay: String,     // --color-emerald
        val amber: String,    // --color-amber
    )

    /** Astra UI dark, the known-good baseline. Light is the second column. */
    private fun astra(light: Boolean) = Tokens(
        mode = if (light) "light" else "dark",
        accent = if (light) "#0369A1" else "#22D3EE",
        void = if (light) "#F5F2EC" else "#0A0A0F",
        surface = if (light) "#FDFCF9" else "#12121A",
        surfaceHi = if (light) "#ECE8DF" else "#1A1A2E",
        hairline = if (light) "#E1DCD1" else "#252538",
        ink = if (light) "#0F172A" else "#F8FAFC",
        muted = if (light) "#5B6472" else "#9AA3B2",
        danger = if (light) "#B91C1C" else "#F87171",
        okay = if (light) "#047857" else "#10B981",
        amber = if (light) "#B45309" else "#FB923C",
    )

    /** True for a well-formed `#rrggbb` or `#rrggbbaa` string, case-insensitive. */
    fun isHex(v: String?): Boolean =
        v != null && v.length == 7 && v[0] == '#' &&
            v.drop(1).all { it in "0123456789abcdefABCDEF" }

    /** The value if it is a valid hex, else the fallback. Never throws. */
    fun hex(v: String?, fallback: String): String = if (isHex(v)) v!! else fallback

    /**
     * Resolve the persisted token map into [Tokens]. Unreadable / absent keys fall back per-token,
     * so one bad value cannot black out the whole notification.
     *
     * `mode` is authoritative for which fallback column to use, so a light-mode palette that lost
     * one key degrades to light-mode Astra rather than dark-mode Astra.
     */
    fun resolve(mode: String?, map: Map<String, String?>): Tokens {
        val light = mode == "light"
        val base = astra(light)
        return Tokens(
            mode = base.mode,
            accent = hex(map["accent"], base.accent),
            void = hex(map["void"], base.void),
            surface = hex(map["surface"], base.surface),
            surfaceHi = hex(map["surfaceHi"], base.surfaceHi),
            hairline = hex(map["hairline"], base.hairline),
            ink = hex(map["ink"], base.ink),
            muted = hex(map["muted"], base.muted),
            danger = hex(map["danger"], base.danger),
            okay = hex(map["okay"], base.okay),
            amber = hex(map["amber"], base.amber),
        )
    }

    /** WCAG relative luminance of a `#rrggbb` hex. Input is assumed valid. */
    fun luminance(hex: String): Double {
        fun chan(i: Int): Double {
            val v = hex.substring(i, i + 2).toInt(16) / 255.0
            return if (v <= 0.03928) v / 12.92 else Math.pow((v + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * chan(1) + 0.7152 * chan(3) + 0.0722 * chan(5)
    }

    /** WCAG contrast ratio between two valid hexes, 1.0..21.0. */
    fun contrast(a: String, b: String): Double {
        val la = luminance(a); val lb = luminance(b)
        return (maxOf(la, lb) + 0.05) / (minOf(la, lb) + 0.05)
    }

    /** The dark text option: the Astra ink, near-black. */
    private const val INK_DARK = "#0A0A0F"
    private const val TEXT_LIGHT = "#FFFFFF"

    /**
     * Text colour to sit ON the accent — the "Allow once" button fill and the colourized approval
     * banner. Picks whichever of dark/light text actually measures better, rather than guessing
     * from a luminance threshold.
     *
     * A threshold is not enough: a MID-LUMINANCE accent (Fire's #FF5C1F) is the case that breaks
     * it. At lum 0.29 a ">0.5 → dark" rule picks white and yields only 3.09:1, while dark text on
     * the same fill measures 6.39:1. Taking the max of the two measured ratios is correct for every
     * accent, and is one comparison cheaper than a lookup table.
     */
    fun onAccent(accent: String): String =
        if (contrast(accent, INK_DARK) >= contrast(accent, TEXT_LIGHT)) INK_DARK else TEXT_LIGHT

    /** `#rrggbb` + alpha 0..255 → `#rrggbbaa`, for the popup scrim over the accent/void. */
    fun withAlpha(hex: String, alpha: Int): String {
        val a = alpha.coerceIn(0, 255)
        val body = hex.removePrefix("#").take(6)
        return "#" + body + a.toString(16).padStart(2, '0').uppercase()
    }
}
