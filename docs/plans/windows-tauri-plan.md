# Astra Windows Desktop — Tauri 2 Implementation Plan

Repo: ~/Work/projects/astra-webui (github.com/jitin-neutrinos/astra-webui, private)
Scope: Windows-only Tauri 2 shell loading remote https://astra.jitinnair.com. Zero changes to src/, android/, ios/, server/.
All plugin facts below verified against v2.tauri.app plugin docs (deep-linking, single-instance, notification, updater, capabilities) and docs.ntfy.sh subscribe API, 2026-09-28.

---

## 0. Architecture decisions (fixed — do not deviate)

- Remote-URL wrap, same pattern as the Capacitor wraps. No bundled frontend. `frontendDist` points at a checked-in stub dir purely to satisfy the bundler.
- Main window is built in Rust (`WebviewWindowBuilder` in `setup`), NOT in `tauri.conf.json > app.windows`, because the ntfy init script must be attached via `.initialization_script()` and a navigation lock via `.on_navigation()`. Config windows get neither cleanly.
- `withGlobalTauri: true` — required: the init script runs in the remote page and uses `window.__TAURI__.event.emit`; npm guest bindings are impossible (src/ is untouchable, remote origin can't import local packages).
- Push pipeline: init script (WSS → ntfy) emits Tauri event `ntfy-message` → Rust handler gates on window state, raises native toast, stores pending click-URL. Toast *sending* happens Rust-side (no JS notification permission dance, capability stays small).
- Toast click → deep link: tauri-plugin-notification has NO Windows click callback. Mechanism: store `pending_nav_url` when a toast is shown; Windows toast activation focuses the app; `Focused(true)` window event consumes pending URL → `eval()` navigate. TTL 90s. Documented as best-effort (Risk 2).
- Deep links: `deep-link` desktop scheme `astra` + `single-instance` with `deep-link` feature registered FIRST. Warm start = second instance killed by single-instance plugin, `deep-link://new-url` event fires in first instance. Cold start = `get_current()` (reads argv) in `setup`.
- Updater feed: CI rewrites `latest.json` URLs to https://astra-windows.jitinnair.com because the repo is PRIVATE — GitHub release asset URLs need auth; the updater could never fetch them. The mirror (tunnel, separate task) serves the same filenames as the release.
- Navigation lock: `on_navigation` allows only `https://astra.jitinnair.com`. External URLs denied (personal app, opener not needed).

---

## 1. File-by-file map (all new)

| File | Purpose |
|---|---|
| `src-tauri/tauri.conf.json` | App identity, window/bundle/updater/deep-link config, capability ref |
| `src-tauri/Cargo.toml` | Rust crate: tauri + 4 plugins (single-instance first-class) |
| `src-tauri/build.rs` | Standard `tauri_build::build()` |
| `src-tauri/src/main.rs` | Thin entry: `windows_subsystem` attr + `astra_lib::run()` |
| `src-tauri/src/lib.rs` | All wiring: builder chain, window build + init script, tray, close-to-tray, deep-link handling, toast handler, updater check, ntfy constants |
| `src-tauri/src/scripts/ntfy-init.js` | Init-script template with `__NTFY_WS_URL__` placeholder (WSS subscribe, backoff, dedupe, emit) |
| `src-tauri/capabilities/astra-remote.json` | Remote-URL capability granting the 4 permission groups to https://astra.jitinnair.com |
| `src-tauri/stub/index.html` | Minimal HTML so `frontendDist` resolves (never actually shown) |
| `src-tauri/icons/*` | Generated once from assets/logo.png, committed; CI never regenerates |
| `src-tauri/.gitignore` | `target/`, `gen/` |
| `.github/workflows/windows-build.yml` | windows-latest: NSIS build + updater artifacts + SHA256 + latest.json rewrite + GH Release |
| `docs/plans/windows-tauri-plan.md` | This file |

One-time local commands (NOT committed to CI):
- Icons: `cd src-tauri && npx @tauri-apps/cli icon ../assets/logo.png` → verify `icons/icon.ico` exists, commit `src-tauri/icons/`.
- Updater keys: `npx @tauri-apps/cli signer generate -w ~/.tauri/astra-updater.key` (set a password). Public key → `tauri.conf.json plugins.updater.pubkey`. Private key → GH secret `TAURI_SIGNING_PRIVATE_KEY` (contents), password → `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, backup copy → password manager. Losing the private key strands every installed copy (updater refuses unsigned).

---

## 2. Content sketches

### 2.1 tauri.conf.json

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Astra",
  "version": "1.0.0",
  "identifier": "com.jitinnair.astra",
  "build": { "frontendDist": "stub" },
  "app": {
    "withGlobalTauri": true,
    "windows": [],
    "security": { "csp": null, "capabilities": ["astra-remote"] }
  },
  "bundle": {
    "active": true,
    "targets": ["nsis"],
    "icon": [
      "icons/32x32.png", "icons/128x128.png", "icons/128x128@2x.png", "icons/icon.ico"
    ],
    "createUpdaterArtifacts": true,
    "windows": {
      "webviewInstallMode": { "type": "downloadBootstrapper" },
      "nsis": { "installMode": "currentUser", "languages": ["English"], "displayLanguageSelector": false }
    }
  },
  "plugins": {
    "updater": {
      "endpoints": ["https://astra-windows.jitinnair.com/latest.json"],
      "pubkey": "<PUBKEY from `tauri signer generate`>",
      "windows": { "installMode": "passive" }
    },
    "deep-link": { "desktop": { "schemes": ["astra"] } }
  }
}
```

Notes: no `beforeBuildCommand`/`devUrl` (nothing to build). `installMode: currentUser` → no UAC. Version lives ONLY here; bump + tag `win-v{version}` to release.

### 2.2 capabilities/astra-remote.json

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "astra-remote",
  "description": "Remote astra.jitinnair.com page: event emit, notifications, deep-link, window state",
  "windows": ["main"],
  "remote": { "urls": ["https://astra.jitinnair.com"] },
  "platforms": ["windows"],
  "permissions": [
    "core:event:default",
    "core:window:default",
    "notification:default",
    "deep-link:default"
  ]
}
```

The `"remote": {"urls": [...]}` block is THE mechanism that exposes IPC to the remote page (exact origin, no wildcard). Without it, `window.__TAURI__` exists in the page but every command call is denied — the classic remote-URL gotcha. Actually exercised by the init script: `core:event:default` only (emit). The other three satisfy R3's grant list and cover deep-link `get_current` / notification permission checks if the webui ever opts in. Rust-side plugin calls (toast show, updater, window ops, navigation via `eval`) are NOT gated by capabilities.

### 2.3 Cargo.toml (deps section)

```toml
[package]
name = "astra"
version = "1.0.0"
edition = "2021"

