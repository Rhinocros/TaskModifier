use chrono::{Local, NaiveDateTime};
use encoding_rs::GBK;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Emitter;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RecurrenceRule {
    pub mode: String, // "ONCE", "DAILY", "WEEKLY", "MONTHLY", "WORKDAY", "HOLIDAY"
    #[serde(default)]
    pub days_of_week: Vec<u32>, // 1=Mon, 2=Tue, ..., 7=Sun
    #[serde(default)]
    pub days_of_month: Vec<u32>, // 1..31, 32=last day of month
    #[serde(default)]
    pub time_of_day: String, // "HH:mm:ss"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DateGroup {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub dates: Vec<String>, // "YYYY-MM-DD" 或 "YYYY-MM-DD ~ YYYY-MM-DD" 或 "YYYY-MM-DD HH:mm:ss"
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HolidayCalendar {
    pub updated_at: String,
    pub holidays: Vec<String>, // 放假日期 "YYYY-MM-DD"
    pub workdays: Vec<String>, // 调休补班日期 "YYYY-MM-DD"
}

// 系统计划任务修改器结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskRule {
    pub id: String,
    pub task_name: String,
    pub target_time: String, // 格式: YYYY-MM-DD HH:mm:ss
    pub action: String,      // "ENABLE" 或 "DISABLE"
    pub status: String,      // "PENDING", "SUCCESS", "FAILED"
    pub log_message: Option<String>,
    pub created_at: String,
    #[serde(default)]
    pub date_group_ids: Vec<String>,
    #[serde(default)]
    pub date_group_mode: String, // "NONE", "EXCLUDE", "FORCE_TRIGGER"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeWindow {
    pub start_time: Option<String>, // "YYYY-MM-DD HH:mm:ss"
    pub end_time: Option<String>,   // "YYYY-MM-DD HH:mm:ss"
}

// 高级自主任务引擎（支持丰富的定时循环设置、节假日/调休日历与日期时间组特例规则）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomTaskRule {
    pub id: String,
    pub name: String,
    pub is_enabled: bool,
    #[serde(default)]
    pub enable_window_start: Option<String>,
    #[serde(default)]
    pub enable_window_end: Option<String>,
    #[serde(default)]
    pub enable_windows: Vec<TimeWindow>, // 多个启用/禁用有效时间区间
    pub trigger_datetimes: Vec<String>,  // 多个不规则时间点
    pub executables: Vec<String>,        // 多个执行程序路径/命令行
    pub popup_messages: Vec<String>,     // 多个显示弹窗内容
    pub always_on_top: bool,             // 弹窗置顶
    #[serde(default)]
    pub triggered_history: Vec<String>, // 已触发记录
    pub created_at: String,
    #[serde(default)]
    pub recurrence: Option<RecurrenceRule>,
    #[serde(default)]
    pub date_group_ids: Vec<String>,
    #[serde(default)]
    pub date_group_mode: String, // "NONE", "EXCLUDE", "FORCE_TRIGGER"
}

#[derive(Default)]
pub struct AppState {
    pub tasks: Arc<Mutex<Vec<TaskRule>>>,
    pub custom_tasks: Arc<Mutex<Vec<CustomTaskRule>>>,
    pub holiday_calendar: Arc<Mutex<HolidayCalendar>>,
    pub date_groups: Arc<Mutex<Vec<DateGroup>>>,
}

fn get_config_path() -> PathBuf {
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(dir) = exe_path.parent() {
            return dir.join("tasks.json");
        }
    }
    PathBuf::from("tasks.json")
}

fn get_custom_config_path() -> PathBuf {
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(dir) = exe_path.parent() {
            return dir.join("custom_tasks.json");
        }
    }
    PathBuf::from("custom_tasks.json")
}

fn get_holiday_config_path() -> PathBuf {
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(dir) = exe_path.parent() {
            return dir.join("holidays.json");
        }
    }
    PathBuf::from("holidays.json")
}

fn get_date_groups_config_path() -> PathBuf {
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(dir) = exe_path.parent() {
            return dir.join("date_groups.json");
        }
    }
    PathBuf::from("date_groups.json")
}

