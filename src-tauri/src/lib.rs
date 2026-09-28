use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_notification::NotificationExt;
use url::Url;

const SITE: &str = "https://astra.jitinnair.com";
const NTFY_WS: &str = "wss://ntfy.jitinnair.com/NTFY_TOPIC_REMOVED/ws";
const NTFY_AUTH: &str = "NTFY_AUTH_B64_REMOVED=";

struct PendingNav(Mutex<Option<(String, std::time::Instant)>>);

fn navigate(app: &AppHandle, path_or_url: &str) {
    let Some(w) = app.get_webview_window("main") else { return; };
    let full = if path_or_url.starts_with("http") { 
        path_or_url.into() 
    } else { 
        format!("{SITE}{path_or_url}") 
    };
    let js = format!("window.__astraNavigate__ && window.__astraNavigate__({})", serde_json::to_string(&full).unwrap());
    let _ = w.show(); 
    let _ = w.unminimize(); 
    let _ = w.set_focus();
    let _ = w.eval(&js);
}

fn astra_path(u: &str) -> String {
    if let Ok(url) = Url::parse(u) {
        if url.scheme() == "astra" {
            return url.query_pairs()
                .find(|(k, _)| k == "path")
                .map(|(_, v)| v.into_owned())
                .unwrap_or_else(|| "/".into());
        }
    }
    u.to_string()
}

#[derive(serde::Deserialize)]
struct NtfyMsg { 
    id: String, 
    title: String, 
    body: String, 
    click: Option<String> 
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default().manage(PendingNav(Mutex::new(None)));

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(u) = argv.iter().find(|a| a.starts_with("astra://")) {
                navigate(app, &astra_path(u));
            } else {
                if let Some(w) = app.get_webview_window("main") { 
                    let _ = w.set_focus(); 
                }
            }
        }));
    }

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            #[cfg(desktop)]
            { 
                use tauri_plugin_deep_link::DeepLinkExt; 
                let _ = app.deep_link().register_all(); 
            }

            {
                let handle = app.handle().clone();
                app.listen("deep-link://new-url", move |e| {
                    if let Ok(urls) = serde_json::from_str::<Vec<String>>(e.payload()) {
                        if let Some(u) = urls.first() { 
                            navigate(&handle, &astra_path(u)); 
                        }
                    }
                });
            }

            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Ok(Some(urls)) = app.deep_link().get_current() {
                    if let Some(u) = urls.first() { 
                        navigate(app.handle(), &astra_path(u)); 
                    }
                }
            }

            let init = include_str!("scripts/ntfy-init.js")
                .replace("__NTFY_WS_URL__", &format!("{NTFY_WS}?auth={NTFY_AUTH}"));
                
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(SITE.parse().unwrap()))
                .title("Astra")
                .inner_size(1280.0, 800.0)
                .min_inner_size(960.0, 640.0)
                .initialization_script(&init)
                .on_navigation(|url| url.scheme() == "https" && url.host_str() == Some("astra.jitinnair.com"))
                .build()?;

            {
                let handle = app.handle().clone();
                app.listen("ntfy-message", move |e| {
                    let Ok(m) = serde_json::from_str::<NtfyMsg>(e.payload()) else { return };
                    let Some(w) = handle.get_webview_window("main") else { return };
                    let occupied = w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false);
                    if occupied { return; } 
                    let mut b = handle.notification().builder().title(&m.title).body(&m.body);
                    if let Some(icon) = handle.default_window_icon() {
                        b = b.icon(icon.clone());
                    }
                    let _ = b.show();
                    if let Some(click) = m.click {
                        let state = handle.state::<PendingNav>();
                        *state.0.lock().unwrap() = Some((click, std::time::Instant::now()));
                    }
                });
            }

            let open = tauri::menu::MenuItem::with_id(app, "open", "Open", true, None::<&str>)?;
            let quit = tauri::menu::MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = tauri::menu::Menu::with_items(app, &[&open, &quit])?;
            
            let icon = app.default_window_icon().unwrap().clone();
            tauri::tray::TrayIconBuilder::with_id("main-tray")
                .icon(icon)
                .tooltip("Astra")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, ev| match ev.id().as_ref() {
                    "open" => navigate(app, "/"),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, ev| {
                    if let tauri::tray::TrayIconEvent::Click { .. } = ev {
                        navigate(tray.app_handle(), "/");
                    }
                })
                .build(app)?;

            {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(5));
                    tauri::async_runtime::block_on(async move {
                        use tauri_plugin_updater::UpdaterExt;
                        if let Ok(Some(update)) = handle.updater_builder().check().await {
                            if let Ok(body) = update.download(|_, _| {}, || {}).await {
                                let _ = update.install(body);
                            }
                        }
                    });
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } if window.label() == "main" => {
                api.prevent_close();
                let _ = window.hide();
            }
            tauri::WindowEvent::Focused(true) if window.label() == "main" => {
                let app = window.app_handle();
                let state = app.state::<PendingNav>();
                if let Some((url, at)) = state.0.lock().unwrap().take() {
                    if at.elapsed() < std::time::Duration::from_secs(90) { 
                        navigate(app, &url); 
                    }
                }
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