[lib]
name = "astra_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
url = "2"

[target."cfg(any(target_os = \"macos\", windows, target_os = \"linux\"))".dependencies]
tauri-plugin-single-instance = { version = "2", features = ["deep-link"] }
tauri-plugin-deep-link = "2"
tauri-plugin-notification = "2"
tauri-plugin-updater = "2"
```

### 2.4 src/main.rs

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() { astra_lib::run() }
```

### 2.5 src/lib.rs — wiring skeleton (order matters)

```rust
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_notification::NotificationExt;
use url::Url;

const SITE: &str = "https://astra.jitinnair.com";
// Values from ~/.config/astra-webui/env — private repo, personal device, accepted.
// NTFY_AUTH here is the raw "user:password"; base64 it below.
const NTFY_WS: &str = "wss://ntfy.jitinnair.com/__TOPIC__/ws";
const NTFY_AUTH: &str = "__USER__:__PASS__";

struct PendingNav(Mutex<Option<(String, std::time::Instant)>>); // url, shown_at

fn navigate(app: &AppHandle, path_or_url: &str) {
    let Ok(mut w) = app.get_webview_window("main") else { return };
    let full = if path_or_url.starts_with("http") { path_or_url.into() }
               else { format!("{SITE}{path_or_url}") };
    // path_or_url comes from astra://open?path=/c/xyz OR an ntfy click URL (full https).
    let js = format!("window.__astraNavigate__ && window.__astraNavigate__({})", serde_json::to_string(&full).unwrap());
    let _ = w.show(); let _ = w.unminimize(); let _ = w.set_focus();
    let _ = w.eval(&js);
}

fn astra_path(u: &str) -> Option<String> {
    Url::parse(u).ok().and_then(|url|
        url.query_pairs().find(|(k, _)| k == "path").map(|(_, v)| v.into_owned()))
}

pub fn run() {
    let mut builder = tauri::Builder::default().manage(PendingNav(Mutex::new(None)));

    // 1. SINGLE-INSTANCE FIRST — must be the first registered plugin (doc-mandated).
    //    With the `deep-link` feature, the deep-link event is already triggered in
    //    the primary instance before this callback runs; argv still carries the URL.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(u) = argv.iter().find(|a| a.starts_with("astra://")) {
                navigate(app, &astra_path(u).unwrap_or_else(|| "/".into()));
            } else {
                if let Some(w) = app.get_webview_window("main") { let _ = w.set_focus(); }
            }
        }));
    }

    builder
        // 2. remaining plugins
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // Dev-mode deep-link registration; installed NSIS build registers via config.
            #[cfg(desktop)]
            { use tauri_plugin_deep_link::DeepLinkExt; let _ = app.deep_link().register_all(); }

            // Warm-start deep links (single-instance forwards them as this event).
            {
                let handle = app.handle().clone();
                app.listen("deep-link://new-url", move |e| {
                    if let Ok(urls) = serde_json::from_str::<Vec<String>>(e.payload()) {
                        if let Some(u) = urls.first() { navigate(&handle, &astra_path(u).unwrap_or_else(|| "/".into())); }
                    }
                });
            }
            // Cold-start deep link (argv).
            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Ok(Some(urls)) = app.deep_link().get_current() {
                    if let Some(u) = urls.first() { navigate(app.handle(), &astra_path(u).unwrap_or_else(|| "/".into())); }
                }
            }

            // Main window: built here (not in config) for initialization_script + nav lock.
            let auth = base64::encode(NTFY_AUTH); // or hand-roll base64 to avoid the crate
            let init = include_str!("scripts/ntfy-init.js")
                .replace("__NTFY_WS_URL__", &format!("{NTFY_WS}?auth={auth}"));
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(SITE.parse()?))
                .title("Astra")
                .inner_size(1280.0, 800.0)
                .min_inner_size(960.0, 640.0)
                .initialization_script(&init)
                .on_navigation(|url| url.scheme() == "https" && url.host_str() == Some("astra.jitinnair.com"))
                .build()?;

            // ntfy messages -> toast (gated) + pending nav
            {
                let handle = app.handle().clone();
                app.listen("ntfy-message", move |e| {
                    let Ok(m) = serde_json::from_str::<NtfyMsg>(e.payload()) else { return };
                    let Some(w) = handle.get_webview_window("main") else { return };
                    let occupied = w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false);
                    if occupied { return; } // in-app WS already surfaced it; never toast a focused app
                    let mut b = handle.notification().builder().title(&m.title).body(&m.body);
                    if let Some(icon) = app default window icon → .icon(...) optional;
                    let _ = b.show();
                    if let Some(click) = m.click { // store for toast-click navigate
                        *pending.lock().unwrap() = Some((click, Instant::now()));
                    }
                });
            }

            // Tray: icon from generated set, Open / Quit.
            let open = tauri::menu::MenuItem::with_id(app, "open", "Open", true, None::<&str>)?;
            let quit = tauri::menu::MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = tauri::menu::Menu::with_items(app, &[&open, &quit])?;
            tauri::tray::TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Astra")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, ev| match ev.id().as_ref() {
                    "open" => navigate(app, "/"),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, ev| if let tauri::tray::TrayIconEvent::Click{..} = ev {
                    navigate(tray.app_handle(), "/");
                })
                .build(app)?;

            // Updater check (delayed, silent, passive install on success).
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(5));
                    tauri::async_runtime::block_on(async move {
                        use tauri_plugin_updater::UpdaterExt;
                        let Ok(Some(update)) = handle.updater_builder().check().await else { return };
                        if let Ok(body) = update.download(|_, _| {}, || {}).await {
                            let _ = update.install(body); // passive NSIS; app exits + relaunches
                        }
                    });
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            // Close button hides to tray; pushes keep running (hidden window keeps WSS alive).
            tauri::WindowEvent::CloseRequested { api, .. } if window.label() == "main" => {
                api.prevent_close();
                let _ = window.hide();
            }
            // Toast activation / alt-tab focus: consume pending nav within TTL.
            tauri::WindowEvent::Focused(true) if window.label() == "main" => {
                let app = window.app_handle();
                let state = app.state::<PendingNav>();
                if let Some((url, at)) = state.0.lock().unwrap().take() {
                    if at.elapsed() < std::time::Duration::from_secs(90) { navigate(app, &url); }
                }
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[derive(serde::Deserialize)]
struct NtfyMsg { id: String, title: String, body: String, click: Option<String> }
```

