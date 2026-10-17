use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::{AppHandle, Manager};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Preferences {
    min_to_tray: bool,
}
pub struct DesktopSettings {
    preferences: Mutex<Preferences>,
    window_transition: Mutex<()>,
}
fn data_dir() -> PathBuf {
    PathBuf::from(std::env::var_os("APPDATA").unwrap_or_else(|| ".".into())).join("pionailo")
}
impl DesktopSettings {
    pub fn new() -> Self {
        let preferences = fs::read(data_dir().join("desktop-settings.json"))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or(Preferences { min_to_tray: true });
        Self {
            preferences: Mutex::new(preferences),
            window_transition: Mutex::new(()),
        }
    }
    pub fn min_to_tray(&self) -> bool {
        self.preferences.lock().unwrap().min_to_tray
    }
    pub fn set_min_to_tray(&self, on: bool) -> Result<bool, String> {
        let mut state = self
            .preferences
            .lock()
            .map_err(|_| "Preferências indisponíveis")?;
        let next = Preferences { min_to_tray: on };
        let dir = data_dir();
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let temp = dir.join("desktop-settings.json.tmp");
        fs::write(&temp, serde_json::to_vec(&next).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        fs::rename(temp, dir.join("desktop-settings.json")).map_err(|e| e.to_string())?;
        *state = next;
        Ok(on)
    }
}
fn startup_path() -> PathBuf {
    PathBuf::from(std::env::var_os("APPDATA").unwrap_or_else(|| ".".into()))
        .join("Microsoft/Windows/Start Menu/Programs/Startup/PIO Nailo Rust.lnk")
}
pub fn autostart_enabled() -> bool {
    cfg!(windows) && startup_path().is_file()
}
pub fn set_autostart(on: bool) -> Result<bool, String> {
    #[cfg(windows)]
    {
        let path = startup_path();
        if on {
            fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
            let executable = std::env::var_os("PIO_NAILO_SOURCE_LAUNCHER")
                .map(PathBuf::from)
                .filter(|p| p.is_file())
                .map(Ok)
                .unwrap_or_else(std::env::current_exe)
                .map_err(|e| e.to_string())?;
            write_shortcut(
                &path,
                &executable,
                None,
            )?;
        } else if path.exists() {
            fs::remove_file(path).map_err(|e| e.to_string())?;
        }
        Ok(autostart_enabled())
    }
    #[cfg(not(windows))]
    {
        let _ = on;
        Err("Inicialização automática disponível apenas no Windows.".into())
    }
}
#[cfg(windows)]
fn write_shortcut(path:&std::path::Path,executable:&std::path::Path,_app_id:Option<&str>)->Result<(),String>{
    use std::os::windows::process::CommandExt;
    fn literal(p:&std::path::Path)->String{format!("'{}'",p.to_string_lossy().replace("'","''"))}
    let directory=executable.parent().ok_or("Pasta do executável indisponível")?;
    let script=format!("$ErrorActionPreference='Stop'; $shell=New-Object -ComObject WScript.Shell; $link=$shell.CreateShortcut({}); $link.TargetPath={}; $link.WorkingDirectory={}; $link.Save()",literal(path),literal(executable),literal(directory));
    let output=std::process::Command::new("powershell.exe").args(["-NoProfile","-NonInteractive","-Command",&script]).creation_flags(0x08000000).output().map_err(|_|"Não foi possível criar o atalho do Windows")?;
    if !output.status.success() || !path.is_file(){return Err("Não foi possível salvar o atalho de inicialização.".into());}Ok(())
}
pub fn restore_window(app: &AppHandle) {
    // Queue native operations outside the tray/window callback. Showing a still
    // minimized window can emit another resize and send it straight back to tray.
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let settings = app.state::<DesktopSettings>();
        let _transition = settings.window_transition.lock().unwrap();
        if let Some(window) = app.get_webview_window("main") {
            let result = window.unminimize()
                .and_then(|_| window.show())
                .and_then(|_| window.set_focus());
            if let Err(error) = result {
                eprintln!("[tray] Falha ao restaurar janela: {error}");
                return;
            }
            crate::webview_memory::set_window_background(&app, "main", false);
        }
    });
}

pub fn minimize_to_tray(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let settings = app.state::<DesktopSettings>();
        let _transition = settings.window_transition.lock().unwrap();
        if !settings.min_to_tray() || app.tray_by_id("pio-main").is_none() {
            return;
        }
        if let Some(window) = app.get_webview_window("main") {
            // Recheck after earlier restore requests, so a stale resize cannot hide it.
            if !window.is_minimized().unwrap_or(false) {
                return;
            }
            if let Err(error) = window.hide() {
                eprintln!("[tray] Falha ao ocultar janela: {error}");
                return;
            }
            crate::webview_memory::set_window_background(&app, "main", true);
        }
    });
}
pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    use tauri::{
        menu::{Menu, MenuItem},
        tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    };
    let open = MenuItem::with_id(app, "open", "Abrir PIO Nailo", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let mut builder = TrayIconBuilder::with_id("pio-main")
        .tooltip("PIO Nailo")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => restore_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::DoubleClick { button: MouseButton::Left, .. }
                | TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                restore_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}
