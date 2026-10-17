use std::{collections::HashMap, sync::Mutex};
use tauri::{AppHandle, Manager};

#[cfg(windows)]
#[link(name = "user32")]
extern "system" {
    fn IsWindowVisible(window: *mut core::ffi::c_void) -> i32;
    fn IsIconic(window: *mut core::ffi::c_void) -> i32;
}

#[derive(Default)]
pub struct MemoryPolicy {
    views: Mutex<HashMap<String, bool>>,
    windows: Mutex<HashMap<String, bool>>,
}

pub fn effective_background(
    parent_background: bool,
    requested_background: bool,
    native_visible: bool,
) -> bool {
    parent_background || requested_background || !native_visible
}

pub fn set_window_background(app: &AppHandle, label: &str, background: bool) {
    app.state::<MemoryPolicy>()
        .windows
        .lock()
        .unwrap()
        .insert(label.into(), background);
    if let Some(window) = app.get_window(label) {
        for view in window.webviews() {
            refresh(&view);
        }
    }
}

pub fn requested_background(view: &tauri::Webview) -> bool {
    *view
        .app_handle()
        .state::<MemoryPolicy>()
        .views
        .lock()
        .unwrap()
        .get(view.label())
        .unwrap_or(&false)
}

pub fn prune(app: &AppHandle) {
    let policy = app.state::<MemoryPolicy>();
    policy
        .views
        .lock()
        .unwrap()
        .retain(|label, _| app.get_webview(label).is_some());
    policy
        .windows
        .lock()
        .unwrap()
        .retain(|label, _| app.get_window(label).is_some());
}

pub fn snapshot(app: &AppHandle) -> serde_json::Value {
    let policy = app.state::<MemoryPolicy>();
    serde_json::json!({ "requestedBackground": *policy.views.lock().unwrap(), "windowBackground": *policy.windows.lock().unwrap() })
}

/// Graphics cache hints, not a hard memory cap. Retain hardware acceleration.
pub const GAME_BROWSER_ARGS: &str =
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --force-gpu-mem-available-mb=64 --gpu-program-cache-size-kb=8192";
const BASELINE_BROWSER_ARGS: &str =
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";

// Wry's additional_browser_args replaces its defaults, including --proxy-server.
// Build both together so memory settings never bypass the account's proxy.
pub fn browser_args(proxy: Option<&url::Url>) -> String {
    browser_args_for_budget(
        proxy,
        !std::env::args().any(|arg| arg == "--graphics-budget=baseline"),
    )
}

fn browser_args_for_budget(proxy: Option<&url::Url>, budget: bool) -> String {
    let mut args = if budget {
        GAME_BROWSER_ARGS
    } else {
        BASELINE_BROWSER_ARGS
    }
    .to_owned();
    if let Some(proxy) = proxy {
        // Proxy credentials are handled by the local tunnel, not command lines.
        args.push_str(" --proxy-server=");
        args.push_str(proxy.scheme());
        args.push_str("://");
        args.push_str(&proxy[url::Position::BeforeHost..url::Position::AfterPort]);
    }
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_budget_preserves_proxy_routing_for_tunnel_and_direct_endpoints() {
        for endpoint in [
            "http://127.0.0.1:32100",
            "http://proxy.example:8080",
            "socks5://[::1]:1080",
        ] {
            let proxy = url::Url::parse(endpoint).unwrap();
            let args = browser_args(Some(&proxy));
            assert!(args
                .split_whitespace()
                .any(|arg| arg == format!("--proxy-server={endpoint}")));
            assert!(args.contains("--force-gpu-mem-available-mb=64"));
            assert!(args.contains("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection"));
        }
    }

    #[test]
    fn proxy_credentials_are_never_in_browser_command_line() {
        let proxy = url::Url::parse("http://user:secret@proxy.example:8080").unwrap();
        let args = browser_args(Some(&proxy));
        assert!(args.contains("--proxy-server=http://proxy.example:8080"));
        assert!(!args.contains("user"));
        assert!(!args.contains("secret"));
        assert!(!browser_args(None).contains("--proxy-server"));
    }

    #[test]
    fn baseline_only_removes_graphics_hints_and_preserves_proxy() {
        let proxy = url::Url::parse("http://127.0.0.1:32100").unwrap();
        let args = browser_args_for_budget(Some(&proxy), false);
        assert!(args.contains("--proxy-server=http://127.0.0.1:32100"));
        assert!(!args.contains("force-gpu-mem"));
        assert!(args.contains("--disable-features="));
    }
}

