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

## License

MIT — see [LICENSE](LICENSE).