fn load_date_groups_from_disk() -> Vec<DateGroup> {
    let path = get_date_groups_config_path();
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(groups) = serde_json::from_str::<Vec<DateGroup>>(&content) {
                return groups;
            }
        }
    }
    Vec::new()
}

fn save_date_groups_to_disk(groups: &[DateGroup]) {
    let path = get_date_groups_config_path();
    if let Ok(json) = serde_json::to_string_pretty(groups) {
        let _ = fs::write(path, json);
    }
}

pub fn is_date_in_date_groups(
    now_date_str: &str, // "YYYY-MM-DD"
    now_str: &str,      // "YYYY-MM-DD HH:mm:ss"
    groups: &[DateGroup],
    target_group_ids: &[String],
) -> bool {
    if target_group_ids.is_empty() {
        return false;
    }

    let now_date = chrono::NaiveDate::parse_from_str(now_date_str, "%Y-%m-%d")
        .or_else(|_| chrono::NaiveDate::parse_from_str(now_date_str, "%Y/%m/%d")).ok();

    for group in groups {
        if target_group_ids.contains(&group.id) {
            for item in &group.dates {
                let trimmed = item.trim().replace('/', "-");
                // Range match e.g. "2026-10-01 ~ 2026-10-07"
                if trimmed.contains('~') {
                    let parts: Vec<&str> = trimmed.split('~').collect();
                    if parts.len() == 2 {
                        let start_str = parts[0].trim();
                        let end_str = parts[1].trim();
                        if let (Some(d), Ok(start), Ok(end)) = (
                            now_date,
                            chrono::NaiveDate::parse_from_str(start_str, "%Y-%m-%d"),
                            chrono::NaiveDate::parse_from_str(end_str, "%Y-%m-%d"),
                        ) {
                            if d >= start && d <= end {
                                return true;
                            }
                        }
                    }
                } else if trimmed.len() == 10 { // "YYYY-MM-DD"
                    if trimmed == now_date_str {
                        return true;
                    }
                } else if trimmed == now_str { // "YYYY-MM-DD HH:mm:ss"
                    return true;
                }
            }
        }
    }
    false
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

fn load_custom_tasks_from_disk() -> Vec<CustomTaskRule> {
    let path = get_custom_config_path();
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(tasks) = serde_json::from_str::<Vec<CustomTaskRule>>(&content) {
                return tasks;
            }
        }
    }
    Vec::new()
}

fn save_custom_tasks_to_disk(tasks: &[CustomTaskRule]) {
    let path = get_custom_config_path();
    if let Ok(json) = serde_json::to_string_pretty(tasks) {
        let _ = fs::write(path, json);
    }
}

fn load_holiday_calendar_from_disk() -> HolidayCalendar {
    let path = get_holiday_config_path();
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(cal) = serde_json::from_str::<HolidayCalendar>(&content) {
                return cal;
            }
        }
    }
    HolidayCalendar::default()
}

fn save_holiday_calendar_to_disk(cal: &HolidayCalendar) {
    let path = get_holiday_config_path();
    if let Ok(json) = serde_json::to_string_pretty(cal) {
        let _ = fs::write(path, json);
    }
}

pub fn is_workday(date: chrono::NaiveDate, calendar: &HolidayCalendar) -> bool {
    use chrono::Datelike;
    let date_str = date.format("%Y-%m-%d").to_string();

    if calendar.workdays.contains(&date_str) {
        return true;
    }
    if calendar.holidays.contains(&date_str) {
        return false;
    }

    let weekday = date.weekday().number_from_monday();
    weekday <= 5
}

