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

import { initI18n, toggleLanguage } from './i18n.js';

let tasks = [];
let customTasks = [];
let editingCustomTaskId = null;
let currentHolidayCal = { holidays: [], workdays: [], updated_at: "" };
let editingHolidayCal = { holidays: [], workdays: [], updated_at: "" };
let activeHolidayTab = "holidays";

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

// Holiday Modal Elements
const holidayModalOverlay = document.getElementById("holidayModalOverlay");
const holidaysCountEl = document.getElementById("holidaysCount");
const workdaysCountEl = document.getElementById("workdaysCount");
const holidayDatesContainer = document.getElementById("holidayDatesContainer");
const newHolidayDateInput = document.getElementById("newHolidayDateInput");
const tabHolidaysBtn = document.getElementById("tabHolidaysBtn");
const tabWorkdaysBtn = document.getElementById("tabWorkdaysBtn");

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

function getFormattedNowDateTime() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const mins = String(now.getMinutes()).padStart(2, '0');
  const secs = String(now.getSeconds()).padStart(2, '0');
  return `${year}/${month}/${day} ${hours}:${mins}:${secs}`;
}

function getFormattedNowTime() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const mins = String(now.getMinutes()).padStart(2, '0');
  const secs = String(now.getSeconds()).padStart(2, '0');
  return `${hours}:${mins}:${secs}`;
}

