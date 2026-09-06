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

#[derive(Debug, Clone, PartialEq)]
pub enum ParsedDateEntry {
    DateRange {
        start: chrono::NaiveDate,
        end: chrono::NaiveDate,
    },
    SingleDate {
        date: chrono::NaiveDate,
        time: Option<chrono::NaiveTime>,
    },
}

fn extract_numbers(s: &str) -> Vec<u32> {
    let mut nums = Vec::new();
    let mut cur = String::new();
    for ch in s.chars() {
        if ch.is_ascii_digit() {
            cur.push(ch);
        } else if !cur.is_empty() {
            if let Ok(n) = cur.parse::<u32>() {
                nums.push(n);
            }
            cur.clear();
        }
    }
    if !cur.is_empty() {
        if let Ok(n) = cur.parse::<u32>() {
            nums.push(n);
        }
    }
    nums
}

pub fn parse_flexible_date(s: &str) -> Option<chrono::NaiveDate> {
    let nums = extract_numbers(s);
    if nums.len() >= 3 {
        let (y, m, d) = (nums[0] as i32, nums[1], nums[2]);
        if (1970..=2100).contains(&y) && (1..=12).contains(&m) && (1..=31).contains(&d) {
            return chrono::NaiveDate::from_ymd_opt(y, m, d);
        }
    }
    None
}

pub fn parse_flexible_time(s: &str) -> Option<chrono::NaiveTime> {
    let nums = extract_numbers(s);
    if nums.len() >= 2 {
        let h = nums[0];
        let m = nums[1];
        let sec = if nums.len() >= 3 { nums[2] } else { 0 };
        if h < 24 && m < 60 && sec < 60 {
            return chrono::NaiveTime::from_hms_opt(h, m, sec);
        }
    }
    None
}

pub fn parse_flexible_datetime(s: &str) -> Option<chrono::NaiveDateTime> {
    let nums = extract_numbers(s);
    if nums.len() >= 3 {
        let (y, m, d) = (nums[0] as i32, nums[1], nums[2]);
        let date = chrono::NaiveDate::from_ymd_opt(y, m, d)?;
        let h = if nums.len() >= 4 { nums[3] } else { 0 };
        let m = if nums.len() >= 5 { nums[4] } else { 0 };
        let s = if nums.len() >= 6 { nums[5] } else { 0 };
        if h < 24 && m < 60 && s < 60 {
            let time = chrono::NaiveTime::from_hms_opt(h, m, s)?;
            return Some(chrono::NaiveDateTime::new(date, time));
        }
    }
    None
}

pub fn parse_date_group_item(item: &str) -> Option<ParsedDateEntry> {
    let trimmed = item.trim();

    // 支持多种区间连接符：~, 至, 到, " - " (避免普通连字符如 2026-10-01)
    let range_split = if trimmed.contains('~') {
        Some(trimmed.splitn(2, '~').collect::<Vec<_>>())
    } else if trimmed.contains("至") {
        Some(trimmed.splitn(2, "至").collect::<Vec<_>>())
    } else if trimmed.contains("到") {
        Some(trimmed.splitn(2, "到").collect::<Vec<_>>())
    } else if trimmed.contains(" - ") {
        Some(trimmed.splitn(2, " - ").collect::<Vec<_>>())
    } else {
        None
    };

    if let Some(parts) = range_split {
        if parts.len() == 2 {
            let start = parse_flexible_date(parts[0])?;
            let end = parse_flexible_date(parts[1])?;
            return Some(ParsedDateEntry::DateRange { start, end });
        }
    }

    let nums = extract_numbers(trimmed);
    if nums.len() >= 3 {
        let (y, m, d) = (nums[0] as i32, nums[1], nums[2]);
        let date = chrono::NaiveDate::from_ymd_opt(y, m, d)?;
        if nums.len() >= 5 {
            let h = nums[3];
            let min = nums[4];
            let sec = if nums.len() >= 6 { nums[5] } else { 0 };
            if h < 24 && min < 60 && sec < 60 {
                let time = chrono::NaiveTime::from_hms_opt(h, min, sec);
                return Some(ParsedDateEntry::SingleDate { date, time });
            }
        }
        return Some(ParsedDateEntry::SingleDate { date, time: None });
    }

    None
}