(`base64` crate or a 6-line hand-rolled encoder — implementer's choice, ponytail says hand-roll.)
Skeleton compresses real code (borrow/PendingNav access etc.); implementer expands, keeps structure and ORDER.

### 2.6 scripts/ntfy-init.js — template

```js
(() => {
  if (window.__ASTRA_PUSH__) return; window.__ASTRA_PUSH__ = true;
  const WS = '__NTFY_WS_URL__';            // wss://ntfy.jitinnair.com/<topic>/ws?auth=<b64>
  const seen = new Set();                  // dedupe by message id (reconnect replays)
  let attempt = 0, timer = null;
  const emit = (ev, p) => { try { window.__TAURI__?.event?.emit(ev, p); } catch {} };

  window.__astraNavigate__ = (u) => { try { if (location.href !== u) location.href = u; } catch {} };

  function connect() {
    let ws;
    try { ws = new WebSocket(WS); } catch { return retry(); }
    ws.onopen = () => { attempt = 0; emit('ntfy-status', { connected: true }); };
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.event !== 'message' || !m.id || seen.has(m.id)) return;  // skip open/keepalive/poll_request + dupes
      seen.add(m.id); if (seen.size > 200) seen.delete(seen.values().next().value);
      emit('ntfy-message', { id: m.id, title: m.title || 'Astra', body: m.message || '', click: m.click || null });
    };
    ws.onclose = retry; ws.onerror = () => ws.close();
  }
  function retry() {
    const delay = Math.min(60000, 1000 * 2 ** attempt++) + Math.random() * 1000; // exp backoff 1s→60s + jitter
    clearTimeout(timer); timer = setTimeout(connect, delay);
  }
  connect();
})();
```

Auth: browsers cannot set WS headers → ntfy `?auth=` base64("user:pass") query param (documented ntfy mechanism). Do NOT use `wss://user:pass@host` (ignored by browsers). Note: the WS runs in the page's origin context → the site's CSP (if one is ever added) must allow `connect-src wss://ntfy.jitinnair.com` (see §5).

### 2.7 stub/index.html

```html
<!doctype html><html><head><meta charset="utf-8"><title>Astra</title></head>
<body><!-- bundler stub; the app window loads the remote URL and never shows this --></body></html>
```

### 2.8 .github/workflows/windows-build.yml

```yaml
name: windows-build
on:
  workflow_dispatch:
  push:
    tags: ["win-v*"]
permissions:
  contents: write
jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - uses: dtolnay/rust-toolchain@stable
        with: { targets: x86_64-pc-windows-msvc }   # default on windows-latest; explicit for clarity
      - uses: swatinem/rust-cache@v2
        with: { workspaces: src-tauri }
      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: "Astra Windows ${{ github.ref_name }}"
          releaseDraft: false
          prerelease: false
          args: --target nsis
          includeUpdaterJson: true
          updaterJsonPreferNsis: true

      # Updater artifacts now on the release: Astra_<v>_x64-setup.exe, .sig, latest.json.
      # Repo is PRIVATE → GH asset URLs need auth → updater must hit the mirror instead.
      - name: checksum + repoint latest.json at mirror
        shell: pwsh
        run: |
          $tag = "${{ github.ref_name }}"
          gh release download $tag --pattern "Astra*-setup.exe" --pattern "latest.json" --dir out
          $exe  = (Get-ChildItem out/*-setup.exe).Name
          $hash = (Get-FileHash "out/$exe" -Algorithm SHA256).Hash.ToLower()
          "$hash  $exe" | Out-File "out/$exe.sha256" -Encoding ascii -NoNewline
          $lj = Get-Content out/latest.json -Raw | ConvertFrom-Json
          $lj.platforms.'windows-x86_64'.url = "https://astra-windows.jitinnair.com/$exe"
          $lj | ConvertTo-Json -Depth 10 -Compress | Set-Content out/latest.json
          gh release upload $tag "out/$exe.sha256" "out/latest.json" --clobber
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Expected release assets: `Astra_<v>_x64-setup.exe`, `Astra_<v>_x64-setup.exe.sig`, `latest.json` (mirror-pointing), `Astra_<v>_x64-setup.exe.sha256`.

latest.json layout the updater consumes (tauri-action emits; we only rewrite `url`):

```json
{
  "version": "1.0.0",
  "notes": "...",
  "pub_date": "2026-09-28T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<contents of the .sig file (minisign)>",
      "url": "https://astra-windows.jitinnair.com/Astra_1.0.0_x64-setup.exe"
    }
  }
}
```

Mirror contract (host-side, separate task): serve release assets at `https://astra-windows.jitinnair.com/<exact filenames>`, `latest.json` at root, `Content-Type: application/json`, no auth.