// ----------------- 置顶触发弹窗系统 -----------------
function showTopmostTriggerAlert({ task_name, popup_messages, always_on_top }) {
  topmostTitle.textContent = `🔔 任务触发：${task_name}`;
  topmostSubtitle.textContent = `触发时间: ${getFormattedNowDateTime()} ${always_on_top ? '(已强制置顶显示)' : ''}`;

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

// ----------------- 高级零依赖 Custom DateTime Picker 组件 -----------------
class CustomDateTimePicker {
  constructor(containerWrapper, options = {}) {
    this.wrapper = containerWrapper;
    this.input = this.wrapper.querySelector("input");
    if (!this.input) return;

    this.dateOnly = options.dateOnly || false;
    this.placeholder = options.placeholder || (this.dateOnly ? "YYYY/MM/DD" : "YYYY/MM/DD --:--:--");

    this.input.classList.add("custom-datetime-input");
    this.input.placeholder = this.placeholder;

    // Create right-side icon
    let iconBtn = this.wrapper.querySelector(".custom-datetime-icon");
    if (!iconBtn) {
      iconBtn = document.createElement("button");
      iconBtn.type = "button";
      iconBtn.className = "custom-datetime-icon";
      iconBtn.innerHTML = "📅";
      iconBtn.title = "点击选择日期与时间";
      this.wrapper.appendChild(iconBtn);
    }
    this.iconBtn = iconBtn;

    // Create dropdown panel
    let panel = this.wrapper.querySelector(".datetime-picker-panel");
    if (!panel) {
      panel = document.createElement("div");
      panel.className = "datetime-picker-panel";
      this.wrapper.appendChild(panel);
    }
    this.panel = panel;

    const initialDate = this.parseInputValue() || new Date();
    this.viewYear = initialDate.getFullYear();
    this.viewMonth = initialDate.getMonth();
    this.selectedYear = initialDate.getFullYear();
    this.selectedMonth = initialDate.getMonth();
    this.selectedDay = initialDate.getDate();

    this.hours = initialDate.getHours();
    this.minutes = initialDate.getMinutes();
    this.seconds = initialDate.getSeconds();

    this.bindEvents();
  }

  parseInputValue() {
    if (!this.input || !this.input.value) return null;
    const val = this.input.value.trim().replace(/\//g, "-");
    const d = new Date(val.includes("T") ? val : val.replace(" ", "T"));
    return isNaN(d.getTime()) ? null : d;
  }

  bindEvents() {
    this.input.addEventListener("click", (e) => {
      e.stopPropagation();
      this.open();
    });

    this.iconBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggle();
    });

    document.addEventListener("click", (e) => {
      if (!this.wrapper.contains(e.target)) {
        this.close();
      }
    });

    this.input.addEventListener("input", (e) => {
      if (e.inputType && e.inputType.startsWith("delete")) return;
      const formatted = this.formatDigitsProgressively(this.input.value);
      if (formatted) {
        this.input.value = formatted;
      }
    });

    this.input.addEventListener("blur", () => {
      if (this.input.value) {
        const raw = this.input.value.replace(/\D/g, "");
        if (raw.length === 8 && !this.dateOnly) {
          const y = raw.substring(0, 4);
          const m = raw.substring(4, 6);
          const d = raw.substring(6, 8);
          this.input.value = `${y}/${m}/${d} 09:00:00`;
        } else {
          this.input.value = this.formatDigitsProgressively(this.input.value);
        }
      }
    });
  }

  formatDigitsProgressively(val) {
    if (!val) return "";
    const raw = val.replace(/\D/g, "");
    if (raw.length === 0) return "";

    let res = "";

    // 1. 年份 (1..4 位)
    if (raw.length <= 4) {
      return raw;
    }
    const year = raw.substring(0, 4);
    res += year + "/";

    let remaining = raw.substring(4);

    // 2. 月份 (01..12)：首位 > 1 自动补 0 (如 5 -> 05)
    let month = "";
    const m1 = remaining.charAt(0);
    if (m1 > '1') {
      month = "0" + m1;
      remaining = remaining.substring(1);
    } else if (remaining.length >= 2) {
      const mNum = parseInt(remaining.substring(0, 2), 10);
      if (mNum === 0) month = "01";
      else if (mNum > 12) month = "12";
      else month = String(mNum).padStart(2, '0');
      remaining = remaining.substring(2);
    } else {
      return res + remaining;
    }
    res += month + "/";

    if (remaining.length === 0) return res;

    // 3. 日期 (01..31)：首位 > 3 自动补 0 (如 6 -> 06)
    let day = "";
    const d1 = remaining.charAt(0);
    if (d1 > '3') {
      day = "0" + d1;
      remaining = remaining.substring(1);
    } else if (remaining.length >= 2) {
      const dNum = parseInt(remaining.substring(0, 2), 10);
      if (dNum === 0) day = "01";
      else if (dNum > 31) day = "31";
      else day = String(dNum).padStart(2, '0');
      remaining = remaining.substring(2);
    } else {
      return res + remaining;
    }
    res += day;

    if (this.dateOnly || remaining.length === 0) return res;

    res += " ";

    // 4. 小时 (00..23)：首位 > 2 自动补 0 (如 8 -> 08)
    let hour = "";
    const h1 = remaining.charAt(0);
    if (h1 > '2') {
      hour = "0" + h1;
      remaining = remaining.substring(1);
    } else if (remaining.length >= 2) {
      const hNum = parseInt(remaining.substring(0, 2), 10);
      if (hNum > 23) hour = "23";
      else hour = String(hNum).padStart(2, '0');
      remaining = remaining.substring(2);
    } else {
      return res + remaining;
    }
    res += hour + ":";

    if (remaining.length === 0) return res;

    // 5. 分钟 (00..59)：首位 > 5 自动补 0
    let min = "";
    const min1 = remaining.charAt(0);
    if (min1 > '5') {
      min = "0" + min1;
      remaining = remaining.substring(1);
    } else if (remaining.length >= 2) {
      const minNum = parseInt(remaining.substring(0, 2), 10);
      if (minNum > 59) min = "59";
      else min = String(minNum).padStart(2, '0');
      remaining = remaining.substring(2);
    } else {
      return res + remaining;
    }
    res += min + ":";

    if (remaining.length === 0) return res;

    // 6. 秒钟 (00..59)：首位 > 5 自动补 0
    let sec = "";
    const sec1 = remaining.charAt(0);
    if (sec1 > '5') {
      sec = "0" + sec1;
      remaining = remaining.substring(1);
    } else if (remaining.length >= 2) {
      const secNum = parseInt(remaining.substring(0, 2), 10);
      if (secNum > 59) sec = "59";
      else sec = String(secNum).padStart(2, '0');
      remaining = remaining.substring(2);
    } else {
      return res + remaining;
    }
    res += sec;

    return res;
  }

  formatRawDigits(val) {
    return this.formatDigitsProgressively(val);
  }

  toggle() {
    if (this.panel.classList.contains("active")) this.close();
    else this.open();
  }

  open() {
    document.querySelectorAll(".datetime-picker-panel.active").forEach(p => {
      if (p !== this.panel) p.classList.remove("active");
    });

    const curr = this.parseInputValue() || new Date();
    this.viewYear = curr.getFullYear();
    this.viewMonth = curr.getMonth();
    this.selectedYear = curr.getFullYear();
    this.selectedMonth = curr.getMonth();
    this.selectedDay = curr.getDate();
    this.hours = curr.getHours();
    this.minutes = curr.getMinutes();
    this.seconds = curr.getSeconds();

    this.renderPanel();
    this.panel.classList.add("active");
  }

  close() {
    this.panel.classList.remove("active");
  }

  renderPanel() {
    const monthNames = ["01月", "02月", "03月", "04月", "05月", "06月", "07月", "08月", "09月", "10月", "11月", "12月"];
    
    const firstDayIndex = new Date(this.viewYear, this.viewMonth, 1).getDay();
    const daysInMonth = new Date(this.viewYear, this.viewMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(this.viewYear, this.viewMonth, 0).getDate();

    let gridHtml = `
      <div class="picker-week-day">日</div>
      <div class="picker-week-day">一</div>
      <div class="picker-week-day">二</div>
      <div class="picker-week-day">三</div>
      <div class="picker-week-day">四</div>
      <div class="picker-week-day">五</div>
      <div class="picker-week-day">六</div>
    `;

    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const prevD = daysInPrevMonth - i;
      gridHtml += `<div class="picker-day-cell other-month">${prevD}</div>`;
    }

    const today = new Date();
    for (let d = 1; d <= daysInMonth; d++) {
      const isToday = (today.getFullYear() === this.viewYear && today.getMonth() === this.viewMonth && today.getDate() === d);
      const isSelected = (this.selectedYear === this.viewYear && this.selectedMonth === this.viewMonth && this.selectedDay === d);
      
      let classes = "picker-day-cell";
      if (isToday) classes += " today";
      if (isSelected) classes += " selected";

      gridHtml += `<div class="${classes}" data-day="${d}">${d}</div>`;
    }

    const pad = (n) => String(n).padStart(2, '0');

    this.panel.innerHTML = `
      <div class="picker-header">
        <button type="button" class="picker-nav-btn prev-month">◀</button>
        <span class="picker-header-title">${this.viewYear}年 ${monthNames[this.viewMonth]}</span>
        <button type="button" class="picker-nav-btn next-month">▶</button>
      </div>

      <div class="picker-calendar-grid">
        ${gridHtml}
      </div>

      ${!this.dateOnly ? `
        <div class="picker-time-bar">
          <span style="font-size:11px; color:#a1a1aa; font-weight:500;">时刻 (HH:mm:ss):</span>
          <div class="picker-time-inputs">
            <input type="text" maxlength="2" class="picker-time-num hour-num" value="${pad(this.hours)}" /> :
            <input type="text" maxlength="2" class="picker-time-num min-num" value="${pad(this.minutes)}" /> :
            <input type="text" maxlength="2" class="picker-time-num sec-num" value="${pad(this.seconds)}" />
          </div>
        </div>
      ` : ''}

      <div class="picker-footer">
        <button type="button" class="picker-btn-now">设为此刻</button>
        <button type="button" class="picker-btn-confirm">确认选择</button>
      </div>
    `;

    this.panel.querySelector(".prev-month").onclick = (e) => {
      e.stopPropagation();
      this.viewMonth--;
      if (this.viewMonth < 0) {
        this.viewMonth = 11;
        this.viewYear--;
      }
      this.renderPanel();
    };

    this.panel.querySelector(".next-month").onclick = (e) => {
      e.stopPropagation();
      this.viewMonth++;
      if (this.viewMonth > 11) {
        this.viewMonth = 0;
        this.viewYear++;
      }
      this.renderPanel();
    };

    this.panel.querySelectorAll(".picker-day-cell:not(.other-month)").forEach(cell => {
      cell.onclick = (e) => {
        e.stopPropagation();
        this.selectedYear = this.viewYear;
        this.selectedMonth = this.viewMonth;
        this.selectedDay = parseInt(cell.getAttribute("data-day"));
        this.renderPanel();
      };
    });

    if (!this.dateOnly) {
      const hInput = this.panel.querySelector(".hour-num");
      const mInput = this.panel.querySelector(".min-num");
      const sInput = this.panel.querySelector(".sec-num");

      hInput.onchange = () => { this.hours = Math.min(23, Math.max(0, parseInt(hInput.value || "0"))); };
      mInput.onchange = () => { this.minutes = Math.min(59, Math.max(0, parseInt(mInput.value || "0"))); };
      sInput.onchange = () => { this.seconds = Math.min(59, Math.max(0, parseInt(sInput.value || "0"))); };
    }

    this.panel.querySelector(".picker-btn-now").onclick = (e) => {
      e.stopPropagation();
      const now = new Date();
      this.viewYear = now.getFullYear();
      this.viewMonth = now.getMonth();
      this.selectedYear = now.getFullYear();
      this.selectedMonth = now.getMonth();
      this.selectedDay = now.getDate();
      this.hours = now.getHours();
      this.minutes = now.getMinutes();
      this.seconds = now.getSeconds();
      this.applySelection();
      this.close();
    };

    this.panel.querySelector(".picker-btn-confirm").onclick = (e) => {
      e.stopPropagation();
      this.applySelection();
      this.close();
    };
  }

  applySelection() {
    const pad = (n) => String(n).padStart(2, '0');
    const y = this.selectedYear;
    const m = pad(this.selectedMonth + 1);
    const d = pad(this.selectedDay);

    if (this.dateOnly) {
      this.input.value = `${y}/${m}/${d}`;
    } else {
      const hh = pad(this.hours);
      const mm = pad(this.minutes);
      const ss = pad(this.seconds);
      this.input.value = `${y}/${m}/${d} ${hh}:${mm}:${ss}`;
    }
  }
}

