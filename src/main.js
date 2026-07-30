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

// DOM Elements
const addRuleForm = document.getElementById("addRuleForm");
const taskNameInput = document.getElementById("taskName");
const targetDatetimeInput = document.getElementById("targetDatetime");
const taskListContainer = document.getElementById("taskList");
const taskCountBadge = document.getElementById("taskCount");
const liveClockEl = document.getElementById("liveClock");
const logTerminal = document.getElementById("logTerminal");

// Custom Modal Elements
const modalOverlay = document.getElementById("customModalOverlay");
const modalIconBox = document.getElementById("modalIconBox");
const modalTitle = document.getElementById("modalTitle");
const modalBody = document.getElementById("modalBody");
const modalCancelBtn = document.getElementById("modalCancelBtn");
const modalConfirmBtn = document.getElementById("modalConfirmBtn");

// 自定义模态弹窗系统
function showCustomModal({ title = "提示", message = "", iconType = "warning", confirmText = "确定", cancelText = null, isDanger = false }) {
  return new Promise((resolve) => {
    modalTitle.textContent = title;
    modalBody.textContent = message;
    
    // 图标类型设置
    modalIconBox.className = `modal-icon-box ${iconType}`;
    modalIconBox.textContent = iconType === 'danger' ? '🗑️' : iconType === 'warning' ? '⚠️' : 'ℹ️';

    // 确认按钮风格设置
    modalConfirmBtn.textContent = confirmText;
    modalConfirmBtn.className = `modal-btn ${isDanger ? 'danger' : 'primary'}`;

    // 取消按钮显示规则
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

// 格式化为 datetime-local (YYYY-MM-DDTHH:mm:ss)
function formatToDatetimeInputValue(dateObj) {
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  const hours = String(dateObj.getHours()).padStart(2, '0');
  const mins = String(dateObj.getMinutes()).padStart(2, '0');
  const secs = String(dateObj.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${mins}:${secs}`;
}

// 重置时间输入框为系统当前时间
window.resetToNow = () => {
  const now = new Date();
  targetDatetimeInput.value = formatToDatetimeInputValue(now);
};

// 快速设置时间偏移 (+N 分钟)
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

// 格式化日期对象为 YYYY-MM-DD HH:mm:ss
function formatDatetimeString(dateStr) {
  const date = new Date(dateStr);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const mins = String(date.getMinutes()).padStart(2, '0');
  const secs = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${mins}:${secs}`;
}

// 终端输出日志
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

// 获取任务列表
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
    appendLog(`获取任务失败: ${err}`, "error");
  }
}

// 添加新任务
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

    appendLog(`已成功创建调度规则: [${taskName}] 将在 ${formattedTime} 修改为 ${selectedAction}`, "success");
    taskNameInput.value = "";
    fetchTasks();
  } catch (err) {
    appendLog(`添加规则失败: ${err}`, "error");
    showCustomAlert(`错误: ${err}`);
  }
}

// 删除任务
window.deleteTaskItem = async (id) => {
  const confirmed = await showCustomConfirm("确定要删除该条调度规则吗？此操作无法撤销。");
  if (!confirmed) return;

  const core = getTauriCore();
  if (!core) return;

  try {
    await core.invoke("delete_task", { id });
    appendLog(`已删除调度规则 #${id}`, "info");
    fetchTasks();
  } catch (err) {
    appendLog(`删除失败: ${err}`, "error");
  }
};

// 即时测试执行
window.testExecuteNow = async (id) => {
  const core = getTauriCore();
  if (!core) return;

  appendLog(`正在立即测试执行任务 #${id}...`, "info");
  try {
    const msg = await core.invoke("execute_task_now", { id });
    appendLog(`手动执行结果: ${msg}`, "success");
    fetchTasks();
  } catch (err) {
    appendLog(`手动执行失败: ${err}`, "error");
    fetchTasks();
  }
};

// 计算倒计时文本
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

// 渲染任务列表
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

// 实时时钟与倒计时更新
function startClocks() {
  setInterval(() => {
    // 顶部时钟
    const now = new Date();
    liveClockEl.textContent = now.toLocaleTimeString('zh-CN', { hour12: false });

    // 列表里的倒计时
    document.querySelectorAll(".countdown").forEach(el => {
      const targetStr = el.getAttribute("data-target");
      if (targetStr) {
        el.textContent = `⏳ 倒计时: ${calculateCountdown(targetStr)}`;
      }
    });
  }, 1000);
}

// 初始化默认时间选择框为当前时间 + 5 分钟
function initDefaultTime() {
  setPresetOffset(5);
}

// 事件监听
window.addEventListener("DOMContentLoaded", () => {
  addRuleForm.addEventListener("submit", handleAddTask);
  initDefaultTime();
  startClocks();

  setTimeout(() => {
    fetchTasks();
  }, 300);

  // 监听 Rust 后台推送的刷新事件
  if (window.__TAURI__ && window.__TAURI__.event) {
    window.__TAURI__.event.listen("tasks_updated", () => {
      appendLog("后台监视器完成了一次任务到期调度！", "info");
      fetchTasks();
    });
  }
});
