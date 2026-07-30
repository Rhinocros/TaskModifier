use chrono::{Local, NaiveDateTime};
use encoding_rs::GBK;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Emitter;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskRule {
    pub id: String,
    pub task_name: String,
    pub target_time: String, // 格式: YYYY-MM-DD HH:mm:ss
    pub action: String,      // "ENABLE" 或 "DISABLE"
    pub status: String,      // "PENDING", "SUCCESS", "FAILED"
    pub log_message: Option<String>,
    pub created_at: String,
}

#[derive(Default)]
pub struct AppState {
    pub tasks: Arc<Mutex<Vec<TaskRule>>>,
}

fn get_config_path() -> PathBuf {
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(dir) = exe_path.parent() {
            return dir.join("tasks.json");
        }
    }
    PathBuf::from("tasks.json")
}

fn load_tasks_from_disk() -> Vec<TaskRule> {
    let path = get_config_path();
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(tasks) = serde_json::from_str::<Vec<TaskRule>>(&content) {
                return tasks;
            }
        }
    }
    Vec::new()
}

fn save_tasks_to_disk(tasks: &[TaskRule]) {
    let path = get_config_path();
    if let Ok(json) = serde_json::to_string_pretty(tasks) {
        let _ = fs::write(path, json);
    }
}

// 帮助函数：解码 Windows 输出为 UTF-8 字符串
fn decode_win_output(bytes: &[u8]) -> String {
    let (cow, _, has_errors) = GBK.decode(bytes);
    if !has_errors {
        cow.trim().to_string()
    } else {
        String::from_utf8_lossy(bytes).trim().to_string()
    }
}

// 检查并在未具备管理员权限时通过 runas 自动触发 UAC 提权
#[cfg(target_os = "windows")]
fn ensure_admin_privileges() {
    use std::env;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr::null_mut;
    use windows_sys::Win32::UI::Shell::{IsUserAnAdmin, ShellExecuteW};

    unsafe {
        if IsUserAnAdmin() == 0 {
            if let Ok(exe_path) = env::current_exe() {
                let exe_wide: Vec<u16> = exe_path
                    .as_os_str()
                    .encode_wide()
                    .chain(std::iter::once(0))
                    .collect();
                let verb_wide: Vec<u16> = "runas".encode_utf16().chain(std::iter::once(0)).collect();

                let res = ShellExecuteW(
                    null_mut(),
                    verb_wide.as_ptr(),
                    exe_wide.as_ptr(),
                    null_mut(),
                    null_mut(),
                    1, // SW_SHOWNORMAL
                );

                // 若成功触发 UAC 并拉起管理员子进程，退出当前非管理员进程
                if res as usize > 32 {
                    std::process::exit(0);
                }
            }
        }
    }
}

// 执行 Windows schtasks 命令修改计划任务状态
fn run_schtasks_cmd(task_name: &str, action_flag: &str) -> (bool, String) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let output = Command::new("schtasks")
            .args(["/Change", "/TN", task_name, action_flag])
            .creation_flags(CREATE_NO_WINDOW)
            .output();

        match output {
            Ok(out) => {
                let stdout = decode_win_output(&out.stdout);
                let stderr = decode_win_output(&out.stderr);
                let is_ok = out.status.success();
                let msg = if is_ok {
                    if stdout.is_empty() { "成功修改参数".to_string() } else { stdout }
                } else {
                    if !stderr.is_empty() { stderr } else { stdout }
                };
                (is_ok, msg)
            }
            Err(e) => (false, format!("启动进程失败: {}", e)),
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        (true, "[模拟环境] 成功修改".to_string())
    }
}

fn execute_schtasks(task_name: &str, action: &str) -> Result<String, String> {
    let action_flag = if action.to_uppercase() == "ENABLE" {
        "/ENABLE"
    } else {
        "/DISABLE"
    };

    let action_zh = if action.to_uppercase() == "ENABLE" { "启用" } else { "禁用" };

    // 1. 尝试直接按原名称修改
    let (ok1, msg1) = run_schtasks_cmd(task_name, action_flag);
    if ok1 {
        return Ok(format!("已成功设置为【{}】(系统提示: {}) [注: 若任务计划程序窗口已打开，请按 F5 刷新页面查看最新的“{}”状态]", action_zh, msg1, action_zh));
    }

    // 2. 如果失败且名称开头没有 '\'，尝试加上根路径 '\' 重试
    if !task_name.starts_with('\\') {
        let alt_name = format!("\\{}", task_name);
        let (ok2, msg2) = run_schtasks_cmd(&alt_name, action_flag);
        if ok2 {
            return Ok(format!("已成功设置为【{}】(系统提示: {}) [注: 请在任务计划程序窗口按 F5 刷新查看状态]", action_zh, msg2));
        }
    }

    Err(format!("修改失败: {}", msg1))
}