pub fn matches_recurrence(
    rule: &RecurrenceRule,
    now: chrono::DateTime<chrono::Local>,
    calendar: &HolidayCalendar,
) -> bool {
    use chrono::Datelike;

    if !rule.time_of_day.is_empty() {
        let current_time_str = now.format("%H:%M:%S").to_string();
        let target_time = if rule.time_of_day.len() == 5 {
            format!("{}:00", rule.time_of_day)
        } else {
            rule.time_of_day.clone()
        };
        if current_time_str != target_time {
            return false;
        }
    }

    let today = now.date_naive();
    let weekday = today.weekday().number_from_monday();
    let day_of_month = today.day();

    match rule.mode.as_str() {
        "DAILY" => true,
        "WEEKLY" => {
            if rule.days_of_week.is_empty() {
                weekday <= 5
            } else {
                rule.days_of_week.contains(&weekday)
            }
        }
        "MONTHLY" => {
            let is_last_day_of_month = {
                let next_day = today + chrono::Duration::days(1);
                next_day.month() != today.month()
            };
            if rule.days_of_month.contains(&day_of_month) {
                true
            } else if is_last_day_of_month && rule.days_of_month.contains(&32) {
                true
            } else {
                false
            }
        }
        "WORKDAY" => is_workday(today, calendar),
        "HOLIDAY" => !is_workday(today, calendar),
        _ => false,
    }
}

fn decode_win_output(bytes: &[u8]) -> String {
    let (cow, _, has_errors) = GBK.decode(bytes);
    if !has_errors {
        cow.trim().to_string()
    } else {
        String::from_utf8_lossy(bytes).trim().to_string()
    }
}

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
                    1,
                );

                if res as usize > 32 {
                    std::process::exit(0);
                }
            }
        }
    }
}

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

    let (ok1, msg1) = run_schtasks_cmd(task_name, action_flag);
    if ok1 {
        return Ok(format!("已成功设置为【{}】(系统提示: {}) [注: 若任务计划程序窗口已打开，请按 F5 刷新页面查看状态]", action_zh, msg1));
    }

    if !task_name.starts_with('\\') {
        let alt_name = format!("\\{}", task_name);
        let (ok2, msg2) = run_schtasks_cmd(&alt_name, action_flag);
        if ok2 {
            return Ok(format!("已成功设置为【{}】(系统提示: {}) [注: 请按 F5 刷新查看状态]", action_zh, msg2));
        }
    }

    Err(format!("修改失败: {}", msg1))
}

fn trigger_custom_task_actions(app_handle: &tauri::AppHandle, task: &CustomTaskRule) {
    for exe in &task.executables {
        let exe_str = exe.trim().to_string();
        if !exe_str.is_empty() {
            std::thread::spawn(move || {
                #[cfg(target_os = "windows")]
                {
                    use std::os::windows::process::CommandExt;
                    const CREATE_NO_WINDOW: u32 = 0x08000000;
                    let _ = Command::new("cmd")
                        .args(["/C", &exe_str])
                        .creation_flags(CREATE_NO_WINDOW)
                        .spawn();
                }
                #[cfg(not(target_os = "windows"))]
                {
                    let _ = Command::new("sh").args(["-c", &exe_str]).spawn();
                }
            });
        }
    }

    use tauri::Manager;
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        if task.always_on_top {
            let _ = window.set_always_on_top(true);
        }
        let _ = window.set_focus();
    }

    #[derive(Serialize, Clone)]
    struct TriggerPayload {
        task_name: String,
        popup_messages: Vec<String>,
        always_on_top: bool,
    }

    let payload = TriggerPayload {
        task_name: task.name.clone(),
        popup_messages: task.popup_messages.clone(),
        always_on_top: task.always_on_top,
    };

    let _ = app_handle.emit("custom_task_triggered", payload);
}

// ----------------- 节假日在线同步服务 -----------------
async fn fetch_year_holidays(client: &reqwest::Client, year: u32) -> Result<(Vec<String>, Vec<String>), String> {
    let url = format!("https://timor.tech/api/holiday/year/{}/", year);
    let req = client.get(&url).header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)");

    let res = match req.send().await {
        Ok(r) => r,
        Err(e) => return Err(format!("网络请求失败: {}", e)),
    };

    let json: serde_json::Value = match res.json().await {
        Ok(j) => j,
        Err(e) => return Err(format!("解析 JSON 失败: {}", e)),
    };

    let mut holidays = Vec::new();
    let mut workdays = Vec::new();

    if let Some(holiday_map) = json.get("holiday").and_then(|v| v.as_object()) {
        for (_k, item) in holiday_map {
            if let Some(date_str) = item.get("date").and_then(|s| s.as_str()) {
                let is_holiday = item.get("holiday").and_then(|b| b.as_bool()).unwrap_or(false);
                if is_holiday {
                    holidays.push(date_str.to_string());
                } else {
                    workdays.push(date_str.to_string());
                }
            }
        }
    }

    Ok((holidays, workdays))
}