---

## 3. Per-requirement test checklist

R1 — Shell + remote URL
- [ ] `cargo build` in src-tauri on any machine with Rust (dev build) OR pull the CI exe. Launch: window 1280x800, resize floor 960x640, title "Astra", taskbar/jumplist name "Astra", logo icon in title bar.
- [ ] Login with ASTRA_WEBUI_PASSWORD → chat loads, WS streaming renders tokens live.
- [ ] Restart app: cookie session persists (no re-login) — WebView2 profile dir `%LOCALAPPDATA%\com.jitinnair.astra\`.
- [ ] External link in chat is blocked (nav lock): page stays on astra.jitinnair.com.

R2 — Icons
- [ ] Local: `cd src-tauri && npx @tauri-apps/cli icon ../assets/logo.png` → `ls icons/` shows icon.ico + pngs; commit.
- [ ] CI log has NO icon-generation step; build succeeds with committed icons (proves self-contained).

R3 — Remote capability
- [ ] In the running app, DevTools (build with `devtools` feature or release + F12 if enabled) console: `window.__TAURI__` defined (withGlobalTauri).
- [ ] `await window.__TAURI__.event.emit('ntfy-message', {...})` from console → toast appears (window unfocused) → capability works from remote origin.
- [ ] Negative: load the same page origin-with-typo… skip; instead verify `gen/schemas/desktop-schema.json` includes `astra-remote` after build, and capabilities compile (build fails on unknown permission identifiers — build success = schema-valid).

R4 — Push
- [ ] From host: `curl -u $NTFY_AUTH -H "Title: Test" -H "Click: astra://open?path=/c/abc" -d "hello" https://ntfy.jitinnair.com/$NTFY_TOPIC` (values from ~/.config/astra-webui/env).
- [ ] App window HIDDEN (closed to tray): toast appears ≤2s, click → window shows + navigates to /c/abc.
- [ ] App window focused: same curl → NO toast.
- [ ] App minimized: toast appears.
- [ ] Kill network (or `sudo systemctl stop cloudflared` equivalent on ntfy host is too broad — use Windows: disconnect WiFi) 30s, reconnect → WSS reconnects (verify by curl test after reconnect), no duplicate toasts for the same message id (send one message while offline via host curl, reconnect, confirm single toast).
- [ ] Auth: WSS connects with `?auth=` — a wrong password shows fast reconnect loop, correct one sends `ntfy-status connected`.