/// Low memory mode keeps scripts and WebSockets running (unlike TrySuspend).
/// Apply it only while a view is hidden; restore the normal target when shown.
pub fn set_background(view: &tauri::Webview, background: bool) {
    view.app_handle()
        .state::<MemoryPolicy>()
        .views
        .lock()
        .unwrap()
        .insert(view.label().into(), background);
    refresh(view);
}

pub fn refresh(view: &tauri::Webview) {
    let app = view.app_handle().clone();
    let label = view.label().to_owned();
    let window_label = view.window().label().to_owned();
    #[cfg(windows)]
    if let Err(error) = view.with_webview(move |native| {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
        };
        use windows_core::Interface;
        // Read the latest policy when the native callback executes. A queued
        // foreground update must never override a subsequent minimize/hide.
        let policy = app.state::<MemoryPolicy>();
        let requested = *policy.views.lock().unwrap().get(&label).unwrap_or(&false);
        // Query the native HWND here. Re-entering Tauri window getters inside
        // with_webview would borrow the runtime's window registry recursively.
        let mut parent_window = Default::default();
        let native_parent_background = unsafe {
            native.controller().ParentWindow(&mut parent_window).is_err()
                || IsWindowVisible(parent_window.0) == 0 || IsIconic(parent_window.0) != 0
        };
        let parent = *policy.windows.lock().unwrap().get(&window_label).unwrap_or(&false) || native_parent_background;
        let mut visible = windows_core::BOOL::default();
        let visibility = unsafe { native.controller().IsVisible(&mut visible) };
        let background = effective_background(parent, requested, visibility.is_ok() && visible.as_bool());
        let result = unsafe {
            native.controller().CoreWebView2().and_then(|core| {
                if label.starts_with("embedded-acc-") || label.starts_with("account-viewer-") || label.starts_with("family-") || label.starts_with("game-account-") {
                    let script = format!("window.__idleioBackgroundEconomy?.setHidden({background});");
                    let _ = core.ExecuteScript(&windows_core::HSTRING::from(script), None::<&webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2ExecuteScriptCompletedHandler>);
                }
                core.cast::<ICoreWebView2_19>().and_then(|core| {
                    core.SetMemoryUsageTargetLevel(if background {
                        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
                    } else {
                        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
                    })
                })
            })
        };
        if let Err(error) = result {
            eprintln!("[webview_memory] target failed: {error:?}");
        }
    }) {
        eprintln!("[webview_memory] dispatch failed: {error:?}");
    }
    #[cfg(not(windows))]
    let _ = (view, app, label, window_label);
}

#[cfg(test)]
mod visibility_tests {
    use super::*;
    #[test]
    fn restore_never_promotes_hidden_panels_and_minimize_wins_over_layout() {
        assert!(effective_background(false, true, false));
        assert!(effective_background(false, true, true));
        assert!(effective_background(true, false, true));
        assert!(effective_background(false, false, false));
        assert!(!effective_background(false, false, true));
    }
}

// Explicit diagnostic control; normal launches always use automatic background Economy.
pub fn background_economy_script() -> &'static str {
    if std::env::args().any(|arg| arg == "--background-economy=baseline") {
        ""
    } else {
        include_str!("background_economy.js")
    }
}
