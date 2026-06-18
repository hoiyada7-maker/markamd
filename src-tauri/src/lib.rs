#[cfg(target_os = "macos")]
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};

use std::sync::Mutex;
use tauri::State;

// `Emitter` and `Manager` are used by both the single-instance callback (all
// platforms) and the macOS Finder open-with handler. `RunEvent::Opened` is
// macOS-only, so it stays gated.
use tauri::{Emitter, Manager};
#[cfg(target_os = "macos")]
use tauri::RunEvent;

struct PendingOpenFiles(Mutex<Vec<String>>);

#[cfg(target_os = "windows")]
fn initial_open_files_from_args() -> Vec<String> {
    std::env::args_os()
        .skip(1)
        .filter_map(|arg| {
            let path = std::path::PathBuf::from(arg);
            let ext = path.extension()?.to_str()?.to_ascii_lowercase();
            if path.is_file() && matches!(ext.as_str(), "md" | "markdown" | "mdx") {
                Some(path.to_string_lossy().to_string())
            } else {
                None
            }
        })
        .collect()
}

#[tauri::command]
fn pick_folder_with_hidden() -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        let script = r#"
import sys, gi
gi.require_version('Gtk', '3.0')
from gi.repository import Gtk
dialog = Gtk.FileChooserDialog(title='Open Folder', action=Gtk.FileChooserAction.SELECT_FOLDER)
dialog.add_buttons('Cancel', Gtk.ResponseType.CANCEL, 'Open', Gtk.ResponseType.ACCEPT)
dialog.set_show_hidden(True)
response = dialog.run()
if response == Gtk.ResponseType.ACCEPT:
    print(dialog.get_filename())
dialog.destroy()
"#;
        let output = std::process::Command::new("python3")
            .args(["-c", script])
            .output()
            .ok()?;
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(path);
            }
        }
    }
    None
}

#[tauri::command]
fn reveal_in_file_manager(path: String) {
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    let p = std::path::Path::new(&path);
    #[cfg(target_os = "windows")]
    {
        let target = if p.is_dir() {
            path.clone()
        } else {
            p.parent()
                .and_then(|d| d.to_str())
                .unwrap_or("")
                .to_string()
        };
        let _ = std::process::Command::new("explorer").arg(target).spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").args(["-R", &path]).spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let target = if p.is_dir() {
            p.to_str().unwrap_or("").to_string()
        } else {
            p.parent()
                .and_then(|d| d.to_str())
                .unwrap_or("")
                .to_string()
        };
        let _ = std::process::Command::new("xdg-open").arg(target).spawn();
    }
}

#[tauri::command]
fn take_pending_open_files(state: State<'_, PendingOpenFiles>) -> Vec<String> {
    let mut pending = state
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    std::mem::take(&mut *pending)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "windows")]
    let pending_open_files = initial_open_files_from_args();
    #[cfg(not(target_os = "windows"))]
    let pending_open_files = Vec::new();

    let app = tauri::Builder::default()
        .manage(PendingOpenFiles(Mutex::new(pending_open_files)))
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // A second instance was launched — forward any markdown file args
            // to the running instance, then bring its window to front.
            let paths: Vec<String> = args
                .iter()
                .skip(1) // skip argv[0] (executable path)
                .filter_map(|arg| {
                    let path = std::path::PathBuf::from(arg);
                    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
                    if path.is_file() && matches!(ext.as_str(), "md" | "markdown" | "mdx") {
                        Some(path.to_string_lossy().to_string())
                    } else {
                        None
                    }
                })
                .collect();
            for path in paths {
                let _ = app.emit("marka:open-file", path);
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![take_pending_open_files, reveal_in_file_manager, pick_folder_with_hidden])
        .setup(|_app| {
            #[cfg(target_os = "macos")]
            {
                let window = _app.get_webview_window("main").expect("main window missing");
                if let Err(err) = apply_vibrancy(
                    &window,
                    NSVisualEffectMaterial::Sidebar,
                    Some(NSVisualEffectState::Active),
                    Some(12.0),
                ) {
                    eprintln!("marka.md: apply_vibrancy failed: {err:?}");
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, _event| {
        // macOS Finder "Open With → marka.md" emits this event with file URLs.
        // `RunEvent::Opened` doesn't exist on Windows/Linux — gating the block
        // keeps non-mac compilation clean.
        #[cfg(target_os = "macos")]
        if let RunEvent::Opened { urls } = _event {
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    let path_str = path.to_string_lossy().to_string();
                    if let Some(state) = _app_handle.try_state::<PendingOpenFiles>() {
                        let mut pending = state
                            .0
                            .lock()
                            .unwrap_or_else(|poisoned| poisoned.into_inner());
                        pending.push(path_str.clone());
                    }
                    if let Err(err) = _app_handle.emit("marka:open-file", path_str.clone()) {
                        eprintln!("marka.md: failed to emit open-file event: {err:?}");
                    } else {
                        eprintln!("marka.md: open-file requested: {path_str}");
                    }
                }
            }
        }
    });
}