window.initCustomDatePickers = function(container = document) {
  container.querySelectorAll(".custom-datetime-wrapper").forEach(wrapper => {
    if (wrapper.dataset.pickerInitialized) return;
    wrapper.dataset.pickerInitialized = "true";
    const input = wrapper.querySelector("input");
    const isDateOnly = input && (input.id === "newHolidayDateInput");
    new CustomDateTimePicker(wrapper, { dateOnly: isDateOnly });
  });
};

// ----------------- 日期与字符串工具 -----------------
function parseCustomDate(str) {
  if (!str) return null;
  if (str instanceof Date) return isNaN(str.getTime()) ? null : str;
  if (typeof str !== "string") str = String(str);
  const nums = str.match(/\d+/g);
  if (!nums || nums.length < 3) return null;
  const year = parseInt(nums[0], 10);
  const month = parseInt(nums[1], 10) - 1;
  const day = parseInt(nums[2], 10);
  const hour = nums.length > 3 ? parseInt(nums[3], 10) : 0;
  const min = nums.length > 4 ? parseInt(nums[4], 10) : 0;
  const sec = nums.length > 5 ? parseInt(nums[5], 10) : 0;

  const d = new Date(year, month, day, hour, min, sec);
  return isNaN(d.getTime()) ? null : d;
}

function formatToDatetimeInputValue(dateObj) {
  if (!dateObj || !(dateObj instanceof Date) || isNaN(dateObj.getTime())) return "";
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  const hours = String(dateObj.getHours()).padStart(2, '0');
  const mins = String(dateObj.getMinutes()).padStart(2, '0');
  const secs = String(dateObj.getSeconds()).padStart(2, '0');
  return `${year}/${month}/${day} ${hours}:${mins}:${secs}`;
}

