mod backup;
mod printer;

use std::path::PathBuf;
use tauri::Manager;

fn backups_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let docs = app.path().document_dir().map_err(|e| e.to_string())?;
    Ok(docs.join("Msingi Backups"))
}

/// Creates (if needed) and returns the folder where backups are saved.
#[tauri::command]
fn prepare_backup_dir(app: tauri::AppHandle) -> Result<String, String> {
    backup::ensure_dir(&backups_dir(&app)?)
}

/// Lists saved backups as (file name, size in bytes, modified unix seconds), newest first.
#[tauri::command]
fn list_backups(app: tauri::AppHandle) -> Result<Vec<(String, u64, u64)>, String> {
    backup::list_backups(&backups_dir(&app)?)
}

/// Validates a backup and stages it; it is applied the next time the app starts.
#[tauri::command]
fn stage_restore(app: tauri::AppHandle, name: String, db_dir: String) -> Result<(), String> {
    backup::stage_restore(&backups_dir(&app)?, &name, &PathBuf::from(db_dir))
}

/// Sends raw ESC/POS bytes (receipt, slip or cash-drawer pulse) to a printer.
/// `mode` is "network" (target = IP address or name, port = usually 9100) or "queue" (target = print queue name).
/// These are async so a slow or switched-off printer never freezes the till screen.
#[tauri::command]
async fn print_raw(mode: String, target: String, port: u16, data: Vec<u8>) -> Result<(), String> {
    match mode.as_str() {
        "network" => printer::send_network(&target, port, &data, 4000),
        "queue" => printer::send_queue(&target, &data),
        _ => Err("Choose how to reach the printer in the printer settings.".to_string()),
    }
}

/// Is the printer reachable right now? `mode` is "network" or "queue". Sends nothing to the printer.
#[tauri::command]
async fn check_printer(mode: String, target: String, port: u16) -> Result<(), String> {
    match mode.as_str() {
        "network" => printer::check_network(&target, port, 2500),
        "queue" => printer::check_queue(&target),
        _ => Err("Choose how to reach the printer in the printer settings.".to_string()),
    }
}

/// Print queues installed on this computer (Mac/Linux), for the printer settings drop-down.
#[tauri::command]
async fn list_print_queues() -> Result<Vec<String>, String> {
    printer::list_queues()
}

/// Keeps only the newest `keep` automatic backups. Returns how many were deleted.
#[tauri::command]
fn prune_auto_backups(app: tauri::AppHandle, keep: usize) -> Result<usize, String> {
    backup::prune_auto(&backups_dir(&app)?, keep.clamp(3, 365))
}

/// Opens the backup folder in Finder.
#[tauri::command]
fn open_backup_folder(app: tauri::AppHandle) -> Result<(), String> {
    let dir = backups_dir(&app)?;
    backup::ensure_dir(&dir)?;
    #[cfg(target_os = "macos")]
    let opener = "open";
    #[cfg(target_os = "windows")]
    let opener = "explorer";
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let opener = "xdg-open";
    std::process::Command::new(opener)
        .arg(&dir)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Could not open the folder: {e}"))
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // Only one Msingi may run at a time: two copies fight over the same database file and one of them
    // gets "database is busy". A second launch just brings the first window to the front.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }));
    builder
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // Apply a staged restore before the database is opened. The pending file sits beside
            // the live database, so check the folders the SQL plugin could be using.
            let mut dirs: Vec<PathBuf> = Vec::new();
            for found in [
                app.path().app_config_dir(),
                app.path().app_data_dir(),
                app.path().app_local_data_dir(),
            ] {
                if let Ok(d) = found {
                    if !dirs.contains(&d) {
                        dirs.push(d);
                    }
                }
            }
            for dir in dirs {
                match backup::apply_pending_restore(&dir) {
                    Ok(Some(message)) => eprintln!("{message}"),
                    Ok(None) => {}
                    Err(error) => eprintln!("Restore problem: {error}"),
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            prepare_backup_dir,
            list_backups,
            stage_restore,
            open_backup_folder,
            quit_app,
            prune_auto_backups,
            print_raw,
            list_print_queues,
            check_printer
        ])
        .run(tauri::generate_context!())
        .expect("error while running Msingi Accounting");
}
