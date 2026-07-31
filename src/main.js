// Helper to access Tauri global IPC
const getTauriCore = () => {
  if (window.__TAURI__ && window.__TAURI__.core) {
    return window.__TAURI__.core;
  }
  if (window.__TAURI_INTERNALS__) {
    return {
      invoke: window.__TAURI_INTERNALS__.invoke
    };
  }
  return null;
};

let tasks = [];
let customTasks = [];

// DOM Elements
const addRuleForm = document.getElementById("addRuleForm");
const taskNameInput = document.getElementById("taskName");
const targetDatetimeInput = document.getElementById("targetDatetime");
const taskListContainer = document.getElementById("taskList");
const taskCountBadge = document.getElementById("taskCount");
const liveClockEl = document.getElementById("liveClock");
const logTerminal = document.getElementById("logTerminal");
const syncHolidaysBtn = document.getElementById("syncHolidaysBtn");

// Custom Task Elements
const addCustomRuleForm = document.getElementById("addCustomRuleForm");
const customTaskNameInput = document.getElementById("customTaskName");
const enableWindowsContainer = document.getElementById("enableWindowsContainer");
const customAlwaysOnTopInput = document.getElementById("customAlwaysOnTop");
const triggerTimesContainer = document.getElementById("triggerTimesContainer");
const executablesContainer = document.getElementById("executablesContainer");
const popupsContainer = document.getElementById("popupsContainer");
const customTaskListContainer = document.getElementById("customTaskList");
const customTaskCountBadge = document.getElementById("customTaskCount");

// Custom Modal Confirm/Alert Elements
const modalOverlay = document.getElementById("customModalOverlay");
const modalIconBox = document.getElementById("modalIconBox");
const modalTitle = document.getElementById("modalTitle");
const modalBody = document.getElementById("modalBody");
const modalCancelBtn = document.getElementById("modalCancelBtn");
const modalConfirmBtn = document.getElementById("modalConfirmBtn");

// Top-Most Trigger Alert Overlay Elements
const topmostModalOverlay = document.getElementById("topmostModalOverlay");
const topmostTitle = document.getElementById("topmostTitle");
const topmostSubtitle = document.getElementById("topmostSubtitle");
const topmostPopupsList = document.getElementById("topmostPopupsList");
const topmostCloseBtn = document.getElementById("topmostCloseBtn");

// ----------------- 自定义模态弹窗系统 -----------------
function showCustomModal({ title = "提示", message = "", iconType = "warning", confirmText = "确定", cancelText = null, isDanger = false }) {
  return new Promise((resolve) => {
    modalTitle.textContent = title;
    modalBody.textContent = message;
    
    modalIconBox.className = `modal-icon-box ${iconType}`;
    modalIconBox.textContent = iconType === 'danger' ? '🗑️' : iconType === 'warning' ? '⚠️' : 'ℹ️';

    modalConfirmBtn.textContent = confirmText;
    modalConfirmBtn.className = `modal-btn ${isDanger ? 'danger' : 'primary'}`;

    if (cancelText) {
      modalCancelBtn.style.display = "block";
      modalCancelBtn.textContent = cancelText;
    } else {
      modalCancelBtn.style.display = "none";
    }

    modalOverlay.classList.add("active");

    const cleanup = () => {
      modalOverlay.classList.remove("active");
      modalConfirmBtn.removeEventListener("click", onConfirm);
      modalCancelBtn.removeEventListener("click", onCancel);
    };

    const onConfirm = () => {
      cleanup();
      resolve(true);
    };

    const onCancel = () => {
      cleanup();
      resolve(false);
    };

    modalConfirmBtn.addEventListener("click", onConfirm);
    modalCancelBtn.addEventListener("click", onCancel);
  });
}

function showCustomConfirm(message, title = "确认删除操作") {
  return showCustomModal({
    title,
    message,
    iconType: "danger",
    confirmText: "确认删除",
    cancelText: "取消",
    isDanger: true
  });
}

function showCustomAlert(message, title = "提示信息") {
  return showCustomModal({
    title,
    message,
    iconType: "warning",
    confirmText: "知道了",
    cancelText: null,
    isDanger: false
  });
}