// Tauri IPC API: 获取当前所有任务
#[tauri::command]
fn get_tasks(state: tauri::State<'_, AppState>) -> Vec<TaskRule> {
    let tasks = state.tasks.lock().unwrap();
    tasks.clone()
}

// Tauri IPC API: 添加新修改任务
#[tauri::command]
fn add_task(
    state: tauri::State<'_, AppState>,
    task_name: String,
    target_time: String,
    action: String,
) -> Result<TaskRule, String> {
    // 校验日期时间格式
    if NaiveDateTime::parse_from_str(&target_time, "%Y-%m-%d %H:%M:%S").is_err() {
        return Err("时间格式必须为 YYYY-MM-DD HH:mm:ss".into());
    }

    let now_str = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let id = format!("{}", Local::now().timestamp_millis());

    let new_rule = TaskRule {
        id,
        task_name: task_name.trim().to_string(),
        target_time,
        action: action.to_uppercase(),
        status: "PENDING".into(),
        log_message: None,
        created_at: now_str,
    };

    let mut tasks = state.tasks.lock().unwrap();
    tasks.push(new_rule.clone());
    save_tasks_to_disk(&tasks);

    Ok(new_rule)
}

// Tauri IPC API: 删除任务
#[tauri::command]
fn delete_task(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let mut tasks = state.tasks.lock().unwrap();
    tasks.retain(|t| t.id != id);
    save_tasks_to_disk(&tasks);
    Ok(())
}

// Tauri IPC API: 手动即时测试执行
#[tauri::command]
fn execute_task_now(state: tauri::State<'_, AppState>, id: String) -> Result<String, String> {
    let mut tasks = state.tasks.lock().unwrap();
    if let Some(task) = tasks.iter_mut().find(|t| t.id == id) {
        match execute_schtasks(&task.task_name, &task.action) {
            Ok(msg) => {
                task.status = "SUCCESS".into();
                task.log_message = Some(msg.clone());
                save_tasks_to_disk(&tasks);
                Ok(msg)
            }
            Err(err) => {
                task.status = "FAILED".into();
                task.log_message = Some(err.clone());
                save_tasks_to_disk(&tasks);
                Err(err)
            }
        }
    } else {
        Err("找不到指定任务".into())
    }
}

// 后台高精度到期轮询任务
fn start_background_scheduler(app_handle: tauri::AppHandle, tasks_mutex: Arc<Mutex<Vec<TaskRule>>>) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;

            let now = Local::now();
            let now_naive = now.naive_local();

            let mut should_save = false;
            let mut tasks_to_notify: Vec<(TaskRule, Result<String, String>)> = Vec::new();

            {
                let mut tasks = tasks_mutex.lock().unwrap();
                for task in tasks.iter_mut() {
                    if task.status == "PENDING" {
                        if let Ok(target) = NaiveDateTime::parse_from_str(&task.target_time, "%Y-%m-%d %H:%M:%S") {
                            if now_naive >= target {
                                // 到期！触发修改命令
                                let res = execute_schtasks(&task.task_name, &task.action);
                                match &res {
                                    Ok(msg) => {
                                        task.status = "SUCCESS".into();
                                        task.log_message = Some(msg.clone());
                                    }
                                    Err(err) => {
                                        task.status = "FAILED".into();
                                        task.log_message = Some(err.clone());
                                    }
                                }
                                should_save = true;
                                tasks_to_notify.push((task.clone(), res));
                            }
                        }
                    }
                }

                if should_save {
                    save_tasks_to_disk(&tasks);
                }
            }

            // 发送事件通知前端
            if !tasks_to_notify.is_empty() {
                let _ = app_handle.emit("tasks_updated", ());
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "windows")]
    ensure_admin_privileges();

    let initial_tasks = load_tasks_from_disk();
    let tasks_mutex = Arc::new(Mutex::new(initial_tasks));

    let app_state = AppState {
        tasks: tasks_mutex.clone(),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            get_tasks,
            add_task,
            delete_task,
            execute_task_now
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            start_background_scheduler(handle, tasks_mutex);

            // 配置托盘菜单与右下角常驻系统托盘
            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
            use tauri::Manager;

            let quit_i = MenuItem::with_id(app, "quit", "彻底退出程序", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "显示主界面", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("Windows 计划任务定时修改器 (运行中)")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        std::process::exit(0);
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| match event {
            // 拦截关闭按钮 X，隐藏到系统托盘而非销毁窗口
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