// ----------------- Tauri IPC APIs (节假日日历) -----------------
#[tauri::command]
fn get_holiday_calendar(state: tauri::State<'_, AppState>) -> HolidayCalendar {
    let cal = state.holiday_calendar.lock().unwrap();
    cal.clone()
}

#[tauri::command]
async fn fetch_and_update_holidays(
    state: tauri::State<'_, AppState>,
    year: Option<u32>,
) -> Result<HolidayCalendar, String> {
    use chrono::Datelike;
    let target_year = year.unwrap_or_else(|| Local::now().year() as u32);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("构建 HTTP 客户端失败: {}", e))?;

    let mut all_holidays = Vec::new();
    let mut all_workdays = Vec::new();

    for y in [target_year, target_year + 1] {
        if let Ok((h_list, w_list)) = fetch_year_holidays(&client, y).await {
            all_holidays.extend(h_list);
            all_workdays.extend(w_list);
        }
    }

    let mut cal = state.holiday_calendar.lock().unwrap();
    if !all_holidays.is_empty() || !all_workdays.is_empty() {
        for h in all_holidays {
            if !cal.holidays.contains(&h) {
                cal.holidays.push(h);
            }
        }
        for w in all_workdays {
            if !cal.workdays.contains(&w) {
                cal.workdays.push(w);
            }
        }
        cal.holidays.sort();
        cal.workdays.sort();
        cal.updated_at = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        save_holiday_calendar_to_disk(&cal);
        Ok(cal.clone())
    } else {
        Err("未能从网络拉取到最新节假日数据，保持现有缓存数据".into())
    }
}

#[tauri::command]
fn save_holiday_calendar(
    state: tauri::State<'_, AppState>,
    calendar: HolidayCalendar,
) -> Result<(), String> {
    let mut cal = state.holiday_calendar.lock().unwrap();
    *cal = calendar.clone();
    save_holiday_calendar_to_disk(&cal);
    Ok(())
}

// ----------------- Tauri IPC APIs (日期时间组) -----------------
#[tauri::command]
fn get_date_groups(state: tauri::State<'_, AppState>) -> Vec<DateGroup> {
    let groups = state.date_groups.lock().unwrap();
    groups.clone()
}

#[tauri::command]
fn save_date_groups(state: tauri::State<'_, AppState>, date_groups: Vec<DateGroup>) -> Result<(), String> {
    let mut groups = state.date_groups.lock().unwrap();
    *groups = date_groups.clone();
    save_date_groups_to_disk(&groups);
    Ok(())
}

#[tauri::command]
fn add_date_group(
    state: tauri::State<'_, AppState>,
    name: String,
    description: Option<String>,
    dates: Vec<String>,
) -> Result<DateGroup, String> {
    if name.trim().is_empty() {
        return Err("日期时间组名称不能为空".into());
    }

    let now_str = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let id = format!("group_{}", Local::now().timestamp_millis());

    let group = DateGroup {
        id,
        name: name.trim().to_string(),
        description: description.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
        dates: dates.into_iter().filter(|s| !s.trim().is_empty()).collect(),
        created_at: now_str,
    };

    let mut groups = state.date_groups.lock().unwrap();
    groups.push(group.clone());
    save_date_groups_to_disk(&groups);

    Ok(group)
}

#[tauri::command]
fn delete_date_group(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let mut groups = state.date_groups.lock().unwrap();
    groups.retain(|g| g.id != id);
    save_date_groups_to_disk(&groups);
    Ok(())
}

// ----------------- Tauri IPC APIs (标准系统计划任务) -----------------
#[tauri::command]
fn get_tasks(state: tauri::State<'_, AppState>) -> Vec<TaskRule> {
    let tasks = state.tasks.lock().unwrap();
    tasks.clone()
}

