package com.jitinnair.astra

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pins the invariants the native theme bridge depends on.
 *
 * These are the failure modes that would paint a notification black or make an unreadable button:
 * a bad hex from the web layer, a lost token, a light palette falling back to DARK colours, and
 * low-contrast text on a pale accent. All are pure functions, so they are asserted here rather
 * than eyeballed on a device.
 *
 * Written in Kotlin (not Java) so it calls the object directly — a Java test would need
 * `AstraTokenMath.INSTANCE.` on every call, which is noise that hides the intent of each assert.
 */
class AstraTokenMathTest {

    @Test
    fun emptyMapFallsBackToAstraDark() {
        val t = AstraTokenMath.resolve("dark", emptyMap())
        assertEquals("#22D3EE", t.accent)
        assertEquals("#0A0A0F", t.void)
        assertEquals("dark", t.mode)
    }

    @Test
    fun emptyMapFallsBackToAstraLight() {
        // Regression pin: a LIGHT palette that lost every token must degrade to light Astra,
        // never to dark Astra (which put dark text on light paper).
        val t = AstraTokenMath.resolve("light", emptyMap())
        assertEquals("#0369A1", t.accent)
        assertEquals("#F5F2EC", t.void)
        assertEquals("#0F172A", t.ink)
        assertEquals("light", t.mode)
    }

    @Test
    fun oneBadTokenDoesNotPoisonTheRest() {
        val t = AstraTokenMath.resolve(
            "dark",
            mapOf(
                "accent" to "#ff5c1f",   // Fire dark — valid
                "void" to "not-a-hex",   // garbage from a bad push
                "ink" to "#FFF1E8",     // valid
            ),
        )
        assertEquals("#ff5c1f", t.accent)  // valid token survives
        assertEquals("#FFF1E8", t.ink)     // valid token survives
        assertEquals("#0A0A0F", t.void)    // bad token falls back to Astra dark
    }

    @Test
    fun everyPaletteTokenSurvivesTheResolve() {
        // The 10 tokens the web layer pushes. If a key here drifts from the plugin's TOKENS array
        // or AstraThemeRead.KEYS, that token silently falls back to Astra — this pins the set.
        val map = mapOf(
            "accent" to "#ff5c1f", "void" to "#0e0a0a", "surface" to "#130e0d",
            "surfaceHi" to "#1d1513", "hairline" to "#2d221e", "ink" to "#fff1e8",
            "muted" to "#d9a894", "danger" to "#ff5347", "okay" to "#a3c94a",
            "amber" to "#ffb01f",
        )
        val t = AstraTokenMath.resolve("dark", map)
        assertEquals("#ff5c1f", t.accent)
        assertEquals("#0e0a0a", t.void)
        assertEquals("#130e0d", t.surface)
        assertEquals("#1d1513", t.surfaceHi)
        assertEquals("#2d221e", t.hairline)
        assertEquals("#fff1e8", t.ink)
        assertEquals("#d9a894", t.muted)
        assertEquals("#ff5347", t.danger)
        assertEquals("#a3c94a", t.okay)
        assertEquals("#ffb01f", t.amber)
    }

    @Test
    fun isHexRejectsTheShapesAndroidWouldThrowOn() {
        assertTrue(AstraTokenMath.isHex("#22d3ee"))
        assertTrue(AstraTokenMath.isHex("#22D3EE"))
        // Wrong length, missing #, non-hex digits: all would make Color.parseColor throw.
        assertFalse(AstraTokenMath.isHex("#fff"))
        assertFalse(AstraTokenMath.isHex("22d3ee"))
        assertFalse(AstraTokenMath.isHex("#22d3e"))
        assertFalse(AstraTokenMath.isHex("#22d3ee "))
        assertFalse(AstraTokenMath.isHex("#22d3eg"))
        assertFalse(AstraTokenMath.isHex(null))
    }

    @Test
    fun textOnAccentAlwaysClearsContrast() {
        // The "Allow once" fill. Every real palette accent must clear 4.5:1 with the text the
        // helper picks — this is the assertion that catches a pale accent left under white text.
        val accents = listOf(
            "#22D3EE",  // Astra cyan
            "#0369A1",  // Astra light
            "#FF5C1F",  // Fire dark
            "#B45309",  // amber
            "#F5F2EC",  // near-white ground, used as accent in some light variants
            "#047857",  // emerald
            "#0A0A0F",  // the darkest ground
        )
        for (a in accents) {
            val on = AstraTokenMath.onAccent(a)
            val ratio = AstraTokenMath.contrast(a, on)
            assertTrue("contrast $on on $a = $ratio", ratio >= 4.5)
        }
    }

    @Test
    fun onAccentPicksWhicheverTextActuallyMeasuresBetter() {
        assertEquals("#0A0A0F", AstraTokenMath.onAccent("#F5F2EC"))  // pale   -> dark text
        assertEquals("#FFFFFF", AstraTokenMath.onAccent("#0369A1"))  // dark   -> white text
        // The case a luminance threshold gets wrong: mid-luminance Fire orange takes DARK text
        // (6.39:1) even though white is the more intuitive pick for a saturated colour (3.09:1).
        assertEquals("#0A0A0F", AstraTokenMath.onAccent("#FF5C1F"))
    }

    @Test
    fun everyPaletteAccentClearsContrastOnItsOwnInk() {
        // The popup card: ink text sits on the surface, and the accent on the surface. A palette
        // whose surface is nearly the same value as its ink would render an unreadable card.
        val lightAccents = listOf("#0369A1", "#B45309", "#047857", "#B91C1C")
        val lightSurfaces = listOf("#F5F2EC", "#FDFCF9")
        for (a in lightAccents) {
            for (s in lightSurfaces) {
                val ratio = AstraTokenMath.contrast(a, s)
                assertTrue("accent $a on surface $s = $ratio", ratio >= 3.0)
            }
        }
    }

    @Test
    fun withAlphaKeepsRgbAndAppendsAlpha() {
        // Android's parseColor is #AARRGGBB; this helper emits CSS-style #rrggbbaa. Asserted so
        // the channel order stays pinned — mixing the two notations swaps channels silently.
        assertEquals("#22D3EE7F", AstraTokenMath.withAlpha("#22D3EE", 0x7F))
        assertEquals("#22D3EEFF", AstraTokenMath.withAlpha("#22D3EE", 255))
    }

    @Test
    fun contrastIsSymmetricAndBounded() {
        val ab = AstraTokenMath.contrast("#000000", "#FFFFFF")
        val ba = AstraTokenMath.contrast("#FFFFFF", "#000000")
        assertEquals(ab, ba, 0.0001)
        assertEquals(21.0, ab, 0.1)
        assertEquals(1.0, AstraTokenMath.contrast("#123456", "#123456"), 0.001)
    }
}