function formatDatetimeString(dateStr) {
  if (!dateStr) return "";
  let str = "";
  if (dateStr instanceof Date) {
    str = formatToDatetimeInputValue(dateStr);
  } else {
    const date = parseCustomDate(dateStr);
    if (!date) str = String(dateStr);
    else str = formatToDatetimeInputValue(date);
  }
  return str.replace(/\//g, "-");
}

window.resetToNow = () => {
  const now = new Date();
  targetDatetimeInput.value = formatToDatetimeInputValue(now);
};

window.setPresetOffset = (minutes) => {
  let baseDate = new Date();
  if (targetDatetimeInput.value) {
    const parsed = parseCustomDate(targetDatetimeInput.value);
    if (parsed) {
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
  const nowStr = getFormattedNowTime();
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
      <div class="custom-datetime-wrapper">
        <input type="text" class="window-start-input" title="在此时间点后生效启用" placeholder="YYYY/MM/DD --:--:--" />
      </div>
      <span class="window-separator">⬇ 启用至 ⬇</span>
      <div class="custom-datetime-wrapper">
        <input type="text" class="window-end-input" title="在此时间点后失效禁用" placeholder="YYYY/MM/DD --:--:--" />
      </div>
    </div>
    <button type="button" class="remove-btn" onclick="removeMultiInputRow(this)">✕</button>
  `;
  enableWindowsContainer.appendChild(row);
  initCustomDatePickers(row);
};

window.addTriggerTimeRow = () => {
  const row = document.createElement("div");
  row.className = "multi-input-row";
  row.innerHTML = `
    <div class="custom-datetime-wrapper">
      <input type="text" class="trigger-time-input" placeholder="YYYY/MM/DD --:--:--" />
    </div>
    <button type="button" class="remove-btn" onclick="removeMultiInputRow(this)">✕</button>
  `;
  triggerTimesContainer.appendChild(row);
  initCustomDatePickers(row);
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

// ----------------- 节假日同步与管理面板逻辑 -----------------
async function fetchHolidayCalendar() {
  const core = getTauriCore();
  const statusEl = document.getElementById("holidayStatusText");
  if (!core) {
    if (statusEl) statusEl.textContent = "模拟模式 (标准双休)";
    return;
  }

  try {
    const cal = await core.invoke("get_holiday_calendar");
    if (cal) {
      currentHolidayCal = cal;
      updateHolidayUI();
    }
  } catch (err) {
    if (statusEl) statusEl.textContent = "获取失败";
  }
}

function updateHolidayUI() {
  const statusEl = document.getElementById("holidayStatusText");
  const hCount = currentHolidayCal.holidays ? currentHolidayCal.holidays.length : 0;
  const wCount = currentHolidayCal.workdays ? currentHolidayCal.workdays.length : 0;

  if (statusEl) {
    if (hCount > 0 || wCount > 0) {
      statusEl.textContent = `(${hCount}天放假/${wCount}天调休)`;
    } else {
      statusEl.textContent = "(点击配置)";
    }
  }
}

function renderHolidayModalUI() {
  const hCount = editingHolidayCal.holidays ? editingHolidayCal.holidays.length : 0;
  const wCount = editingHolidayCal.workdays ? editingHolidayCal.workdays.length : 0;

  if (holidaysCountEl) holidaysCountEl.textContent = hCount;
  if (workdaysCountEl) workdaysCountEl.textContent = wCount;

  renderHolidayDatesList();
}

function renderHolidayDatesList() {
  if (!holidayDatesContainer) return;
  const list = activeHolidayTab === "holidays" ? (editingHolidayCal.holidays || []) : (editingHolidayCal.workdays || []);
  const chipClass = activeHolidayTab === "holidays" ? "holiday" : "workday";

  if (list.length === 0) {
    holidayDatesContainer.innerHTML = `<div style="font-size:12px; color:#71717a; padding:10px; width:100%; text-align:center;">暂无记录的${activeHolidayTab === "holidays" ? '放假' : '调休'}日期 (默认为空)</div>`;
    return;
  }

  holidayDatesContainer.innerHTML = list.map(d => `
    <div class="holiday-date-chip ${chipClass}">
      <span>📅 ${d}</span>
      <span class="remove-chip-btn" title="删除该日期" onclick="removeHolidayDate('${activeHolidayTab}', '${d}')">✕</span>
    </div>
  `).join("");
}

window.openHolidayModal = function() {
  fetchHolidayCalendar();
  editingHolidayCal = JSON.parse(JSON.stringify(currentHolidayCal));
  renderHolidayModalUI();
  if (holidayModalOverlay) holidayModalOverlay.classList.add("active");
};

window.closeHolidayModal = async function(shouldSave = false) {
  if (shouldSave) {
    currentHolidayCal = JSON.parse(JSON.stringify(editingHolidayCal));
    updateHolidayUI();
    const core = getTauriCore();
    if (core) {
      try {
        await core.invoke("save_holiday_calendar", { calendar: currentHolidayCal });
        appendLog("已成功应用并保存本地节假日与调休日历！", "success");
        renderCustomTaskList();
      } catch (err) {
        appendLog(`保存日历失败: ${err}`, "error");
      }
    }
  }
  if (holidayModalOverlay) holidayModalOverlay.classList.remove("active");
};

window.switchHolidayTab = function(tabType) {
  activeHolidayTab = tabType;
  if (tabType === 'holidays') {
    tabHolidaysBtn.classList.add('active');
    tabWorkdaysBtn.classList.remove('active');
  } else {
    tabWorkdaysBtn.classList.add('active');
    tabHolidaysBtn.classList.remove('active');
  }
  renderHolidayDatesList();
};

window.addCustomHolidayDate = function() {
  const formattedDate = newHolidayDateInput.value ? newHolidayDateInput.value.trim().replace(/\//g, "-") : "";
  if (!formattedDate) {
    showCustomAlert("请先选择或输入日期 (YYYY/MM/DD)");
    return;
  }

  const targetArr = activeHolidayTab === "holidays" ? editingHolidayCal.holidays : editingHolidayCal.workdays;

  if (!targetArr.includes(formattedDate)) {
    targetArr.push(formattedDate);
    targetArr.sort();
    newHolidayDateInput.value = "";
    renderHolidayModalUI();
    appendLog(`暂存${activeHolidayTab === "holidays" ? '放假日' : '调休补班日'}: ${formattedDate}`, "info");
  } else {
    showCustomAlert(`日期 ${formattedDate} 已存在列表中`);
  }
};

window.removeHolidayDate = function(tabType, dateStr) {
  const targetArr = tabType === "holidays" ? editingHolidayCal.holidays : editingHolidayCal.workdays;
  const idx = targetArr.indexOf(dateStr);
  if (idx !== -1) {
    targetArr.splice(idx, 1);
    renderHolidayModalUI();
  }
};

window.syncHolidays = async function(silent = false) {
  const core = getTauriCore();
  const statusEl = document.getElementById("holidayStatusText");
  if (!core) {
    if (!silent) showCustomAlert("浏览器模拟调试环境无法调用在线接口");
    return;
  }

  if (statusEl) statusEl.textContent = "正在在线同步...";
  try {
    const cal = await core.invoke("fetch_and_update_holidays", { year: null });
    currentHolidayCal = cal;
    editingHolidayCal = JSON.parse(JSON.stringify(cal));
    updateHolidayUI();
    renderHolidayModalUI();
    appendLog(`节假日数据同步成功！已收录 ${cal.holidays.length} 个法定放假日及 ${cal.workdays.length} 个调休补班日。`, "success");
    if (!silent) showCustomAlert(`节假日日历同步成功！\n数据更新时间: ${cal.updated_at}\n已收录 ${cal.holidays.length} 天法定放假及 ${cal.workdays.length} 天调休补班。`);
  } catch (err) {
    if (statusEl) statusEl.textContent = "同步异常";
    appendLog(`同步节假日失败: ${err}`, "error");
    if (!silent) showCustomAlert(`同步节假日数据失败: ${err}\n系统将默认采用标准工作日逻辑。`);
  }
}

// ----------------- 日期时间组与 Form Sub-Tabs 逻辑 -----------------
let dateGroups = [];
let editingDateGroupItems = [];
let editingDateGroupId = null;

window.switchFormSubTab = function(prefix, tabId) {
  const container = prefix === 'sys' ? document.getElementById('tab-system') : document.getElementById('tab-custom');
  if (!container) return;

  const btn = container.querySelector(`.form-subtab-btn[onclick*="'${tabId}'"]`);
  if (btn) {
    container.querySelectorAll('.form-subtab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }

  container.querySelectorAll('.form-subpanel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById(`${prefix}FormPanel-${tabId}`);
  if (panel) panel.classList.add('active');
};

async function fetchDateGroups() {
  const core = getTauriCore();
  if (!core) return;
  try {
    dateGroups = await core.invoke("get_date_groups");
    const statusText = document.getElementById("dateGroupStatusText");
    if (statusText) statusText.textContent = `(${dateGroups.length}个组)`;
    renderDateGroupSelectors();
    renderDateGroupsList();
  } catch (err) {
    appendLog(`获取日期时间组失败: ${err}`, "error");
  }
}

function renderDateGroupSelectors() {
  const sysWrap = document.getElementById("sysDateGroupsContainer");
  const customWrap = document.getElementById("customDateGroupsContainer");

  const buildHtml = (prefix) => {
    if (dateGroups.length === 0) {
      return `<span style="font-size:12px; color:var(--text-muted);">暂无可用的日期时间组 (点击右上角 [🗓️ 日期时间组] 创建)</span>`;
    }
    return dateGroups.map(g => `
      <label class="date-group-chip-select">
        <input type="checkbox" name="${prefix}DateGroupId" value="${g.id}">
        <span>🗓️ ${g.name} (${g.dates ? g.dates.length : 0}条日期)</span>
      </label>
    `).join("");
  };

  if (sysWrap) sysWrap.innerHTML = buildHtml("sys");
  if (customWrap) customWrap.innerHTML = buildHtml("custom");
}

function renderDateGroupsList() {
  const listWrap = document.getElementById("dateGroupsListContainer");
  if (!listWrap) return;

  if (dateGroups.length === 0) {
    listWrap.innerHTML = `<div style="font-size:12px; color:var(--text-muted); text-align:center; padding:16px;">暂未设置日期时间组，请点击上方“+ 新建日期时间组”进行创建</div>`;
    return;
  }

  listWrap.innerHTML = dateGroups.map(g => `
    <div class="date-group-item-card">
      <div class="card-top">
        <div>
          <span class="group-name">🗓️ ${g.name}</span>
          ${g.description ? `<span class="group-desc"> - ${g.description}</span>` : ''}
        </div>
        <div style="display:flex; gap:8px;">
          <button type="button" class="icon-btn edit" title="编辑该组" onclick="editDateGroupItem('${g.id}')">✏️</button>
          <button type="button" class="icon-btn danger" title="删除该组" onclick="deleteDateGroupItem('${g.id}')">🗑️</button>
        </div>
      </div>
      <div class="chips-wrap" style="padding:6px; background:rgba(0,0,0,0.2); border-radius:6px;">
        ${(g.dates || []).map(d => `<span class="holiday-date-chip workday" style="font-size:11px;">📅 ${d}</span>`).join("")}
      </div>
    </div>
  `).join("");
}

window.deleteDateGroupItem = async (id) => {
  const confirmed = await showCustomConfirm("确定要删除该日期时间组吗？已被关联的任务将失去此组的例外规则。");
  if (!confirmed) return;

  const core = getTauriCore();
  if (!core) return;

  try {
    await core.invoke("delete_date_group", { id });
    appendLog(`已删除日期时间组 #${id}`, "info");
    fetchDateGroups();
  } catch (err) {
    appendLog(`删除日期时间组失败: ${err}`, "error");
  }
};

window.editDateGroupItem = (id) => {
  const group = dateGroups.find(g => g.id === id);
  if (!group) return;

  editingDateGroupId = id;
  editingDateGroupItems = [...(group.dates || [])];
  
  document.getElementById("dgNameInput").value = group.name;
  document.getElementById("dgDescInput").value = group.description || "";
  document.getElementById("dgDateItemInput").value = "";
  
  const titleEl = document.querySelector("#createDateGroupCard h4");
  if (titleEl) {
    titleEl.innerHTML = "✏️ 编辑日期时间组";
  }
  
  renderNewDgDateItems();
  document.getElementById("createDateGroupCard").style.display = "block";
};
function openDateGroupModal() {
  fetchDateGroups();
  const modal = document.getElementById("dateGroupModalOverlay");
  if (modal) modal.classList.add("active");
}

function closeDateGroupModal() {
  hideCreateDateGroupForm();
  const modal = document.getElementById("dateGroupModalOverlay");
  if (modal) modal.classList.remove("active");
}

function showCreateDateGroupForm() {
  editingDateGroupId = null;
  editingDateGroupItems = [];
  document.getElementById("dgNameInput").value = "";
  document.getElementById("dgDescInput").value = "";
  document.getElementById("dgDateItemInput").value = "";
  
  const titleEl = document.querySelector("#createDateGroupCard h4");
  if (titleEl) {
    titleEl.innerHTML = "➕ 新增日期时间组";
  }
  
  renderNewDgDateItems();
  document.getElementById("createDateGroupCard").style.display = "block";
}

function hideCreateDateGroupForm() {
  editingDateGroupId = null;
  editingDateGroupItems = [];
  document.getElementById("dgNameInput").value = "";
  document.getElementById("dgDescInput").value = "";
  document.getElementById("dgDateItemInput").value = "";
  document.getElementById("createDateGroupCard").style.display = "none";
}

function addDateItemToGroup() {
  const input = document.getElementById("dgDateItemInput");
  const val = input ? input.value.trim() : "";
  if (!val) {
    showCustomAlert("请输入日期或时刻 (如: 2026/10/01 或 2026/10/01 08:30:00)");
    return;
  }
  
  if (!editingDateGroupItems.includes(val)) {
    editingDateGroupItems.push(val);
    input.value = "";
    renderNewDgDateItems();
  }
}

function renderNewDgDateItems() {
  const wrap = document.getElementById("dgDateItemsContainer");
  if (!wrap) return;
  if (editingDateGroupItems.length === 0) {
    wrap.innerHTML = `<span style="font-size:12px; color:var(--text-muted); align-self:center;">尚未添加日期条目</span>`;
    return;
  }
  wrap.innerHTML = editingDateGroupItems.map((item, idx) => `
    <div class="holiday-date-chip workday" style="font-size:11px;">
      <span>📅 ${item}</span>
      <span class="remove-chip-btn" onclick="removeNewDgDateItem(${idx})">✕</span>
    </div>
  `).join("");
}

window.removeNewDgDateItem = (idx) => {
  editingDateGroupItems.splice(idx, 1);
  renderNewDgDateItems();
};

async function saveNewDateGroup() {
  const name = document.getElementById("dgNameInput").value.trim();
  const description = document.getElementById("dgDescInput").value.trim();
  if (!name) {
    showCustomAlert("请输入日期时间组名称");
    return;
  }
  if (editingDateGroupItems.length === 0) {
    showCustomAlert("请至少为此组添加一条日期或时间范围");
    return;
  }

  const core = getTauriCore();
  if (!core) return;

  try {
    if (editingDateGroupId) {
      await core.invoke("update_date_group", {
        id: editingDateGroupId,
        name,
        description: description || null,
        dates: editingDateGroupItems
      });
      appendLog(`已成功更新日期时间组: [${name}]`, "success");
    } else {
      await core.invoke("add_date_group", {
        name,
        description: description || null,
        dates: editingDateGroupItems
      });
      appendLog(`已成功创建日期时间组: [${name}]`, "success");
    }
    hideCreateDateGroupForm();
    fetchDateGroups();
  } catch (err) {
    appendLog(`保存日期时间组失败: ${err}`, "error");
    showCustomAlert(`错误: ${err}`);
  }
}

function getGroupBadgeHtml(groupIds, mode) {
  if (!groupIds || groupIds.length === 0 || !mode || mode === "NONE") return "";
  const groupNames = groupIds.map(id => {
    const g = dateGroups.find(dg => dg.id === id);
    return g ? g.name : id;
  }).join(", ");

  if (mode === "EXCLUDE") {
    return `<div class="date-group-badge exclude">🚫 遇例外组 [${groupNames}] 跳过不触发</div>`;
  }
  if (mode === "FORCE_TRIGGER") {
    return `<div class="date-group-badge force">⚡ 遇特例组 [${groupNames}] 强制/临时触发</div>`;
  }
  return "";
}

// ----------------- Tab 1: 系统计划任务修改器逻辑 -----------------
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

  const checkedGroupCbs = document.querySelectorAll('input[name="sysDateGroupId"]:checked');
  const dateGroupIds = Array.from(checkedGroupCbs).map(cb => cb.value);
  const dateGroupMode = document.querySelector('input[name="sysDateGroupMode"]:checked')?.value || "NONE";

  const core = getTauriCore();
  if (!core) return;

  try {
    const newTask = await core.invoke("add_task", {
      taskName: taskName,
      targetTime: formattedTime,
      action: selectedAction,
      dateGroupIds,
      dateGroupMode
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
  if (!targetTimeStr) return "";
  const targetDate = parseCustomDate(targetTimeStr);
  if (!targetDate) return "";
  const target = targetDate.getTime();
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
    const groupBadge = getGroupBadgeHtml(task.date_group_ids, task.date_group_mode);

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
          ${groupBadge}
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

// ----------------- Tab 2: 高级自主任务引擎逻辑 -----------------
function getNextTriggerDateForCustomTask(task) {
  const candidates = [];
  const now = new Date();
  const nowTime = now.getTime();

  // 1. 检查不规则固定时刻
  if (task.trigger_datetimes && task.trigger_datetimes.length > 0) {
    for (const dtStr of task.trigger_datetimes) {
      const dt = parseCustomDate(dtStr);
      if (dt && dt.getTime() > nowTime) {
        candidates.push(dt);
      }
    }
  }

  // 2. 检查循环规则
  if (task.recurrence && task.recurrence.mode !== "ONCE") {
    const rule = task.recurrence;
    const timeOfDay = rule.time_of_day || "09:00:00";
    const parts = timeOfDay.split(":");
    const h = parseInt(parts[0] || "0");
    const m = parseInt(parts[1] || "0");
    const s = parseInt(parts[2] || "0");

    const testDate = new Date(now);
    for (let i = 0; i < 366; i++) {
      const year = testDate.getFullYear();
      const month = testDate.getMonth() + 1;
      const dateNum = testDate.getDate();
      let dayOfWeek = testDate.getDay();
      if (dayOfWeek === 0) dayOfWeek = 7;

      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(dateNum).padStart(2, '0')}`;

      let isMatch = false;
      if (rule.mode === "DAILY") {
        isMatch = true;
      } else if (rule.mode === "WEEKLY") {
        const targetDays = (rule.days_of_week && rule.days_of_week.length > 0) ? rule.days_of_week : [1, 2, 3, 4, 5];
        if (targetDays.includes(dayOfWeek)) isMatch = true;
      } else if (rule.mode === "MONTHLY") {
        const targetMonths = rule.days_of_month || [1];
        const isLastDay = new Date(year, month, 0).getDate() === dateNum;
        if (targetMonths.includes(dateNum) || (isLastDay && targetMonths.includes(32))) {
          isMatch = true;
        }
      } else if (rule.mode === "WORKDAY") {
        if (currentHolidayCal.workdays && currentHolidayCal.workdays.includes(dateStr)) {
          isMatch = true;
        } else if (currentHolidayCal.holidays && currentHolidayCal.holidays.includes(dateStr)) {
          isMatch = false;
        } else {
          isMatch = dayOfWeek <= 5;
        }
      } else if (rule.mode === "HOLIDAY") {
        if (currentHolidayCal.holidays && currentHolidayCal.holidays.includes(dateStr)) {
          isMatch = true;
        } else if (currentHolidayCal.workdays && currentHolidayCal.workdays.includes(dateStr)) {
          isMatch = false;
        } else {
          isMatch = dayOfWeek > 5;
        }
      }

      if (isMatch) {
        const candidateDate = new Date(year, month - 1, dateNum, h, m, s);
        if (candidateDate.getTime() > nowTime) {
          candidates.push(candidateDate);
          break;
        }
      }

      testDate.setDate(testDate.getDate() + 1);
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.getTime() - b.getTime());
  return candidates[0];
}

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

  // 收集选中的日期组及特例模式
  const checkedGroupCbs = document.querySelectorAll('input[name="customDateGroupId"]:checked');
  const dateGroupIds = Array.from(checkedGroupCbs).map(cb => cb.value);
  const dateGroupMode = document.querySelector('input[name="customDateGroupMode"]:checked')?.value || "NONE";

  if (!recurrence && triggerTimes.length === 0 && dateGroupMode !== "FORCE_TRIGGER") {
    showCustomAlert("请设置定时循环周期（如每天、每周、工作日）、具体不规则触发时间或特例强制触发规则");
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

  if (executables.length === 0 && popupMessages.length === 0) {
    showCustomAlert("请至少配置一项“触发执行程序”或“显示弹窗提醒”");
    return;
  }

  const alwaysOnTop = customAlwaysOnTopInput.checked;

  const core = getTauriCore();
  if (!core) return;

  try {
    if (editingCustomTaskId) {
      await core.invoke("update_custom_task", {
        id: editingCustomTaskId,
        name,
        enableWindows,
        triggerDatetimes: triggerTimes,
        executables,
        popupMessages,
        alwaysOnTop,
        recurrence,
        dateGroupIds,
        dateGroupMode
      });
      appendLog(`已成功更新自主高级任务规则: [${name}]`, "success");
    } else {
      await core.invoke("add_custom_task", {
        name,
        enableWindows,
        triggerDatetimes: triggerTimes,
        executables,
        popupMessages,
        alwaysOnTop,
        recurrence,
        dateGroupIds,
        dateGroupMode
      });
      const recurLabel = formatRecurrenceText(recurrence);
      appendLog(`已成功保存自主高级任务规则: [${name}] ${recurLabel ? `(${recurLabel})` : ''}`, "success");
    }

    cancelEditCustomTask();
    fetchCustomTasks();
  } catch (err) {
    appendLog(`保存自主高级任务失败: ${err}`, "error");
    showCustomAlert(`保存失败: ${err}`);
  }
}

window.editCustomTask = (id) => {
  const task = customTasks.find(t => t.id === id);
  if (!task) return;

  editingCustomTaskId = id;
  customTaskNameInput.value = task.name || "";
  customAlwaysOnTopInput.checked = task.always_on_top;

  // Restore recurrence
  if (task.recurrence) {
    const r = task.recurrence;
    const modeRadio = document.querySelector(`input[name="customRecurrenceMode"][value="${r.mode}"]`);
    if (modeRadio) {
      modeRadio.checked = true;
      toggleRecurrenceUI('custom');
    }
    
    if (r.mode === "WEEKLY") {
      document.querySelectorAll(`#customWeekdaysWrap input[type="checkbox"]`).forEach(cb => {
        cb.checked = (r.days_of_week || []).includes(parseInt(cb.value));
      });
    } else if (r.mode === "MONTHLY") {
      document.querySelectorAll(`#customMonthdaysWrap input[type="checkbox"]`).forEach(cb => {
        cb.checked = (r.days_of_month || []).includes(parseInt(cb.value));
      });
    }
    
    const timeOfDayInput = document.getElementById(`customTimeOfDay`);
    if (timeOfDayInput && r.time_of_day) {
      timeOfDayInput.value = r.time_of_day;
    }
  } else {
    const modeRadio = document.querySelector(`input[name="customRecurrenceMode"][value="ONCE"]`);
    if (modeRadio) {
      modeRadio.checked = true;
      toggleRecurrenceUI('custom');
    }
  }

  // Restore enableWindows
  enableWindowsContainer.innerHTML = '';
  if (task.enable_windows && task.enable_windows.length > 0) {
    task.enable_windows.forEach(w => {
      addEnableWindowRow();
      const rows = enableWindowsContainer.querySelectorAll(".multi-window-row");
      const lastRow = rows[rows.length - 1];
      if (w.start_time) lastRow.querySelector(".window-start-input").value = w.start_time.replace(/-/g, '/');
      if (w.end_time) lastRow.querySelector(".window-end-input").value = w.end_time.replace(/-/g, '/');
    });
  } else if (task.enable_window_start || task.enable_window_end) {
    addEnableWindowRow();
    const rows = enableWindowsContainer.querySelectorAll(".multi-window-row");
    const lastRow = rows[rows.length - 1];
    if (task.enable_window_start) lastRow.querySelector(".window-start-input").value = task.enable_window_start.replace(/-/g, '/');
    if (task.enable_window_end) lastRow.querySelector(".window-end-input").value = task.enable_window_end.replace(/-/g, '/');
  } else {
    addEnableWindowRow();
  }

  // Restore triggerDatetimes
  triggerTimesContainer.innerHTML = '';
  if (task.trigger_datetimes && task.trigger_datetimes.length > 0) {
    task.trigger_datetimes.forEach(t => {
      addTriggerTimeRow();
      const rows = triggerTimesContainer.querySelectorAll(".multi-input-row");
      const lastRow = rows[rows.length - 1];
      lastRow.querySelector(".trigger-time-input").value = t.replace(/-/g, '/');
    });
  } else {
    addTriggerTimeRow();
  }

  // Restore executables
  executablesContainer.innerHTML = '';
  if (task.executables && task.executables.length > 0) {
    task.executables.forEach(e => {
      addExecutableRow();
      const rows = executablesContainer.querySelectorAll(".multi-input-row");
      const lastRow = rows[rows.length - 1];
      lastRow.querySelector(".executable-input").value = e;
    });
  } else {
    addExecutableRow();
  }

  // Restore popupMessages
  popupsContainer.innerHTML = '';
  if (task.popup_messages && task.popup_messages.length > 0) {
    task.popup_messages.forEach(m => {
      addPopupRow();
      const rows = popupsContainer.querySelectorAll(".multi-input-row");
      const lastRow = rows[rows.length - 1];
      lastRow.querySelector(".popup-input").value = m;
    });
  } else {
    addPopupRow();
  }

  // Restore DateGroups
  document.querySelectorAll('input[name="customDateGroupId"]').forEach(cb => cb.checked = false);
  if (task.date_group_ids && task.date_group_ids.length > 0) {
    task.date_group_ids.forEach(gid => {
      const cb = document.querySelector(`input[name="customDateGroupId"][value="${gid}"]`);
      if (cb) cb.checked = true;
    });
  }

  const mode = task.date_group_mode || "NONE";
  const dgModeRadio = document.querySelector(`input[name="customDateGroupMode"][value="${mode}"]`);
  if (dgModeRadio) dgModeRadio.checked = true;

  // Change submit button and add cancel button
  const submitBtn = document.getElementById("submitCustomBtn");
  submitBtn.innerHTML = "<span>更新自主高级规则</span>";
  
  let cancelBtn = document.getElementById("cancelEditCustomBtn");
  if (!cancelBtn) {
    cancelBtn = document.createElement("button");
    cancelBtn.id = "cancelEditCustomBtn";
    cancelBtn.type = "button";
    cancelBtn.className = "modal-btn secondary";
    cancelBtn.style.marginTop = "12px";
    cancelBtn.style.marginLeft = "8px";
    cancelBtn.innerHTML = "<span>取消编辑</span>";
    cancelBtn.onclick = cancelEditCustomTask;
    submitBtn.parentNode.insertBefore(cancelBtn, submitBtn.nextSibling);
  }
  cancelBtn.style.display = "inline-flex";
  
  // Switch to custom tab and scroll to top
  document.querySelector('.tab-btn[data-tab="tab-custom"]').click();
  document.querySelector('.app-container').scrollTop = 0;
};

window.cancelEditCustomTask = () => {
  editingCustomTaskId = null;
  customTaskNameInput.value = "";
  customAlwaysOnTopInput.checked = true;

  const modeRadio = document.querySelector(`input[name="customRecurrenceMode"][value="ONCE"]`);
  if (modeRadio) {
    modeRadio.checked = true;
    toggleRecurrenceUI('custom');
  }

  enableWindowsContainer.innerHTML = '';
  addEnableWindowRow();

  triggerTimesContainer.innerHTML = '';
  addTriggerTimeRow();

  executablesContainer.innerHTML = '';
  addExecutableRow();

  popupsContainer.innerHTML = '';
  addPopupRow();

  document.querySelectorAll('input[name="customDateGroupId"]').forEach(cb => cb.checked = false);
  const dgModeRadio = document.querySelector(`input[name="customDateGroupMode"][value="NONE"]`);
  if (dgModeRadio) dgModeRadio.checked = true;

  const submitBtn = document.getElementById("submitCustomBtn");
  submitBtn.innerHTML = "<span>保存自主高级规则</span>";
  const cancelBtn = document.getElementById("cancelEditCustomBtn");
  if (cancelBtn) cancelBtn.style.display = "none";
};

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
    const nextTriggerDate = getNextTriggerDateForCustomTask(task);
    const nextTriggerStr = nextTriggerDate ? formatDatetimeString(nextTriggerDate) : null;
    const countdownText = nextTriggerStr ? calculateCountdown(nextTriggerStr) : null;
    const groupBadge = getGroupBadgeHtml(task.date_group_ids, task.date_group_mode);

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
            ${(task.is_enabled && countdownText) ? `<span class="task-status-badge PENDING custom-countdown" data-next="${nextTriggerStr}">⏳ 倒计时: ${countdownText}</span>` : ''}
          </div>

          <div style="font-size:11px; color:#71717a; word-break:break-all;">${timeWindowStr}</div>
          ${groupBadge}

          <div class="custom-tags-group">
            ${recurText ? `<span class="custom-tag time">${recurText}</span>` : ''}
            ${(task.trigger_datetimes || []).map(t => `<span class="custom-tag time">⏰ ${t}</span>`).join("")}
            ${(task.executables || []).map(e => `<span class="custom-tag exe">🚀 ${e}</span>`).join("")}
            ${(task.popup_messages || []).map(m => `<span class="custom-tag msg">💬 ${m}</span>`).join("")}
          </div>
        </div>

        <div class="task-actions">
          <button class="icon-btn" title="编辑规则" onclick="editCustomTask('${task.id}')">✏️</button>
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
    liveClockEl.textContent = getFormattedNowTime();

    // 1. 系统任务倒计时更新
    document.querySelectorAll(".countdown").forEach(el => {
      const targetStr = el.getAttribute("data-target");
      if (targetStr) {
        el.textContent = `⏳ 倒计时: ${calculateCountdown(targetStr)}`;
      }
    });

    // 2. 自主任务标题右侧倒计时更新
    document.querySelectorAll(".custom-countdown").forEach(el => {
      const nextStr = el.getAttribute("data-next");
      if (nextStr) {
        const cd = calculateCountdown(nextStr);
        el.textContent = `⏳ 倒计时: ${cd}`;
      }
    });
  }, 1000);
}