#[tauri::command]
fn add_task(
    state: tauri::State<'_, AppState>,
    task_name: String,
    target_time: String,
    action: String,
    date_group_ids: Option<Vec<String>>,
    date_group_mode: Option<String>,
) -> Result<TaskRule, String> {
    let clean_target_time = target_time.trim().replace('/', "-");
    if NaiveDateTime::parse_from_str(&clean_target_time, "%Y-%m-%d %H:%M:%S").is_err() {
        return Err("时间格式必须为 YYYY-MM-DD HH:mm:ss".into());
    }

    let now_str = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let id = format!("{}", Local::now().timestamp_millis());

    let new_rule = TaskRule {
        id,
        task_name: task_name.trim().to_string(),
        target_time: clean_target_time,
        action: action.to_uppercase(),
        status: "PENDING".into(),
        log_message: None,
        created_at: now_str,
        date_group_ids: date_group_ids.unwrap_or_default(),
        date_group_mode: date_group_mode.unwrap_or_else(|| "NONE".into()),
    };

    let mut tasks = state.tasks.lock().unwrap();
    tasks.push(new_rule.clone());
    save_tasks_to_disk(&tasks);

    Ok(new_rule)
}

#[tauri::command]
fn delete_task(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let mut tasks = state.tasks.lock().unwrap();
    tasks.retain(|t| t.id != id);
    save_tasks_to_disk(&tasks);
    Ok(())
}

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

// ----------------- Tauri IPC APIs (高级自主任务引擎) -----------------
#[tauri::command]
fn get_custom_tasks(state: tauri::State<'_, AppState>) -> Vec<CustomTaskRule> {
    let tasks = state.custom_tasks.lock().unwrap();
    tasks.clone()
}

#[tauri::command]
fn add_custom_task(
    state: tauri::State<'_, AppState>,
    name: String,
    enable_windows: Vec<TimeWindow>,
    trigger_datetimes: Vec<String>,
    executables: Vec<String>,
    popup_messages: Vec<String>,
    always_on_top: bool,
    recurrence: Option<RecurrenceRule>,
    date_group_ids: Option<Vec<String>>,
    date_group_mode: Option<String>,
) -> Result<CustomTaskRule, String> {
    if name.trim().is_empty() {
        return Err("自定义任务名称不能为空".into());
    }

    let now_str = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let id = format!("custom_{}", Local::now().timestamp_millis());

    let rule = CustomTaskRule {
        id,
        name: name.trim().to_string(),
        is_enabled: true,
        enable_window_start: None,
        enable_window_end: None,
        enable_windows,
        trigger_datetimes: trigger_datetimes.into_iter().filter(|s| !s.trim().is_empty()).collect(),
        executables: executables.into_iter().filter(|s| !s.trim().is_empty()).collect(),
        popup_messages: popup_messages.into_iter().filter(|s| !s.trim().is_empty()).collect(),
        always_on_top,
        triggered_history: Vec::new(),
        created_at: now_str,
        recurrence,
        date_group_ids: date_group_ids.unwrap_or_default(),
        date_group_mode: date_group_mode.unwrap_or_else(|| "NONE".into()),
    };

    let mut tasks = state.custom_tasks.lock().unwrap();
    tasks.push(rule.clone());
    save_custom_tasks_to_disk(&tasks);

    Ok(rule)
}

#[tauri::command]
fn delete_custom_task(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let mut tasks = state.custom_tasks.lock().unwrap();
    tasks.retain(|t| t.id != id);
    save_custom_tasks_to_disk(&tasks);
    Ok(())
}

#[tauri::command]
fn toggle_custom_task(state: tauri::State<'_, AppState>, id: String, is_enabled: bool) -> Result<(), String> {
    let mut tasks = state.custom_tasks.lock().unwrap();
    if let Some(t) = tasks.iter_mut().find(|task| task.id == id) {
        t.is_enabled = is_enabled;
        save_custom_tasks_to_disk(&tasks);
        Ok(())
    } else {
        Err("找不到指定自定义任务".into())
    }
}