R5 — Tray
- [ ] Close (X) → window hides, process alive (Task Manager: `Astra.exe` present), tray icon visible.
- [ ] Push while closed-to-tray → toast still arrives (R4 covers, re-verify here).
- [ ] Tray left-click → window shows + focuses. Menu: Open works; Quit kills process (Task Manager empty).
- [ ] Reopen after quit: window state sane (position default is fine; persistence not required).

R6 — Deep links
- [ ] After NSIS install: `start astra://open?path=/c/xyz` (cmd) cold-starts the app → lands on /c/xyz.
- [ ] App running: same command → no second process (Task Manager count stays 1), existing window focuses + navigates.
- [ ] `reg query HKCU\Software\Classes\astra` shows the protocol → install-time registration worked (vs runtime register_all).
- [ ] Toast-click path (R4) is the same handler — one code path, verified above.

R7 — Updater
- [ ] Key gen done; pubkey in tauri.conf matches `~/.tauri/astra-updater.key.pub` (`diff` after extracting from CI build's config or local `cargo tauri build`).
- [ ] Install v1.0.0. Release win-v1.0.1 with a trivial change. Mirror both files + latest.json at astra-windows.jitinnair.com. Relaunch old app → within ~10s passive NSIS update runs, app relaunches on new version (Help/About or taskmgr version).
- [ ] `curl https://astra-windows.jitinnair.com/latest.json` → JSON above; signature field non-empty; sha256 file matches `Get-FileHash` of the exe.
- [ ] Tamper test: flip a byte in mirrored exe → updater rejects (signature check). (Optional but proves pubkey wiring.)

R8 — CI
- [ ] `gh workflow run windows-build` (manual dispatch) on a branch → green; tag `win-v1.0.0` push → Release created with 4 assets (exe, sig, latest.json, sha256).
- [ ] latest.json `url` points at astra-windows.jitinnair.com (not github.com).
- [ ] sha256 file content matches `certutil -hashfile Astra_*-setup.exe SHA256` on a Windows box.
- [ ] SmartScreen appears once on install (unsigned, expected — "More info → Run anyway").

---

## 4. Top-3 risks + mitigations

1. Site CSP can kill push silently. The ntfy WebSocket runs in the page's origin context; any future `Content-Security-Policy: connect-src` on astra.jitinnair.com that omits `wss://ntfy.jitinnair.com` breaks toasts with zero UI signal. Mitigation: compat note in the webui deploy docs ("connect-src must include wss://ntfy.jitinnair.com"); optional watchdog in the init script (emit `ntfy-status` on 5 consecutive failed attempts → Rust toasts "Push disconnected" once per session).
2. Toast click-callback doesn't exist on Windows in tauri-plugin-notification. Click-to-navigate is the focus+pending-URL heuristic: correct in the normal case (toast click activates the app), wrong only if the user ignores a toast and focuses the app within 90s → one unexpected navigation. Mitigation: TTL 90s; single toast at a time replaces pending URL; acceptable for personal use. If it annoys: fall back to putting the path in the toast body and navigate manually.
3. Private-repo updater hosting + key custody. Updater artifacts are useless on github.com (auth-walled); the mirror must exist and stay in lockstep with `latest.json` (mirror missing a file = every client's update check fails silently until mirrored). And losing `astra-updater.key` permanently strands all installs (signature can't be reproduced; users must manually reinstall — fine at n=1). Mitigation: CI emits sha256 + latest.json with mirror URLs so mirroring is a pure copy of release assets; key in GH secrets + password manager + `~/.tauri/` (git-ignored, verify).

---

## 5. Compat notes — what breaks when the site updates independently

- CSP additions (above) — the only way the site can break push.
- Cookie/auth schema changes (new SameSite/partitioned flags, session rotation): WebView2 keeps its own profile, so a changed cookie contract just logs the desktop user out once; re-login is the site's normal flow.
- Deep-link click URLs are minted by `server/ntfy-notify.mjs` (`astra://open?path=/c/<sid>`): any shape change there must keep `path=` (absolute site path). The Rust parser only knows `path=`.
- Route renames (/c/xyz → /chat/xyz): old pending-URL navigations 404 in-app — the site's own routing handles it; nothing to do in the shell.
- The init script depends on `window.__TAURI__` (pinned by this app's binary, not the site) and on ntfy's `/ws` JSON shape (stable since 2022). Site JS updates cannot affect either.
- WebView2 is evergreen — the shell inherits Edge's engine updates automatically; no action.
- ntfy credential rotation: constants are compiled into the binary → rotate = bump + rebuild + release (updater delivers it).
- The webui may someday call `window.__TAURI__.*` itself (capability already grants event/notification/window/deep-link) — no shell change needed for that to work.
