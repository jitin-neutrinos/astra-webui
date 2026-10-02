# Astra

A personal AI assistant web app — chat interface for the [Hermes Agent](https://github.com/NousResearch/Hermes-Agent) gateway, wrapped as native apps for iOS, Android, and Windows.

**Live app:** https://astra.jitinnair.com · **Windows installer:** https://astra-windows.jitinnair.com

```
curl.exe -LO https://astra-windows.jitinnair.com/Astra-setup.exe
```

## What's here

| Piece | Where | What it is |
|---|---|---|
| Web app | `src/`, `server/` | React + Vite + Tailwind frontend; zero-dependency Node server proxying the Hermes gateway (REST + WebSocket), with media transcoding and ntfy push emission |
| Windows shell | `src-tauri/` | Tauri 2 remote-URL shell: tray, native toasts, `astra://` deep links, auto-updater |
| iOS wrap | `ios/` | Capacitor wrap of the live site (unsigned IPA for personal sideloading) |
| Android wrap | `android/` | Capacitor wrap + embedded ntfy WebSocket foreground service for background push |

## Architecture in one line

The server never talks to model providers — it is a stateless, auth-gated proxy to a Hermes gateway (`/api/*`, WS `/api/ws`). All agent state lives in the gateway; the webui is a surface.

## Build

**Web:** `npm ci && npm run build` → serve `dist/` (or run `server/server.mjs`).

**Windows app:** push a tag `win-v*` — GitHub Actions (`.github/workflows/windows-build.yml`) builds the NSIS installer and updater artifacts, published to GitHub Releases, mirrored to `astra-windows.jitinnair.com`.

Push credentials for the desktop build are injected at compile time via the `ASTRA_NTFY_WS` env var (wss URL incl. `?auth=`) — no secrets in source.

## Android app (debug APK)

```bash
echo "sdk.dir=$HOME/Work/android-sdk" > android/local.properties   # once
source ~/Work/services/astra-android/astra.keystore.env            # KEYSTORE_PASSWORD
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk ANDROID_HOME=$HOME/Work/android-sdk
# ANDROID_SDK_HOME/ANDROID_AVD_HOME/ANDROID_USER_HOME (emulator vars) must be UNSET or gradle fails:
# "Several environment variables ... different paths to the Android Preferences folder"
cd android && ./gradlew assembleDebug
cp app/build/outputs/apk/debug/app-debug.apk ~/Work/astra-v<versionName>-gates.apk
```

Bump `versionCode` + `versionName` together in `android/app/build.gradle`. The app loads
https://astra.jitinnair.com live (`capacitor.config.ts` `server.url`), so web changes reach the
installed app on next launch without an APK rebuild — only native code needs one. Emulator
live-fire recipe (headless boot, `debug_gate_json` offline gate render): see the `astra-webui`
Hermes skill, "Android gate popup" section.

## License

MIT — see [LICENSE](LICENSE).