#[tauri::command]
fn execute_custom_task_now(app_handle: tauri::AppHandle, state: tauri::State<'_, AppState>, id: String) -> Result<String, String> {
    let tasks = state.custom_tasks.lock().unwrap();
    if let Some(t) = tasks.iter().find(|task| task.id == id) {
        trigger_custom_task_actions(&app_handle, t);
        Ok("已成功手动即时触发该自定义任务！".to_string())
    } else {
        Err("找不到指定自定义任务".into())
    }
}

// ----------------- 后台高精度到期轮询任务 -----------------
fn start_background_scheduler(
    app_handle: tauri::AppHandle,
    tasks_mutex: Arc<Mutex<Vec<TaskRule>>>,
    custom_tasks_mutex: Arc<Mutex<Vec<CustomTaskRule>>>,
    holiday_calendar_mutex: Arc<Mutex<HolidayCalendar>>,
    date_groups_mutex: Arc<Mutex<Vec<DateGroup>>>,
) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;

            let now = Local::now();
            let now_naive = now.naive_local();
            let now_str = now.format("%Y-%m-%d %H:%M:%S").to_string();
            let now_date_str = now.format("%Y-%m-%d").to_string();
            let holiday_cal = holiday_calendar_mutex.lock().unwrap().clone();
            let date_groups = date_groups_mutex.lock().unwrap().clone();

            // 1. 系统计划任务修改器检测（支持具体时间与日期时间组特例模式）
            let mut should_save_tasks = false;
            let mut tasks_to_notify = false;

            {
                let mut tasks = tasks_mutex.lock().unwrap();
                for task in tasks.iter_mut() {
                    if task.status == "PENDING" {
                        let is_in_group = is_date_in_date_groups(&now_date_str, &now_str, &date_groups, &task.date_group_ids);

                        // 如果匹配“不触发”特例日期组，则跳过
                        if task.date_group_mode == "EXCLUDE" && is_in_group {
                            continue;
                        }

                        let mut force_triggered = false;
                        if task.date_group_mode == "FORCE_TRIGGER" && is_in_group {
                            force_triggered = true;
                        }

                        if let Ok(target) = NaiveDateTime::parse_from_str(&task.target_time, "%Y-%m-%d %H:%M:%S") {
                            if now_naive >= target || force_triggered {
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
                                should_save_tasks = true;
                                tasks_to_notify = true;
                            }
                        }
                    }
                }

                if should_save_tasks {
                    save_tasks_to_disk(&tasks);
                }
            }

            if tasks_to_notify {
                let _ = app_handle.emit("tasks_updated", ());
            }

            // 2. 高级自主任务引擎检测（包含多种循环周期、节假日与日期时间组特例处理）
            let mut should_save_custom = false;
            let mut custom_updated = false;

            {
                let mut custom_tasks = custom_tasks_mutex.lock().unwrap();
                for task in custom_tasks.iter_mut() {
                    let mut in_time_window = true;
                    let mut windows = task.enable_windows.clone();

                    if windows.is_empty() && (task.enable_window_start.is_some() || task.enable_window_end.is_some()) {
                        windows.push(TimeWindow {
                            start_time: task.enable_window_start.clone(),
                            end_time: task.enable_window_end.clone(),
                        });
                    }

                    if !windows.is_empty() {
                        in_time_window = false;
                        for win in &windows {
                            let mut match_win = true;
                            if let Some(start_str) = &win.start_time {
                                if let Ok(start_dt) = NaiveDateTime::parse_from_str(start_str, "%Y-%m-%d %H:%M:%S") {
                                    if now_naive < start_dt {
                                        match_win = false;
                                    }
                                }
                            }
                            if let Some(end_str) = &win.end_time {
                                if let Ok(end_dt) = NaiveDateTime::parse_from_str(end_str, "%Y-%m-%d %H:%M:%S") {
                                    if now_naive > end_dt {
                                        match_win = false;
                                    }
                                }
                            }
                            if match_win {
                                in_time_window = true;
                                break;
                            }
                        }
                    }

                    if !task.is_enabled || !in_time_window {
                        continue;
                    }

                    let is_in_group = is_date_in_date_groups(&now_date_str, &now_str, &date_groups, &task.date_group_ids);

                    // 如果处于“遇此组不触发”例外，跳过该规则
                    if task.date_group_mode == "EXCLUDE" && is_in_group {
                        continue;
                    }

                    // 如果处于“遇此组强制/临时触发”特例
                    if task.date_group_mode == "FORCE_TRIGGER" && is_in_group {
                        let time_part = if let Some(ref r) = task.recurrence {
                            if !r.time_of_day.is_empty() { r.time_of_day.clone() } else { "00:00:00".to_string() }
                        } else {
                            "00:00:00".to_string()
                        };
                        let force_key = format!("force_group_{}_{}_{}", now_date_str, time_part, task.id);

                        let time_matches = if let Some(ref r) = task.recurrence {
                            if !r.time_of_day.is_empty() {
                                let current_time_str = now.format("%H:%M:%S").to_string();
                                let target_t = if r.time_of_day.len() == 5 { format!("{}:00", r.time_of_day) } else { r.time_of_day.clone() };
                                current_time_str == target_t
                            } else {
                                true
                            }
                        } else {
                            true
                        };

                        if time_matches && !task.triggered_history.contains(&force_key) {
                            task.triggered_history.push(force_key);
                            should_save_custom = true;
                            custom_updated = true;
                            trigger_custom_task_actions(&app_handle, task);
                        }
                    }

                    // A. 校验单次不规则触发时刻
                    for dt in &task.trigger_datetimes {
                        if dt == &now_str && !task.triggered_history.contains(dt) {
                            task.triggered_history.push(dt.clone());
                            should_save_custom = true;
                            custom_updated = true;
                            trigger_custom_task_actions(&app_handle, task);
                        }
                    }

                    // B. 校验循环规则
                    if let Some(ref rule) = task.recurrence {
                        if rule.mode != "ONCE" {
                            let trigger_key = format!("recur_{}_{}", now_date_str, rule.time_of_day);
                            if matches_recurrence(rule, now, &holiday_cal) && !task.triggered_history.contains(&trigger_key) {
                                task.triggered_history.push(trigger_key);
                                should_save_custom = true;
                                custom_updated = true;
                                trigger_custom_task_actions(&app_handle, task);
                            }
                        }
                    }
                }

                if should_save_custom {
                    save_custom_tasks_to_disk(&custom_tasks);
                }
            }

            if custom_updated {
                let _ = app_handle.emit("custom_tasks_updated", ());
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

    let initial_custom_tasks = load_custom_tasks_from_disk();
    let custom_tasks_mutex = Arc::new(Mutex::new(initial_custom_tasks));

    let initial_holiday_cal = load_holiday_calendar_from_disk();
    let holiday_calendar_mutex = Arc::new(Mutex::new(initial_holiday_cal));

    let initial_date_groups = load_date_groups_from_disk();
    let date_groups_mutex = Arc::new(Mutex::new(initial_date_groups));

    let app_state = AppState {
        tasks: tasks_mutex.clone(),
        custom_tasks: custom_tasks_mutex.clone(),
        holiday_calendar: holiday_calendar_mutex.clone(),
        date_groups: date_groups_mutex.clone(),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            get_tasks,
            add_task,
            delete_task,
            execute_task_now,
            get_custom_tasks,
            add_custom_task,
            delete_custom_task,
            toggle_custom_task,
            execute_custom_task_now,
            get_holiday_calendar,
            fetch_and_update_holidays,
            save_holiday_calendar,
            get_date_groups,
            save_date_groups,
            add_date_group,
            delete_date_group
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            start_background_scheduler(handle, tasks_mutex, custom_tasks_mutex, holiday_calendar_mutex, date_groups_mutex);

            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
            use tauri::Manager;

            let quit_i = MenuItem::with_id(app, "quit", "彻底退出程序", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "显示主界面", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("Windows 计划任务定时修改器 (后台常驻服务)")
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
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
