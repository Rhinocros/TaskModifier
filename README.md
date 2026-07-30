# Windows 计划任务定时修改器 & 高级自主任务引擎 (TaskModifier)

<p menu-align="center">
  <img src="src/assets/app_icon.jpg" width="100" height="100" alt="App Icon" style="border-radius: 18px;" />
</p>

**TaskModifier** 是一款专为 Windows 系统打造的高性能、轻量级计划任务管理与自动化调度工具。基于 **Tauri 2 + Rust + HTML5/CSS3** 构建，结合现代极客暗色 UI 设计，提供秒级精准控制与双核心任务引擎。

---

## 🌟 核心解决痛点

在日常运维、自动化脚本调度与系统管理中，标准 Windows 任务计划程序（`Task Scheduler`）存在以下显著局限：

1. **缺乏“到期自动开关”机制**：Windows 原生计划任务无法设置“在未来特定时间点自动启用或禁用某项计划任务”。例如：希望某任务在今晚 23:00 自动禁用，明早 08:00 自动开启，原生工具无法直接实现。
2. **缺乏灵活的不规则时间点与时间窗口限制**：原生工具主要针对固定周期（每天/每周），无法方便地设置“多个不规则散落时间点触发”，或“仅在指定的时间窗口区间内允许执行”。
3. **缺少多样化联动响应**：需要同时执行可执行文件/脚本、弹出高亮置顶提醒等组合操作时配置繁琐。
4. **传统客户端资源占用大、硬件架构适配单一**：基于 Electron 或 Python 开发的工具体积大、内存占用高，且通常缺少对 Windows ARM64 架构设备的原生支持。

**TaskModifier** 正是为了彻底解决上述痛点而设计。

---

## ✨ 核心功能与亮点

### 1. 📋 系统计划任务修改器 (System Scheduled Tasks Engine)
* **精准到期开关管理**：设定目标时间点，自动将指定的 Windows 系统计划任务切换为 **启用 (ENABLE)** 或 **禁用 (DISABLE)**。
* **快捷预设与秒级轮询**：支持一键 `+1分钟`、`+5分钟`、`+30分钟`、`+1小时` 快捷设置，后端高精度线程秒级扫描轮询。
* **实时执行日志记录**：完整记录规则添加、触发状态（Pending / Success / Failed）及详细的系统日志。

### 2. ⚡ 高级自主任务引擎 (Advanced Custom Task Engine)
* **多不规则时间点触发 (Trigger Datetimes)**：配置多个独立不规则的时间点，到期自动执行任务链。
* **多有效时间窗口 (Time Windows)**：设置一个或多个有效运行区间（开始时间至结束时间），仅在时间窗口内响应。
* **多动作组合链**：
  - **程序调用**：支持同时配置并触发多个外部程序路径或命令行。
  - **弹窗提醒**：支持多个独立消息内容，并支持窗口**置顶 (Always-On-Top)** 显示。
* **触发历史追溯**：内置已触发历史日志（Triggered History），方便审计与状态查看。

### 3. 🎨 现代极致 UI 与体验
* **暗色玻璃质感 UI**：精心调配的色彩搭配与微动画交互，带来极致视觉享受。
* **实时系统时钟与权限监测**：标题栏集成动态高精度时钟，并自动检测当前 Windows 管理员运行权限。
* **配置自动持久化**：所有数据自动以 json 格式本地保存（`tasks.json` / `custom_tasks.json`），即开即用，无需配置复杂的数据库。

### 4. 🛠️ 自动化 CI/CD 与多架构二进制发布
* **全自动编译工作流**：集成 GitHub Actions 工作流（`.github/workflows/build.yml`）。
* **代码变动/标签触发**：仓库代码变更自动编译，提交版本 Tag（如 `v1.0.0`）自动创建 GitHub Release 附带打包文件。
* **手动编译支持 (`workflow_dispatch`)**：支持在 GitHub Actions 界面一键手动触发编译。
* **双架构原生支持**：同时构建 **Windows x64** (`x86_64-pc-windows-msvc`) 与 **Windows ARM64** (`aarch64-pc-windows-msvc`) 原生 `.exe` 可执行文件。

---

## 🚀 核心优势

| 维度 | TaskModifier | 传统方案 / 原生计划任务 |
| :--- | :--- | :--- |
| **到期自动开关系统任务** | 完美支持 (ENABLE / DISABLE 秒级控制) | ❌ 不支持，需手动操作或另写脚本 |
| **内存与 CPU 占用** | **极低** (Rust 核心，内存占用低于 30MB) | 较高 (如 Python/Electron 工具) |
| **Windows ARM64 适配** | **原生支持** (跨架构编译产物) | 多数仅提供 x86/x64 |
| **界面与易用性** | 现代暗色 UI，直观可视化调度 | 界面陈旧或纯命令行操作 |
| **多时间窗口与独立时间点** | 自由组合配置 | 配置繁琐、缺乏灵活性 |
| **部署便利性** | 绿色单文件 `.exe`，解压即用 | 需复杂依赖环境 |

---

## 🛠️ 技术栈架构

* **Core Backend**: Rust, [Tauri v2](https://tauri.app/), `tokio`, `chrono`, `serde`
* **Frontend UI**: Vanilla JavaScript (ES6+), HTML5, Vanilla CSS (Design Tokens, Dark Theme)
* **Build System & CI/CD**: Node.js, npm, Rust Cargo, GitHub Actions (Multi-arch MSVC runner)

---

## 📦 本地开发与构建

### 前置条件
- 安装 [Node.js](https://nodejs.org/) (推荐 v18+)
- 安装 [Rust Environment](https://www.rust-lang.org/) (包含 `cargo`)
- Windows C++ Build Tools (MSVC)

### 本地运行

```bash
# 1. 克隆仓库
git clone https://github.com/your-username/Custom-Scheduled-Tasks.git
cd Custom-Scheduled-Tasks

# 2. 安装前端/Tauri CLI 依赖
npm install

# 3. 运行开发模式
npm run tauri dev
```

### 本地编译打包

```bash
# 编译当前平台的 Release 可执行文件
npm run tauri build
```

编译生成的二进制文件将保存在 `src-tauri/target/release/TaskModifier.exe`。

---

## 🤖 GitHub Actions 自动编译说明

本项目包含了完整的 GitHub Actions 自动化编译脚本：

1. **自动构建**：只要向 `main` 或 `master` 分支推送代码，GitHub 将自动启动构建流程。
2. **手动构建**：在 GitHub 仓库页面点击 **Actions** -> 选择 **Build Windows Executables** -> 点击 **Run workflow** 即可手动触发构建。
3. **发版 Release**：推送带有 `v` 前缀的 Tag（例如 `git tag v1.0.0 && git push origin v1.0.0`），脚本会自动在 Releases 页面发布编译好的 `TaskModifier-windows-x64.exe` 与 `TaskModifier-windows-arm64.exe`。

---

## 📄 开源许可证

本项目采用 [MIT License](LICENSE) 许可证。