/// 检查指定日期是否落在关联的日期组内。
/// 日期组纯粹作为共享日期集合（单日期或区间），供多个任务读取引用；
/// 任务线程仅从日期组读取日期判断“今天是否在日期组中”，不从中读取执行程序或时间。
pub fn is_date_in_groups(
    date: chrono::NaiveDate,
    groups: &[DateGroup],
    target_group_ids: &[String],
) -> bool {
    if target_group_ids.is_empty() {
        return false;
    }
    for group in groups {
        let group_id = group.id.trim();
        if target_group_ids.iter().any(|tg_id| tg_id.trim().eq_ignore_ascii_case(group_id)) {
            for item in &group.dates {
                if let Some(parsed) = parse_date_group_item(item) {
                    match parsed {
                        ParsedDateEntry::DateRange { start, end } => {
                            if date >= start && date <= end {
                                return true;
                            }
                        }
                        ParsedDateEntry::SingleDate { date: d, .. } => {
                            if d == date {
                                return true;
                            }
                        }
                    }
                }
            }
        }
    }
    false
}

/// 兼容别名
pub fn is_date_excluded(
    date: chrono::NaiveDate,
    groups: &[DateGroup],
    target_group_ids: &[String],
) -> bool {
    is_date_in_groups(date, groups, target_group_ids)
}

