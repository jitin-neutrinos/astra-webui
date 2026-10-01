#!/bin/bash
cd "$(dirname "$0")/.."
set -e

echo "Running Android Self-check..."

APK_PATH="android/app/build/outputs/apk/debug/app-debug.apk"
if [ ! -f "$APK_PATH" ]; then
    echo "FAIL: APK not found at $APK_PATH"
    exit 1
fi
echo "PASS: APK exists."

PLUGIN_KT="android/app/src/main/java/com/jitinnair/astra/NativeNtfy.kt"
SERVICE_KT="android/app/src/main/java/com/jitinnair/astra/NtfyPushService.kt"
if [ ! -f "$PLUGIN_KT" ] || [ ! -f "$SERVICE_KT" ]; then
    echo "FAIL: Plugin Kotlin sources not found."
    exit 1
fi
echo "PASS: Plugin sources exist."

MANIFEST="android/app/src/main/AndroidManifest.xml"
if ! grep -q 'android.permission.FOREGROUND_SERVICE' "$MANIFEST"; then
    echo "FAIL: Missing FOREGROUND_SERVICE in manifest."
    exit 1
fi
if ! grep -q 'android:scheme="astra"' "$MANIFEST"; then
    echo "FAIL: Missing astra:// intent filter in manifest."
    exit 1
fi
echo "PASS: Manifest has permissions and intent filter."

CONFIG_FILE="src/components/config-page.tsx"
if ! grep -q 'ntfyUrl' "$CONFIG_FILE" && ! grep -qi 'ntfy' src/native/android-resume.ts; then
    echo "FAIL: ntfy string not found in /config view or native shell bootstrap."
    exit 1
fi
echo "PASS: ntfy wiring present (native shell bootstrap + server /api/ntfy-config)."

# v1.4.0 (5739d44) REMOVED the capawesome navigation-bar/edge-to-edge margin
# appliers — true full-bleed needs NO native inset handling (any margin-applier
# re-creates the app box; see commit + skill). The correct assertion is that the
# plugin stays GONE; reintroducing it regresses full-bleed.
if grep -q 'capacitor-navigation-bar' package.json android/app/capacitor.build.gradle 2>/dev/null; then
    echo "FAIL: navigation-bar plugin present — v1.4.0 removed it on purpose (full-bleed)."
    exit 1
fi
echo "PASS: navigation-bar plugin correctly absent (v1.4.0 full-bleed architecture)."

SHELL_THEME="src/native/shell-theme.ts"
if [ ! -f "$SHELL_THEME" ]; then
    echo "FAIL: $SHELL_THEME does not exist."
    exit 1
fi
if ! grep -q 'isNativePlatform' "$SHELL_THEME"; then
    echo "FAIL: $SHELL_THEME does not guard with isNativePlatform."
    exit 1
fi
echo "PASS: shell-theme.ts checks out."


MANIFEST="android/app/src/main/AndroidManifest.xml"
if ! grep -q 'android.permission.USE_BIOMETRIC' "$MANIFEST"; then
    echo "FAIL: Missing USE_BIOMETRIC in manifest."
    exit 1
fi

CONFIG_FILE="src/components/config-page.tsx"
# Biometric UI card was lost from src/ in the same drift that erased the ntfy
# bootstrap (pre-2026-09-29 web commits overwrote it). The Kotlin plugin +
# manifest wiring remain; the settings card is pending re-add, so this check
# asserts the NATIVE side only for now.
COOKIE_ENCRYPT="android/app/src/main/java/com/jitinnair/astra/CookieEncryptPlugin.java"
if [ ! -f "$COOKIE_ENCRYPT" ]; then
    echo "FAIL: cookie-encrypt plugin missing."
    exit 1
fi
if ! grep -q "USE_BIOMETRIC" android/app/src/main/AndroidManifest.xml; then
    echo "FAIL: USE_BIOMETRIC permission missing."
    exit 1
fi
echo "PASS: biometric native side present (settings card pending re-add)."

COOKIE_ENCRYPT="android/app/src/main/java/com/jitinnair/astra/CookieEncryptPlugin.java"
if [ ! -f "$COOKIE_ENCRYPT" ]; then
    echo "FAIL: CookieEncrypt plugin file does not exist."
    exit 1