// ----------------- 置顶触发弹窗系统 -----------------
function showTopmostTriggerAlert({ task_name, popup_messages, always_on_top }) {
  topmostTitle.textContent = `🔔 任务触发：${task_name}`;
  topmostSubtitle.textContent = `触发时间: ${new Date().toLocaleString()} ${always_on_top ? '(已强制置顶显示)' : ''}`;

  if (!popup_messages || popup_messages.length === 0) {
    topmostPopupsList.innerHTML = `<div class="popup-msg-item">任务排期时间已到，已自动触发执行命令！</div>`;
  } else {
    topmostPopupsList.innerHTML = popup_messages.map(msg => `
      <div class="popup-msg-item">💬 ${msg}</div>
    `).join("");
  }

  topmostModalOverlay.classList.add("active");
}

topmostCloseBtn.addEventListener("click", () => {
  topmostModalOverlay.classList.remove("active");
});

// ----------------- 日期与字符串工具 -----------------
function formatToDatetimeInputValue(dateObj) {
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  const hours = String(dateObj.getHours()).padStart(2, '0');
  const mins = String(dateObj.getMinutes()).padStart(2, '0');
  const secs = String(dateObj.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${mins}:${secs}`;
}

function formatDatetimeString(dateStr) {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const mins = String(date.getMinutes()).padStart(2, '0');
  const secs = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${mins}:${secs}`;
}

window.resetToNow = () => {
  const now = new Date();
  targetDatetimeInput.value = formatToDatetimeInputValue(now);
};

window.setPresetOffset = (minutes) => {
  let baseDate = new Date();
  if (targetDatetimeInput.value) {
    const currentVal = targetDatetimeInput.value.replace('T', ' ').replace(/-/g, '/');
    const parsed = new Date(currentVal);
    if (!isNaN(parsed.getTime())) {
      baseDate = parsed;
    }
  }

  baseDate.setMinutes(baseDate.getMinutes() + minutes);
  targetDatetimeInput.value = formatToDatetimeInputValue(baseDate);
};

// 日志输出
function appendLog(message, type = "info") {
  const entry = document.createElement("div");
  entry.className = `log-entry ${type}`;
  const nowStr = new Date().toLocaleTimeString();
  entry.textContent = `[${nowStr}] ${message}`;
  logTerminal.appendChild(entry);
  logTerminal.scrollTop = logTerminal.scrollHeight;
}

window.clearLogs = () => {
  logTerminal.innerHTML = `<div class="log-entry system">[已清空历史日志]</div>`;
};

// ----------------- 多行输入框增删 -----------------
window.removeMultiInputRow = (btn) => {
  const container = btn.closest(".multi-input-container");
  const rows = container.querySelectorAll(".multi-input-row, .multi-window-row");
  if (rows.length > 1) {
    btn.closest(".multi-input-row, .multi-window-row").remove();
  } else {
    container.querySelectorAll("input").forEach(input => input.value = "");
  }
};

window.addEnableWindowRow = () => {
  const row = document.createElement("div");
  row.className = "multi-window-row";
  row.innerHTML = `
    <div class="window-inputs-group">
      <input type="datetime-local" class="window-start-input" min="2000-01-01T00:00:00" max="2099-12-31T23:59:59" step="1" title="在此时间点后生效启用" placeholder="开启时间" />
      <span class="window-separator">⬇ 启用至 ⬇</span>
      <input type="datetime-local" class="window-end-input" min="2000-01-01T00:00:00" max="2099-12-31T23:59:59" step="1" title="在此时间点后失效禁用" placeholder="截止时间" />
    </div>
    <button type="button" class="remove-btn" onclick="removeMultiInputRow(this)">✕</button>
  `;
  enableWindowsContainer.appendChild(row);
};

window.addTriggerTimeRow = () => {
  const row = document.createElement("div");
  row.className = "multi-input-row";
  const defaultVal = formatToDatetimeInputValue(new Date(Date.now() + 5 * 60000));
  row.innerHTML = `
    <input type="datetime-local" class="trigger-time-input" value="${defaultVal}" min="2000-01-01T00:00:00" max="2099-12-31T23:59:59" step="1" />
    <button type="button" class="remove-btn" onclick="removeMultiInputRow(this)">✕</button>
  `;
  triggerTimesContainer.appendChild(row);
};

window.addExecutableRow = () => {
  const row = document.createElement("div");
  row.className = "multi-input-row";
  row.innerHTML = `
    <input type="text" class="executable-input" placeholder='例如: PotPlayerMini64.exe "D:\\视频.dpl" /autoplay /fullscreen' />
    <button type="button" class="remove-btn" onclick="removeMultiInputRow(this)">✕</button>
  `;
  executablesContainer.appendChild(row);
};

window.addPopupRow = () => {
  const row = document.createElement("div");
  row.className = "multi-input-row";
  row.innerHTML = `
    <input type="text" class="popup-input" placeholder="例如: 提醒内容：请及时处理相关业务" />
    <button type="button" class="remove-btn" onclick="removeMultiInputRow(this)">✕</button>
  `;
  popupsContainer.appendChild(row);
};

// ----------------- 自主任务循环周期 UI 交互 -----------------
window.initMonthdaysOptions = function() {
  const wrap = document.getElementById("customMonthdaysWrap");
  if (!wrap) return;
  let html = '';
  for (let i = 1; i <= 31; i++) {
    html += `<label class="chip-checkbox"><input type="checkbox" value="${i}" ${i === 1 ? 'checked' : ''} /><span>${i}日</span></label>`;
  }
  html += `<label class="chip-checkbox"><input type="checkbox" value="32" /><span>月末</span></label>`;
  wrap.innerHTML = html;
};

window.toggleRecurrenceUI = function(prefix = 'custom') {
  const selectedMode = document.querySelector(`input[name="${prefix}RecurrenceMode"]:checked`)?.value || "ONCE";

  ['ONCE', 'WEEKLY', 'MONTHLY'].forEach(mode => {
    const panel = document.getElementById(`${prefix}Panel${mode}`);
    if (panel) panel.classList.remove('active');
  });

  const activePanel = document.getElementById(`${prefix}Panel${selectedMode}`);
  if (activePanel) activePanel.classList.add('active');

  const timeGroup = document.getElementById(`${prefix}TimeOfDayGroup`);
  if (timeGroup) {
    timeGroup.style.display = selectedMode === "ONCE" ? "none" : "flex";
  }
};

window.selectWeekdays = function(prefix, type) {
  const checkboxes = document.querySelectorAll(`#${prefix}WeekdaysWrap input[type="checkbox"]`);
  checkboxes.forEach(cb => {
    const val = parseInt(cb.value);
    if (type === 'workday') cb.checked = val >= 1 && val <= 5;
    else if (type === 'weekend') cb.checked = val === 6 || val === 7;
    else if (type === 'all') cb.checked = true;
  });
};

window.selectMonthdays = function(prefix, type) {
  const checkboxes = document.querySelectorAll(`#${prefix}MonthdaysWrap input[type="checkbox"]`);
  checkboxes.forEach(cb => {
    const val = parseInt(cb.value);
    if (type === 'mid') cb.checked = val === 1 || val === 15;
    else if (type === 'last') cb.checked = val === 32;
  });
};

function getRecurrenceRuleFromUI(prefix = 'custom') {
  const mode = document.querySelector(`input[name="${prefix}RecurrenceMode"]:checked`)?.value || "ONCE";
  if (mode === "ONCE") return null;

  const timeOfDayInput = document.getElementById(`${prefix}TimeOfDay`);
  let time_of_day = timeOfDayInput ? timeOfDayInput.value : "09:00:00";
  if (time_of_day && time_of_day.length === 5) time_of_day += ":00";

  let days_of_week = [];
  if (mode === "WEEKLY") {
    const checkedWeek = document.querySelectorAll(`#${prefix}WeekdaysWrap input[type="checkbox"]:checked`);
    days_of_week = Array.from(checkedWeek).map(cb => parseInt(cb.value));
  }

  let days_of_month = [];
  if (mode === "MONTHLY") {
    const checkedMonth = document.querySelectorAll(`#${prefix}MonthdaysWrap input[type="checkbox"]:checked`);
    days_of_month = Array.from(checkedMonth).map(cb => parseInt(cb.value));
  }

  return {
    mode,
    days_of_week,
    days_of_month,
    time_of_day
  };
}

function formatRecurrenceText(rule) {
  if (!rule || rule.mode === "ONCE") return "";
  const timeStr = rule.time_of_day || "";

  if (rule.mode === "DAILY") {
    return `🔄 每天 ${timeStr}`;
  }
  if (rule.mode === "WORKDAY") {
    return `💼 法定工作日 ${timeStr} (避开节假日+含调休)`;
  }
  if (rule.mode === "HOLIDAY") {
    return `🎉 法定节假日 ${timeStr}`;
  }
  if (rule.mode === "WEEKLY") {
    const weekMap = { 1: "一", 2: "二", 3: "三", 4: "四", 5: "五", 6: "六", 7: "日" };
    const days = (rule.days_of_week || []).map(d => weekMap[d]).join(",");
    return `📅 每周(${days || '周一至周五'}) ${timeStr}`;
  }
  if (rule.mode === "MONTHLY") {
    const days = (rule.days_of_month || []).map(d => d === 32 ? "月末" : `${d}号`).join(",");
    return `📆 每月(${days || '1号'}) ${timeStr}`;
  }
  return `🔁 循环模式(${rule.mode}) ${timeStr}`;
}

// ----------------- 节假日同步逻辑 -----------------
async function fetchHolidayCalendar() {
  const core = getTauriCore();
  const statusEl = document.getElementById("holidayStatusText");
  if (!core) {
    if (statusEl) statusEl.textContent = "模拟模式 (标准双休)";
    return;
  }

  try {
    const cal = await core.invoke("get_holiday_calendar");
    if (cal && (cal.holidays.length > 0 || cal.workdays.length > 0)) {
      if (statusEl) statusEl.textContent = `已收录 ${cal.holidays.length}天放假 / ${cal.workdays.length}天调休`;
    } else {
      if (statusEl) statusEl.textContent = "未在线同步 (点击同步)";
      syncHolidays(true);
    }
  } catch (err) {
    if (statusEl) statusEl.textContent = "获取失败";
  }
}

async function syncHolidays(silent = false) {
  const core = getTauriCore();
  const statusEl = document.getElementById("holidayStatusText");
  if (!core) {
    if (!silent) showCustomAlert("浏览器模拟调试环境无法调用在线接口");
    return;
  }

  if (statusEl) statusEl.textContent = "正在在线同步...";
  try {
    const cal = await core.invoke("fetch_and_update_holidays", { year: null });
    if (statusEl) statusEl.textContent = `已最新同步 (${cal.holidays.length}天放假/${cal.workdays.length}天调休)`;
    appendLog(`节假日数据同步成功！已收录 ${cal.holidays.length} 个法定放假日及 ${cal.workdays.length} 个调休补班日。`, "success");
    if (!silent) showCustomAlert(`节假日日历同步成功！\n数据更新时间: ${cal.updated_at}\n已收录 ${cal.holidays.length} 天法定放假及 ${cal.workdays.length} 天调休补班。`);
  } catch (err) {
    if (statusEl) statusEl.textContent = "同步异常";
    appendLog(`同步节假日失败: ${err}`, "error");
    if (!silent) showCustomAlert(`同步节假日数据失败: ${err}\n系统将默认采用标准工作日逻辑。`);
  }
}

syncHolidaysBtn.addEventListener("click", () => syncHolidays(false));

// ----------------- Tab 1: 系统计划任务修改器逻辑 (原始单次时间) -----------------
async function fetchTasks() {
  const core = getTauriCore();
  if (!core) {
    appendLog("未识别到 Tauri 运行时（可能是纯浏览器调试模式）", "error");
    return;
  }
  try {
    tasks = await core.invoke("get_tasks");
    renderTaskList();
  } catch (err) {
    appendLog(`获取系统任务失败: ${err}`, "error");
  }
}

async function handleAddTask(e) {
  e.preventDefault();
  const taskName = taskNameInput.value.trim();
  const dtVal = targetDatetimeInput.value;

  if (!taskName) {
    showCustomAlert("请输入计划任务名称");
    return;
  }
  if (!dtVal) {
    showCustomAlert("请选择生效日期和精确时间");
    return;
  }

  const formattedTime = formatDatetimeString(dtVal);
  const selectedAction = document.querySelector('input[name="targetAction"]:checked').value;

  const core = getTauriCore();
  if (!core) return;

  try {
    const newTask = await core.invoke("add_task", {
      taskName: taskName,
      targetTime: formattedTime,
      action: selectedAction
    });

    appendLog(`已成功创建系统任务修改规则: [${taskName}] 将在 ${formattedTime} 修改为 ${selectedAction}`, "success");
    taskNameInput.value = "";
    fetchTasks();
  } catch (err) {
    appendLog(`添加系统规则失败: ${err}`, "error");
    showCustomAlert(`错误: ${err}`);
  }
}

window.deleteTaskItem = async (id) => {
  const confirmed = await showCustomConfirm("确定要删除该条调度规则吗？此操作无法撤销。");
  if (!confirmed) return;

  const core = getTauriCore();
  if (!core) return;

  try {
    await core.invoke("delete_task", { id });
    appendLog(`已删除系统调度规则 #${id}`, "info");
    fetchTasks();
  } catch (err) {
    appendLog(`删除失败: ${err}`, "error");
  }
};

window.testExecuteNow = async (id) => {
  const core = getTauriCore();
  if (!core) return;

  appendLog(`正在立即测试执行系统任务 #${id}...`, "info");
  try {
    const msg = await core.invoke("execute_task_now", { id });
    appendLog(`手动执行结果: ${msg}`, "success");
    fetchTasks();
  } catch (err) {
    appendLog(`手动执行失败: ${err}`, "error");
    fetchTasks();
  }
};

function calculateCountdown(targetTimeStr) {
  const target = new Date(targetTimeStr.replace(/-/g, "/")).getTime();
  const now = new Date().getTime();
  const diff = target - now;

  if (diff <= 0) return "即将执行/已到期";

  const secs = Math.floor((diff / 1000) % 60);
  const mins = Math.floor((diff / (1000 * 60)) % 60);
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  const pad = (n) => String(n).padStart(2, '0');

  if (days > 0) {
    return `${days}天 ${pad(hours)}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
}

function renderTaskList() {
  taskCountBadge.textContent = `${tasks.length} 项`;
  if (tasks.length === 0) {
    taskListContainer.innerHTML = `
      <div class="empty-state">
        <p>暂无排期的修改任务，请在左侧添加规则</p>
      </div>`;
    return;
  }

  taskListContainer.innerHTML = tasks.map(task => {
    const isPending = task.status === "PENDING";
    const statusText = task.status === "PENDING" ? "⏳ 等待到期" :
                       task.status === "SUCCESS" ? "✅ 执行成功" : "❌ 执行失败";

    return `
      <div class="task-item" data-id="${task.id}">
        <div class="task-meta">
          <div class="task-title-row">
            <span class="task-name">${task.task_name}</span>
            <span class="action-chip ${task.action}">${task.action === 'ENABLE' ? '启用' : '禁用'}</span>
            <span class="task-status-badge ${task.status}">${statusText}</span>
          </div>
          <div class="task-time-info">
            <span>目标时间: ${task.target_time}</span>
            ${isPending ? `<span class="countdown" data-target="${task.target_time}">⏳ 倒计时: ${calculateCountdown(task.target_time)}</span>` : ''}
          </div>
          ${task.log_message ? `<div style="font-size:11px; color:${task.status === 'SUCCESS' ? '#34d399' : '#fb7185'}; margin-top:2px;">信息: ${task.log_message}</div>` : ''}
        </div>
        <div class="task-actions">
          ${isPending ? `<button class="icon-btn" title="立即测试执行" onclick="testExecuteNow('${task.id}')">⚡</button>` : ''}
          <button class="icon-btn danger" title="删除规则" onclick="deleteTaskItem('${task.id}')">🗑️</button>
        </div>
      </div>
    `;
  }).join("");
}

// ----------------- Tab 2: 高级自主任务引擎逻辑 (包含循环周期与节假日) -----------------
async function fetchCustomTasks() {
  const core = getTauriCore();
  if (!core) return;

  try {
    customTasks = await core.invoke("get_custom_tasks");
    renderCustomTaskList();
  } catch (err) {
    appendLog(`获取自主任务失败: ${err}`, "error");
  }
}

async function handleAddCustomTask(e) {
  e.preventDefault();
  const name = customTaskNameInput.value.trim();
  if (!name) {
    showCustomAlert("请输入自主任务名称");
    return;
  }

  const recurrence = getRecurrenceRuleFromUI('custom');

  // 收集有效时间区间 (多个起点与终点)
  const windowRows = document.querySelectorAll("#tab-custom .multi-window-row");
  const enableWindows = Array.from(windowRows).map(row => {
    const startVal = row.querySelector(".window-start-input").value;
    const endVal = row.querySelector(".window-end-input").value;
    return {
      start_time: startVal ? formatDatetimeString(startVal) : null,
      end_time: endVal ? formatDatetimeString(endVal) : null
    };
  }).filter(w => w.start_time || w.end_time);

  // 收集不规则时间点
  const timeInputs = document.querySelectorAll("#tab-custom .trigger-time-input");
  const triggerTimes = Array.from(timeInputs)
    .map(input => formatDatetimeString(input.value))
    .filter(val => val.length > 0);

  if (!recurrence && triggerTimes.length === 0) {
    showCustomAlert("请设置循环模式或至少设置一个不规则触发时间点");
    return;
  }

  // 收集可执行程序路径
  const exeInputs = document.querySelectorAll("#tab-custom .executable-input");
  const executables = Array.from(exeInputs)
    .map(input => input.value.trim())
    .filter(val => val.length > 0);

  // 收集弹窗显示内容
  const popupInputs = document.querySelectorAll("#tab-custom .popup-input");
  const popupMessages = Array.from(popupInputs)
    .map(input => input.value.trim())
    .filter(val => val.length > 0);

  const alwaysOnTop = customAlwaysOnTopInput.checked;

  const core = getTauriCore();
  if (!core) return;

  try {
    await core.invoke("add_custom_task", {
      name,
      enableWindows,
      triggerDatetimes: triggerTimes,
      executables,
      popupMessages,
      alwaysOnTop,
      recurrence
    });

    const recurLabel = formatRecurrenceText(recurrence);
    appendLog(`已保存自主高级任务规则: [${name}] ${recurLabel ? `(${recurLabel})` : ''}`, "success");
    customTaskNameInput.value = "";
    fetchCustomTasks();
  } catch (err) {
    appendLog(`保存自主高级任务失败: ${err}`, "error");
    showCustomAlert(`保存失败: ${err}`);
  }
}

window.toggleCustomTaskStatus = async (id, isEnabled) => {
  const core = getTauriCore();
  if (!core) return;
  try {
    await core.invoke("toggle_custom_task", { id, isEnabled });
    appendLog(`任务 #${id} 已切换为: ${isEnabled ? '启用' : '禁用'}`, "info");
    fetchCustomTasks();
  } catch (err) {
    appendLog(`切换状态失败: ${err}`, "error");
  }
};

window.deleteCustomTaskItem = async (id) => {
  const confirmed = await showCustomConfirm("确定要删除该条自主高级任务规则吗？此操作无法撤销。");
  if (!confirmed) return;

  const core = getTauriCore();
  if (!core) return;

  try {
    await core.invoke("delete_custom_task", { id });
    appendLog(`已删除自主高级任务 #${id}`, "info");
    fetchCustomTasks();
  } catch (err) {
    appendLog(`删除自主任务失败: ${err}`, "error");
  }
};

window.testExecuteCustomTaskNow = async (id) => {
  const core = getTauriCore();
  if (!core) return;

  appendLog(`正在即时测试触发自主高级任务 #${id}...`, "info");
  try {
    const res = await core.invoke("execute_custom_task_now", { id });
    appendLog(res, "success");
    fetchCustomTasks();
  } catch (err) {
    appendLog(`触发测试失败: ${err}`, "error");
  }
};

function renderCustomTaskList() {
  customTaskCountBadge.textContent = `${customTasks.length} 项`;
  if (customTasks.length === 0) {
    customTaskListContainer.innerHTML = `
      <div class="empty-state">
        <p>暂无自主高级任务，请在左侧配置并保存规则</p>
      </div>`;
    return;
  }

  customTaskListContainer.innerHTML = customTasks.map(task => {
    const windows = task.enable_windows || [];
    let timeWindowStr = "有效时间区间: 长期保持有效";
    if (windows.length > 0) {
      timeWindowStr = "有效时间区间: " + windows.map(w => `[${w.start_time || '无起点'} 至 ${w.end_time || '无终点'}]`).join("、");
    } else if (task.enable_window_start || task.enable_window_end) {
      timeWindowStr = `有效时间区间: [${task.enable_window_start || '无起点'} 至 ${task.enable_window_end || '无终点'}]`;
    }

    const recurText = formatRecurrenceText(task.recurrence);

    return `
      <div class="task-item" data-id="${task.id}">
        <div class="task-meta">
          <div class="task-title-row">
            <span class="task-name">${task.name}</span>
            <label class="switch-label" title="切换启用/禁用">
              <input type="checkbox" ${task.is_enabled ? 'checked' : ''} onchange="toggleCustomTaskStatus('${task.id}', this.checked)">
              <span class="slider"></span>
            </label>
            ${task.always_on_top ? '<span class="action-chip ENABLE">📌 置顶弹窗</span>' : ''}
          </div>

          <div style="font-size:11px; color:#71717a; word-break:break-all;">${timeWindowStr}</div>

          <div class="custom-tags-group">
            ${recurText ? `<span class="custom-tag time">${recurText}</span>` : ''}
            ${task.trigger_datetimes.map(t => `<span class="custom-tag time">⏰ ${t}</span>`).join("")}
            ${task.executables.map(e => `<span class="custom-tag exe">🚀 ${e}</span>`).join("")}
            ${task.popup_messages.map(m => `<span class="custom-tag msg">💬 ${m}</span>`).join("")}
          </div>
        </div>

        <div class="task-actions">
          <button class="icon-btn" title="即时测试触发" onclick="testExecuteCustomTaskNow('${task.id}')">⚡</button>
          <button class="icon-btn danger" title="删除规则" onclick="deleteCustomTaskItem('${task.id}')">🗑️</button>
        </div>
      </div>
    `;
  }).join("");
}

// ----------------- 时钟与初始化 -----------------
function startClocks() {
  setInterval(() => {
    const now = new Date();
    liveClockEl.textContent = now.toLocaleTimeString('zh-CN', { hour12: false });

    document.querySelectorAll(".countdown").forEach(el => {
      const targetStr = el.getAttribute("data-target");
      if (targetStr) {
        el.textContent = `⏳ 倒计时: ${calculateCountdown(targetStr)}`;
      }
    });
  }, 1000);
}

function initDefaultTime() {
  setPresetOffset(5);
}

// 事件监听与 Tab 切换
window.addEventListener("DOMContentLoaded", () => {
  initMonthdaysOptions();

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const targetId = btn.getAttribute('data-tab');
      document.getElementById(targetId).classList.add('active');
    });
  });

  addRuleForm.addEventListener("submit", handleAddTask);
  addCustomRuleForm.addEventListener("submit", handleAddCustomTask);

  initDefaultTime();
  startClocks();

  setTimeout(() => {
    fetchHolidayCalendar();
    fetchTasks();
    fetchCustomTasks();
  }, 300);

  if (window.__TAURI__ && window.__TAURI__.event) {
    window.__TAURI__.event.listen("tasks_updated", () => {
      appendLog("后台监视器完成了一次系统任务到期调度！", "info");
      fetchTasks();
    });

    window.__TAURI__.event.listen("custom_tasks_updated", () => {
      appendLog("后台监视器更新了自主高级任务记录！", "info");
      fetchCustomTasks();
    });

    window.__TAURI__.event.listen("custom_task_triggered", (event) => {
      const payload = event.payload;
      appendLog(`自主高级任务到期触发: [${payload.task_name}]`, "success");
      showTopmostTriggerAlert(payload);
      fetchCustomTasks();
    });
  }
});