/// 提取指定日期在关联特例日期组中所设定的触发时刻：
/// - 若日期组条目显式设定了具体时间（例如 08:30:00），提取该具体时刻；
/// - 若未显式设定时间（仅写了日期或为日期区间），回退采用任务自身设定的时刻（fallback_time）。
pub fn get_force_trigger_times(
    date: chrono::NaiveDate,
    groups: &[DateGroup],
    target_group_ids: &[String],
    fallback_time: Option<chrono::NaiveTime>,
) -> Vec<chrono::NaiveTime> {
    let mut times = Vec::new();
    if target_group_ids.is_empty() {
        return times;
    }

    for group in groups {
        let group_id = group.id.trim();
        if target_group_ids.iter().any(|tg_id| tg_id.trim().eq_ignore_ascii_case(group_id)) {
            for item in &group.dates {
                if let Some(parsed) = parse_date_group_item(item) {
                    match parsed {
                        ParsedDateEntry::DateRange { start, end } => {
                            if date >= start && date <= end {
                                let t = fallback_time.unwrap_or_else(|| chrono::NaiveTime::from_hms_opt(9, 0, 0).unwrap());
                                if !times.contains(&t) {
                                    times.push(t);
                                }
                            }
                        }
                        ParsedDateEntry::SingleDate { date: d, time } => {
                            if d == date {
                                let t = match time {
                                    Some(explicit_t) => explicit_t,
                                    None => fallback_time.unwrap_or_else(|| chrono::NaiveTime::from_hms_opt(9, 0, 0).unwrap()),
                                };
                                if !times.contains(&t) {
                                    times.push(t);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    times.sort();
    times
}

/// 兼容老接口
pub fn is_date_in_date_groups(
    now_date_str: &str,
    _now_str: &str,
    groups: &[DateGroup],
    target_group_ids: &[String],
) -> (bool, bool) {
    if let Some(d) = parse_flexible_date(now_date_str) {
        let is_in = is_date_excluded(d, groups, target_group_ids);
        (is_in, is_in)
    } else {
        (false, false)
    }
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

pub fn matches_recurrence_day(
    rule: &RecurrenceRule,
    today: chrono::NaiveDate,
    calendar: &HolidayCalendar,
) -> bool {
    use chrono::Datelike;
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

pub fn matches_recurrence(
    rule: &RecurrenceRule,
    now: chrono::DateTime<chrono::Local>,
    calendar: &HolidayCalendar,
) -> bool {
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

    matches_recurrence_day(rule, now.date_naive(), calendar)
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

/// 解析命令行字符串，返回 (可执行文件路径, 参数列表)
fn parse_command_line(cmd: &str) -> (String, Vec<String>) {
    let cmd = cmd.trim();
    if cmd.is_empty() {
        return (String::new(), Vec::new());
    }

    // 若命令以引号开头，路径是第一对引号内的内容
    if cmd.starts_with('"') {
        if let Some(end_quote) = cmd[1..].find('"') {
            let exe = cmd[1..=end_quote].to_string();
            let rest = cmd[end_quote + 2..].trim();
            let args = parse_args(rest);
            return (exe, args);
        }
    }

    // 否则以第一个空格分割
    if let Some(space_pos) = cmd.find(' ') {
        let exe = cmd[..space_pos].to_string();
        let rest = cmd[space_pos + 1..].trim();
        let args = parse_args(rest);
        return (exe, args);
    }

    // 没有参数
    (cmd.to_string(), Vec::new())
}

/// 简单解析参数字符串，支持带引号的参数
/// 引号用于标识包含空格的参数，解析后的参数中不包含引号字符
fn parse_args(args_str: &str) -> Vec<String> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut chars = args_str.chars().peekable();

    while let Some(ch) = chars.next() {
        match ch {
            '"' => {
                // 切换引号状态，但不将引号字符写入参数
                in_quotes = !in_quotes;
            }
            ' ' if !in_quotes => {
                if !current.is_empty() {
                    args.push(current.clone());
                    current.clear();
                }
            }
            _ => {
                current.push(ch);
            }
        }
    }
    if !current.is_empty() {
        args.push(current);
    }
    args
}

fn trigger_custom_task_actions(app_handle: &tauri::AppHandle, task: &CustomTaskRule, reason: &str) {
    for exe in &task.executables {
        let exe_str = exe.trim().to_string();
        if !exe_str.is_empty() {
            std::thread::spawn(move || {
                #[cfg(target_os = "windows")]
                {
                    use std::os::windows::process::CommandExt;
                    // DETACHED_PROCESS: 脱离当前控制台
                    // CREATE_NO_WINDOW: 不创建新控制台窗口
                    const CREATE_NO_WINDOW: u32 = 0x08000000;
                    let (prog, args) = parse_command_line(&exe_str);
                    if !prog.is_empty() {
                        let _ = Command::new(&prog)
                            .args(&args)
                            .creation_flags(CREATE_NO_WINDOW)
                            .spawn();
                    }
                }
                #[cfg(not(target_os = "windows"))]
                {
                    let _ = Command::new("sh").args(["-c", &exe_str]).spawn();
                }
            });
        }
    }

    use tauri::Manager;
    if task.always_on_top {
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_always_on_top(true);
            let _ = window.set_focus();
        }
    }

    #[derive(Serialize, Clone)]
    struct TriggerPayload {
        task_id: String,
        task_name: String,
        trigger_reason: String,
        executables: Vec<String>,
        popup_messages: Vec<String>,
        always_on_top: bool,
    }

    let payload = TriggerPayload {
        task_id: task.id.clone(),
        task_name: task.name.clone(),
        trigger_reason: reason.to_string(),
        executables: task.executables.clone(),
        popup_messages: task.popup_messages.clone(),
        always_on_top: task.always_on_top,
    };

    let _ = app_handle.emit("custom_task_triggered", payload);

    let log_msg = format!("🚀 自主任务 [{}] 触发执行（{}），程序: {:?}", task.name, reason, task.executables);
    let _ = app_handle.emit("custom_task_log", serde_json::json!({
        "level": "success",
        "message": log_msg,
        "task_id": task.id,
        "task_name": task.name,
    }));
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

#[tauri::command]
fn update_date_group(
    state: tauri::State<'_, AppState>,
    id: String,
    name: String,
    description: Option<String>,
    dates: Vec<String>,
) -> Result<DateGroup, String> {
    if name.trim().is_empty() {
        return Err("日期时间组名称不能为空".into());
    }

    let mut groups = state.date_groups.lock().unwrap();
    if let Some(group) = groups.iter_mut().find(|g| g.id == id) {
        group.name = name.trim().to_string();
        group.description = description.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
        group.dates = dates.into_iter().filter(|s| !s.trim().is_empty()).collect();
        let cloned = group.clone();
        save_date_groups_to_disk(&groups);
        Ok(cloned)
    } else {
        Err("找不到指定的日期时间组".into())
    }
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

    let clean_group_ids: Vec<String> = date_group_ids
        .unwrap_or_default()
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    let clean_mode = if clean_group_ids.is_empty() {
        "NONE".to_string()
    } else {
        date_group_mode.unwrap_or_else(|| "NONE".into()).trim().to_uppercase()
    };

    let new_rule = TaskRule {
        id,
        task_name: task_name.trim().to_string(),
        target_time: clean_target_time,
        action: action.to_uppercase(),
        status: "PENDING".into(),
        log_message: None,
        created_at: now_str,
        date_group_ids: clean_group_ids,
        date_group_mode: clean_mode,
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

    let clean_enable_windows: Vec<TimeWindow> = enable_windows
        .into_iter()
        .map(|w| TimeWindow {
            start_time: w.start_time.map(|s| s.trim().replace('/', "-")),
            end_time: w.end_time.map(|s| s.trim().replace('/', "-")),
        })
        .collect();

    let clean_trigger_datetimes: Vec<String> = trigger_datetimes
        .into_iter()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.trim().replace('/', "-"))
        .collect();

    let clean_group_ids: Vec<String> = date_group_ids
        .unwrap_or_default()
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    let clean_mode = if clean_group_ids.is_empty() {
        "NONE".to_string()
    } else {
        date_group_mode.unwrap_or_else(|| "NONE".into()).trim().to_uppercase()
    };

    let rule = CustomTaskRule {
        id,
        name: name.trim().to_string(),
        is_enabled: true,
        enable_window_start: None,
        enable_window_end: None,
        enable_windows: clean_enable_windows,
        trigger_datetimes: clean_trigger_datetimes,
        executables: executables.into_iter().filter(|s| !s.trim().is_empty()).collect(),
        popup_messages: popup_messages.into_iter().filter(|s| !s.trim().is_empty()).collect(),
        always_on_top,
        triggered_history: Vec::new(),
        created_at: now_str,
        recurrence,
        date_group_ids: clean_group_ids,
        date_group_mode: clean_mode,
    };

    let mut tasks = state.custom_tasks.lock().unwrap();
    tasks.push(rule.clone());
    save_custom_tasks_to_disk(&tasks);

    Ok(rule)
}

#[tauri::command]
fn update_custom_task(
    state: tauri::State<'_, AppState>,
    id: String,
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

    let clean_enable_windows: Vec<TimeWindow> = enable_windows
        .into_iter()
        .map(|w| TimeWindow {
            start_time: w.start_time.map(|s| s.trim().replace('/', "-")),
            end_time: w.end_time.map(|s| s.trim().replace('/', "-")),
        })
        .collect();

    let clean_trigger_datetimes: Vec<String> = trigger_datetimes
        .into_iter()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.trim().replace('/', "-"))
        .collect();

    let clean_group_ids: Vec<String> = date_group_ids
        .unwrap_or_default()
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    let clean_mode = if clean_group_ids.is_empty() {
        "NONE".to_string()
    } else {
        date_group_mode.unwrap_or_else(|| "NONE".into()).trim().to_uppercase()
    };

    let mut tasks = state.custom_tasks.lock().unwrap();
    if let Some(task) = tasks.iter_mut().find(|t| t.id == id) {
        task.name = name.trim().to_string();
        task.enable_windows = clean_enable_windows;
        task.trigger_datetimes = clean_trigger_datetimes;
        task.executables = executables.into_iter().filter(|s| !s.trim().is_empty()).collect();
        task.popup_messages = popup_messages.into_iter().filter(|s| !s.trim().is_empty()).collect();
        task.always_on_top = always_on_top;
        task.recurrence = recurrence;
        task.date_group_ids = clean_group_ids;
        task.date_group_mode = clean_mode;
        
        let updated = task.clone();
        save_custom_tasks_to_disk(&tasks);
        Ok(updated)
    } else {
        Err("找不到指定自定义任务".into())
    }
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
        trigger_custom_task_actions(&app_handle, t, "用户界面手动即时测试");
        Ok("已成功手动即时触发该自定义任务！".to_string())
    } else {
        Err("找不到指定自定义任务".into())
    }
}

/// 弹出 Windows 文件选择对话框，让用户选择一个可执行程序，返回完整路径
#[tauri::command]
fn browse_executable() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        // 使用 PowerShell 弹出文件选择对话框
        let script = r#"
Add-Type -AssemblyName System.Windows.Forms
$dlg = New-Object System.Windows.Forms.OpenFileDialog
$dlg.Title = '选择可执行程序'
$dlg.Filter = '可执行文件 (*.exe)|*.exe|所有文件 (*.*)|*.*'
$dlg.FilterIndex = 1
$dlg.Multiselect = $false
if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    Write-Output $dlg.FileName
} else {
    Write-Output ''
}
"#;

        let output = Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-WindowStyle", "Hidden",
                "-Command", script,
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("启动 PowerShell 失败: {}", e))?;

        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(path)
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("仅支持 Windows 平台".into())
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
        let mut skipped_custom_logged: std::collections::HashSet<String> = std::collections::HashSet::new();

        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;

            let now = Local::now();
            let now_naive = now.naive_local();
            let now_date = now_naive.date();
            let _now_str = now.format("%Y-%m-%d %H:%M:%S").to_string();
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
                        let target_dt = match parse_flexible_datetime(&task.target_time) {
                            Some(dt) => dt,
                            None => continue,
                        };

                        let is_exclude = task.date_group_mode.trim().eq_ignore_ascii_case("EXCLUDE");
                        let is_in_group = if !task.date_group_ids.is_empty() {
                            is_date_in_groups(target_dt.date(), &date_groups, &task.date_group_ids)
                                || is_date_in_groups(now_date, &date_groups, &task.date_group_ids)
                        } else {
                            false
                        };

                        // A. 遇日期组排除/跳过（EXCLUDE）：到期直接标记为 SKIPPED
                        if is_exclude && is_in_group {
                            if now_naive >= target_dt {
                                task.status = "SKIPPED".into();
                                task.log_message = Some("落在关联日期组排除名单内，已跳过执行".into());
                                should_save_tasks = true;
                                tasks_to_notify = true;
                                continue;
                            }
                            continue;
                        }

                        // B. 到达任务自身设定的目标时间（是否执行、何时执行完全由任务自身控制）
                        if now_naive >= target_dt {
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
                    if !task.is_enabled {
                        continue;
                    }

                    // 有效时间区间校验
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
                                if let Some(start_dt) = parse_flexible_datetime(start_str) {
                                    if now_naive < start_dt {
                                        match_win = false;
                                    }
                                }
                            }
                            if let Some(end_str) = &win.end_time {
                                if let Some(end_dt) = parse_flexible_datetime(end_str) {
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

                    if !in_time_window {
                        continue;
                    }

                    let is_exclude = task.date_group_mode.trim().eq_ignore_ascii_case("EXCLUDE");
                    let is_force = task.date_group_mode.trim().eq_ignore_ascii_case("FORCE_TRIGGER");

                    // 从日期组仅读取设置的日期（判断今天是否在关联的日期组中）
                    let is_today_in_group = if !task.date_group_ids.is_empty() {
                        is_date_in_groups(now_date, &date_groups, &task.date_group_ids)
                    } else {
                        false
                    };

                    // 1. 任务线程控制：若任务设置了“跳过/排除”，且今天在日期组中，今日全天彻底跳过不执行
                    if is_exclude && is_today_in_group {
                        let log_key = format!("{}_{}", now_date_str, task.id);
                        if skipped_custom_logged.insert(log_key) {
                            let msg = format!("🚫 自主任务 [{}] 命中日期组排除规则，今日 ({}) 全天彻底跳过不执行", task.name, now_date_str);
                            let _ = app_handle.emit("custom_task_log", serde_json::json!({
                                "level": "warning",
                                "message": msg,
                                "task_id": task.id,
                                "task_name": task.name,
                            }));
                        }
                        continue; // 任务线程在此处直接跳过，本任务今日不执行任何动作
                    }

                    // 获取任务自身配置的执行时刻（由任务自身控制什么时候执行，绝不从日期组取时间）
                    let task_time = task.recurrence.as_ref().and_then(|r| {
                        if !r.time_of_day.is_empty() {
                            parse_flexible_time(&r.time_of_day)
                        } else {
                            None
                        }
                    }).unwrap_or_else(|| chrono::NaiveTime::from_hms_opt(9, 0, 0).unwrap());

                    // 2. 任务线程控制：若任务设置了“遇特例日期组生效/触发”
                    // 从日期组提取今日触发时刻（若日期组显式设定了具体时间则按该时间，未设时间则按任务自身配置时刻 task_time 触发）
                    let mut date_group_triggered_today = false;
                    if is_force && !task.date_group_ids.is_empty() {
                        let force_times = get_force_trigger_times(now_date, &date_groups, &task.date_group_ids, Some(task_time));
                        for ft in force_times {
                            let force_dt = chrono::NaiveDateTime::new(now_date, ft);
                            let time_key = ft.format("%H:%M:%S").to_string();
                            let trigger_key = format!("task_dategroup_{}_{}_{}", now_date_str, time_key, task.id);

                            if now_naive >= force_dt && now_naive.signed_duration_since(force_dt).num_seconds() <= 60 {
                                if !task.triggered_history.contains(&trigger_key) {
                                    task.triggered_history.push(trigger_key);
                                    date_group_triggered_today = true;
                                    should_save_custom = true;
                                    custom_updated = true;
                                    let reason = format!("命中特例生效日期组时刻 ({})", time_key);
                                    trigger_custom_task_actions(&app_handle, task, &reason);
                                }
                            }
                        }
                    }

                    // 3. 任务线程控制：单次指定不规则触发时刻（由任务自身 trigger_datetimes 字段控制）
                    for dt in &task.trigger_datetimes {
                        if let Some(target_dt) = parse_flexible_datetime(dt) {
                            // 若此时间点的日期落在排除组内，任务线程控制跳过
                            if is_exclude && !task.date_group_ids.is_empty() && is_date_in_groups(target_dt.date(), &date_groups, &task.date_group_ids) {
                                continue;
                            }

                            let standard_key = target_dt.format("%Y-%m-%d %H:%M:%S").to_string();
                            if now_naive >= target_dt && now_naive.signed_duration_since(target_dt).num_seconds() <= 60 {
                                if !task.triggered_history.contains(dt) && !task.triggered_history.contains(&standard_key) {
                                    task.triggered_history.push(dt.clone());
                                    if *dt != standard_key {
                                        task.triggered_history.push(standard_key);
                                    }
                                    should_save_custom = true;
                                    custom_updated = true;
                                    let reason = format!("到达任务自设的单次指定时刻 ({})", dt);
                                    trigger_custom_task_actions(&app_handle, task, &reason);
                                }
                            }
                        }
                    }

                    // 4. 任务线程控制：常规周期循环规则触发（每天/每周/工作日等，由任务自身控制）
                    if let Some(ref rule) = task.recurrence {
                        if rule.mode != "ONCE" && !date_group_triggered_today {
                            let time_str = if rule.time_of_day.len() == 5 {
                                format!("{}:00", rule.time_of_day)
                            } else if rule.time_of_day.is_empty() {
                                "09:00:00".to_string()
                            } else {
                                rule.time_of_day.clone()
                            };

                            let trigger_key = format!("recur_{}_{}_{}", now_date_str, time_str, task.id);

                            if !task.triggered_history.contains(&trigger_key) {
                                if let Some(rule_t) = parse_flexible_time(&time_str) {
                                    let rule_dt = chrono::NaiveDateTime::new(now_date, rule_t);
                                    if now_naive >= rule_dt && now_naive.signed_duration_since(rule_dt).num_seconds() <= 60 {
                                        if matches_recurrence_day(rule, now_date, &holiday_cal) {
                                            task.triggered_history.push(trigger_key);
                                            should_save_custom = true;
                                            custom_updated = true;
                                            let mode_desc = match rule.mode.as_str() {
                                                "DAILY" => "每日循环",
                                                "WEEKLY" => "每周循环",
                                                "MONTHLY" => "每月循环",
                                                "WORKDAY" => "法定工作日循环",
                                                "HOLIDAY" => "法定节假日循环",
                                                _ => "周期循环",
                                            };
                                            let reason = format!("{}到达任务自设时刻 ({})", mode_desc, time_str);
                                            trigger_custom_task_actions(&app_handle, task, &reason);
                                        }
                                    }
                                }
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
            update_custom_task,
            delete_custom_task,
            toggle_custom_task,
            execute_custom_task_now,
            get_holiday_calendar,
            fetch_and_update_holidays,
            save_holiday_calendar,
            get_date_groups,
            save_date_groups,
            add_date_group,
            update_date_group,
            delete_date_group,
            browse_executable
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

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{NaiveDate, NaiveTime};

    #[test]
    fn test_parse_flexible_date_and_time() {
        assert_eq!(parse_flexible_date("2026-10-01"), Some(NaiveDate::from_ymd_opt(2026, 10, 1).unwrap()));
        assert_eq!(parse_flexible_date("2026/10/01"), Some(NaiveDate::from_ymd_opt(2026, 10, 1).unwrap()));
        assert_eq!(parse_flexible_date("2026-9-6"), Some(NaiveDate::from_ymd_opt(2026, 9, 6).unwrap()));
        assert_eq!(parse_flexible_date("2026/9/6"), Some(NaiveDate::from_ymd_opt(2026, 9, 6).unwrap()));

        assert_eq!(parse_flexible_time("08:30:00"), Some(NaiveTime::from_hms_opt(8, 30, 0).unwrap()));
        assert_eq!(parse_flexible_time("08:30"), Some(NaiveTime::from_hms_opt(8, 30, 0).unwrap()));
        assert_eq!(parse_flexible_time("8:5"), Some(NaiveTime::from_hms_opt(8, 5, 0).unwrap()));
    }

    #[test]
    fn test_parse_date_group_item() {
        // Single date with time
        let item1 = parse_date_group_item("2026/10/01 14:30:00").unwrap();
        assert_eq!(
            item1,
            ParsedDateEntry::SingleDate {
                date: NaiveDate::from_ymd_opt(2026, 10, 1).unwrap(),
                time: Some(NaiveTime::from_hms_opt(14, 30, 0).unwrap()),
            }
        );

        // Single date with HH:mm
        let item2 = parse_date_group_item("2026-10-01 08:30").unwrap();
        assert_eq!(
            item2,
            ParsedDateEntry::SingleDate {
                date: NaiveDate::from_ymd_opt(2026, 10, 1).unwrap(),
                time: Some(NaiveTime::from_hms_opt(8, 30, 0).unwrap()),
            }
        );

        // Date only
        let item3 = parse_date_group_item("2026/10/01").unwrap();
        assert_eq!(
            item3,
            ParsedDateEntry::SingleDate {
                date: NaiveDate::from_ymd_opt(2026, 10, 1).unwrap(),
                time: None,
            }
        );

        // Date range
        let item4 = parse_date_group_item("2026/10/01 ~ 2026/10/07").unwrap();
        assert_eq!(
            item4,
            ParsedDateEntry::DateRange {
                start: NaiveDate::from_ymd_opt(2026, 10, 1).unwrap(),
                end: NaiveDate::from_ymd_opt(2026, 10, 7).unwrap(),
            }
        );
    }

    #[test]
    fn test_is_date_excluded_skips_whole_day_regardless_of_time() {
        let groups = vec![
            DateGroup {
                id: "g1".into(),
                name: "国庆封网".into(),
                description: None,
                dates: vec![
                    "2026/10/01 14:30:00".into(), // 带具体时间的条目
                    "2026/10/03 ~ 2026/10/05".into(), // 范围
                    "2026-10-07".into(), // 纯日期
                ],
                created_at: "".into(),
            },
        ];
        let target_ids = vec!["g1".into()];

        // 即使设置了 14:30:00，当天全天（任何时间）均属于排除日
        let oct_01 = NaiveDate::from_ymd_opt(2026, 10, 1).unwrap();
        assert!(is_date_excluded(oct_01, &groups, &target_ids));

        // 范围内的日期均排除
        let oct_03 = NaiveDate::from_ymd_opt(2026, 10, 3).unwrap();
        let oct_04 = NaiveDate::from_ymd_opt(2026, 10, 4).unwrap();
        let oct_05 = NaiveDate::from_ymd_opt(2026, 10, 5).unwrap();
        assert!(is_date_excluded(oct_03, &groups, &target_ids));
        assert!(is_date_excluded(oct_04, &groups, &target_ids));
        assert!(is_date_excluded(oct_05, &groups, &target_ids));

        // 单纯日期排除
        let oct_07 = NaiveDate::from_ymd_opt(2026, 10, 7).unwrap();
        assert!(is_date_excluded(oct_07, &groups, &target_ids));

        // 不在日期组内的日期正常放行
        let oct_02 = NaiveDate::from_ymd_opt(2026, 10, 2).unwrap();
        let oct_06 = NaiveDate::from_ymd_opt(2026, 10, 6).unwrap();
        let oct_08 = NaiveDate::from_ymd_opt(2026, 10, 8).unwrap();
        assert!(!is_date_excluded(oct_02, &groups, &target_ids));
        assert!(!is_date_excluded(oct_06, &groups, &target_ids));
        assert!(!is_date_excluded(oct_08, &groups, &target_ids));
    }

    #[test]
    fn test_get_force_trigger_times() {
        let groups = vec![
            DateGroup {
                id: "g1".into(),
                name: "公共日期时间组".into(),
                description: None,
                dates: vec![
                    "2026/10/01 14:20:00".into(), // 显式设定时间
                    "2026/10/02".into(),          // 仅设定日期
                ],
                created_at: "".into(),
            },
        ];
        let target_ids = vec!["g1".into()];

        let oct_01 = NaiveDate::from_ymd_opt(2026, 10, 1).unwrap();
        // 显式设定时间的条目，优先采用组内精确指定的时刻 14:20:00
        let times_oct_01 = get_force_trigger_times(oct_01, &groups, &target_ids, Some(NaiveTime::from_hms_opt(9, 30, 0).unwrap()));
        assert_eq!(times_oct_01, vec![
            NaiveTime::from_hms_opt(14, 20, 0).unwrap(),
        ]);

        let oct_02 = NaiveDate::from_ymd_opt(2026, 10, 2).unwrap();
        // 未显式设定时间的条目，回退采用任务自身设定的时刻 09:30:00
        let times_oct_02 = get_force_trigger_times(oct_02, &groups, &target_ids, Some(NaiveTime::from_hms_opt(9, 30, 0).unwrap()));
        assert_eq!(times_oct_02, vec![
            NaiveTime::from_hms_opt(9, 30, 0).unwrap(),
        ]);

        // 不在日期组内的日期（2026/10/03），不返回触发时刻
        let oct_03 = NaiveDate::from_ymd_opt(2026, 10, 3).unwrap();
        let times_oct_03 = get_force_trigger_times(oct_03, &groups, &target_ids, Some(NaiveTime::from_hms_opt(9, 30, 0).unwrap()));
        assert!(times_oct_03.is_empty());
    }

    #[test]
    fn test_flexible_parsing_edge_cases() {
        // T separator
        let dt1 = parse_date_group_item("2026-09-06T16:28:12").unwrap();
        assert_eq!(
            dt1,
            ParsedDateEntry::SingleDate {
                date: NaiveDate::from_ymd_opt(2026, 9, 6).unwrap(),
                time: Some(NaiveTime::from_hms_opt(16, 28, 12).unwrap()),
            }
        );

        // Dots and Chinese chars
        let dt2 = parse_date_group_item("2026.09.06 08:30").unwrap();
        assert_eq!(
            dt2,
            ParsedDateEntry::SingleDate {
                date: NaiveDate::from_ymd_opt(2026, 9, 6).unwrap(),
                time: Some(NaiveTime::from_hms_opt(8, 30, 0).unwrap()),
            }
        );

        // Ranges with 至 and 到 and " - "
        let r1 = parse_date_group_item("2026/09/01至2026/09/05").unwrap();
        assert_eq!(
            r1,
            ParsedDateEntry::DateRange {
                start: NaiveDate::from_ymd_opt(2026, 9, 1).unwrap(),
                end: NaiveDate::from_ymd_opt(2026, 9, 5).unwrap(),
            }
        );

        let r2 = parse_date_group_item("2026-09-01 - 2026-09-05").unwrap();
        assert_eq!(
            r2,
            ParsedDateEntry::DateRange {
                start: NaiveDate::from_ymd_opt(2026, 9, 1).unwrap(),
                end: NaiveDate::from_ymd_opt(2026, 9, 5).unwrap(),
            }
        );
    }

    #[test]
    fn test_user_exact_data_exclusion() {
        // 用户实际数据：日期组含 "2026/09/06 16:28:12"
        let groups = vec![
            DateGroup {
                id: "group_1788682961128".into(),
                name: "测试时间组".into(),
                description: None,
                dates: vec!["2026/09/06 16:28:12".into()],
                created_at: "2026-09-06 16:22:41".into(),
            },
            DateGroup {
                id: "group_1788683046966".into(),
                name: "测试跳过".into(),
                description: None,
                dates: vec!["2026/09/06 16:25:55".into()],
                created_at: "2026-09-06 16:24:06".into(),
            },
        ];

        let target_ids = vec!["group_1788682961128".into()];
        let today = NaiveDate::from_ymd_opt(2026, 9, 6).unwrap();

        // 验证 2026-09-06 任何时刻全天彻底判定为排除/跳过
        assert!(is_date_excluded(today, &groups, &target_ids));

        // 即使传入 ID 带有空格或大小写不同也能正常命中排除
        let target_ids_dirty = vec![" group_1788682961128 ".into()];
        assert!(is_date_excluded(today, &groups, &target_ids_dirty));

        // 次日 2026-09-07 正常放行，不受排除影响
        let tomorrow = NaiveDate::from_ymd_opt(2026, 9, 7).unwrap();
        assert!(!is_date_excluded(tomorrow, &groups, &target_ids));
    }
}