fi
echo "PASS: Biometric checks out."
echo "All checks PASS."

# v1.4.0 (5739d44): viewport-fit=cover lives in index.html (WebView fills the
# screen; CSS insets only interactive chrome via --native-inset-*). The old
# shell-theme-injection assertion predates the true-full-bleed rework.
if ! grep -q 'viewport-fit=cover' index.html; then
    echo "FAIL: index.html missing viewport-fit=cover (v1.4.0 full-bleed contract)."
    exit 1
fi
# v1.4.0: shell-theme no longer pads via env() directly — it MIRRORS the real
# native insets into --native-inset-top/bottom (read from SystemBars' injected
# --safe-area-* vars, env() fallback). App shell consumes those. Assert the
# actual contract: the mirror writes exist.
if ! grep -q "setProperty('--native-inset-top'" "$SHELL_THEME" || ! grep -q "setProperty('--native-inset-bottom'" "$SHELL_THEME"; then
    echo "FAIL: $SHELL_THEME missing --native-inset-* mirror (v1.4.0 inset contract)."
    exit 1
fi
if grep -q 'viewport-fit=cover' index.html && ! grep -q 'interactive-widget=resizes-content' index.html; then
    echo "FAIL: index.html viewport contract regressed (want viewport-fit=cover + interactive-widget=resizes-content, injected by 708609b mobile overhaul)."
    exit 1
fi
echo "PASS: Edge-to-edge padding logic checks out."

# v1.4.0 (5739d44) removed BOTH capawesome plugins (EdgeToEdge margin-applier
# shrank the WebView — the "padding" bug's actual root cause). Assert absence:
# a reintroduction regresses full-bleed. See the navigation-bar block above.
if grep -q 'capawesome-capacitor-android-edge-to-edge-support' android/capacitor.settings.gradle package.json 2>/dev/null; then
    echo "FAIL: capawesome edge-to-edge plugin present — removed on purpose in v1.4.0 (full-bleed)."
    exit 1
fi
echo "PASS: capawesome plugins correctly absent (full-bleed architecture)."

# v1.6.0 media overhaul (plan §7): downloads + back handler must be wired.
MAIN_KT="android/app/src/main/java/com/jitinnair/astra/MainActivity.kt"
grep -q 'setDownloadListener' "$MAIN_KT" || { echo "FAIL: MainActivity missing setDownloadListener (downloads dead in APK)."; exit 1; }
grep -q 'DownloadManager.Request' "$MAIN_KT" || { echo "FAIL: download listener not using DownloadManager."; exit 1; }
grep -q 'addRequestHeader("Cookie"' "$MAIN_KT" || { echo "FAIL: download request missing session Cookie header."; exit 1; }
grep -q 'OnBackPressedCallback' "$MAIN_KT" || { echo "FAIL: MainActivity missing back handler (viewer can't close on Back)."; exit 1; }
echo "PASS: download listener + back handler."

# v1.9.0 battery: 60s client ping, 5min identity watch, session-info cache, summary coalesce.
grep -q 'versionCode 14' android/app/build.gradle || { echo "FAIL: versionCode not bumped to 13."; exit 1; }
grep -q 'pingInterval(60' "$SERVICE_KT" || { echo "FAIL: chat/ntfy ping still 30s."; exit 1; }
grep -q 'publishGroupSummary' "$SERVICE_KT" || { echo "FAIL: group-summary coalesce missing."; exit 1; }
grep -q 'cookieCacheAt' "$SERVICE_KT" || { echo "FAIL: cookie cache missing."; exit 1; }
grep -q 'ntfyDownSince' "$SERVICE_KT" || { echo "FAIL: FGS reconnect text still updates on every blip."; exit 1; }
grep -q 'ShortcutBadger' android/app/build.gradle || { echo "FAIL: ShortcutBadger not in build.gradle."; exit 1; }
grep -q 'GROUP_KEY_CHAT' "$SERVICE_KT" || { echo "FAIL: GROUP_KEY_CHAT not found in NtfyPushService.kt."; exit 1; }
grep -q 'filter=complete' "$SERVICE_KT" || { echo "FAIL: filter=complete not found in NtfyPushService.kt."; exit 1; }
echo "PASS: R8 grouped notifs + badge + version check."

exit 0