function initDefaultTime() {
  if (targetDatetimeInput) {
    targetDatetimeInput.value = "";
  }
}

// 事件监听与 Tab 切换
window.addEventListener("DOMContentLoaded", () => {
  initMonthdaysOptions();
  initCustomDatePickers(document);

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const targetId = btn.getAttribute('data-tab');
      document.getElementById(targetId).classList.add('active');
    });
  });

  // 日期时间组模态框事件
  const openDgBtn = document.getElementById("openDateGroupModalBtn");
  const closeDgBtn = document.getElementById("closeDateGroupModalBtn");
  const showCreateDgBtn = document.getElementById("showCreateGroupBtn");
  const hideCreateDgBtn = document.getElementById("hideCreateGroupBtn");
  const addDgDateBtn = document.getElementById("addDgDateItemBtn");
  const saveDgBtn = document.getElementById("saveDateGroupBtn");

  if (openDgBtn) openDgBtn.addEventListener("click", openDateGroupModal);
  if (closeDgBtn) closeDgBtn.addEventListener("click", closeDateGroupModal);
  if (showCreateDgBtn) showCreateDgBtn.addEventListener("click", showCreateDateGroupForm);
  if (hideCreateDgBtn) hideCreateDgBtn.addEventListener("click", hideCreateDateGroupForm);
  if (addDgDateBtn) addDgDateBtn.addEventListener("click", addDateItemToGroup);
  if (saveDgBtn) saveDgBtn.addEventListener("click", saveNewDateGroup);
  const langToggleBtn = document.getElementById("langToggleBtn");
  if (langToggleBtn) langToggleBtn.addEventListener("click", toggleLanguage);
  
  if (syncHolidaysBtn) syncHolidaysBtn.addEventListener("click", openHolidayModal);
  
  initI18n();

  addRuleForm.addEventListener("submit", handleAddTask);
  addCustomRuleForm.addEventListener("submit", handleAddCustomTask);

  initDefaultTime();
  startClocks();

  setTimeout(() => {
    fetchHolidayCalendar();
    fetchDateGroups();
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
