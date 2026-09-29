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

if ! grep -q 'navigation-bar' package.json && ! grep -q 'navigation-bar' android/app/build.gradle; then
    echo "FAIL: navigation-bar plugin not found in package.json or build.gradle"
    exit 1
fi
echo "PASS: navigation-bar plugin registered."

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

if ! grep -q 'viewport-fit=cover' "$SHELL_THEME"; then
    echo "FAIL: $SHELL_THEME does not inject viewport-fit=cover."
    exit 1
fi
if ! grep -q 'padding-bottom: env(safe-area-inset-bottom)' "$SHELL_THEME" || ! grep -q 'padding-top: 0' "$SHELL_THEME"; then
    echo "FAIL: $SHELL_THEME safe-area shape wrong (want bottom-only inset, zero top)."

    exit 1
fi
if grep -q 'viewport-fit=cover' index.html && ! grep -q 'interactive-widget=resizes-content' index.html; then
    echo "FAIL: index.html viewport contract regressed (want viewport-fit=cover + interactive-widget=resizes-content, injected by 708609b mobile overhaul)."
    exit 1
fi
echo "PASS: Edge-to-edge padding logic checks out."

if ! grep -q 'capawesome-capacitor-android-edge-to-edge-support' android/capacitor.settings.gradle; then
    echo "FAIL: @capawesome/capacitor-android-edge-to-edge-support not found in capacitor.settings.gradle"
    exit 1
fi
if [ ! -d "node_modules/@capawesome/capacitor-android-edge-to-edge-support" ]; then
    echo "FAIL: @capawesome/capacitor-android-edge-to-edge-support cap symlinks do not exist in node_modules"
    exit 1
fi
echo "PASS: edge-to-edge plugin checks out."
exit 0
