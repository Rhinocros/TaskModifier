# Windows Scheduled Tasks Modifier & Advanced Custom Task Engine (TaskModifier)

<p align="center">
  <img src="src/assets/app_icon.jpg" width="100" height="100" alt="App Icon" style="border-radius: 18px;" />
</p>

[English](README-en.md) | [简体中文](README.md)

**TaskModifier** is a high-performance, lightweight scheduled task management and automation scheduling tool tailored for Windows. Built with **Tauri 2 + Rust + HTML5/CSS3**, featuring a modern geeky dark UI design, it provides precision control down to the second and a dual-core task engine.

---

## 🌟 Core Pain Points Solved

In daily operations, automated script scheduling, and system management, the standard Windows `Task Scheduler` has significant limitations:

1. **Lack of "Auto Expiry Switch" Mechanism**: Windows native scheduled tasks cannot be set to "automatically enable or disable a specific task at a future time." For example, setting a task to automatically disable tonight at 23:00 and enable tomorrow morning at 08:00 is impossible directly with native tools.
2. **Lack of Flexible Cycle Periods and Dynamic Workday/Holiday Recognition**: Native tools cannot intelligently recognize national statutory holidays and shifted working days (e.g., skipping National Day holidays, but working normally on weekend make-up days). It's also inconvenient to set tasks for "specific days of the week," "specific dates of the month," or "the last day of the month."
3. **Lack of Diverse Coordinated Responses**: Complex configurations are required when combining actions like executing files/scripts and popping up high-priority highlighted reminders simultaneously.
4. **Heavy Resource Usage and Single Architecture Support of Traditional Clients**: Tools developed with Electron or Python are bulky, consume a lot of memory, and generally lack native support for Windows ARM64 devices.

**TaskModifier** was designed specifically to completely resolve these pain points.

---

## ✨ Core Features & Highlights

### 1. 📋 System Scheduled Tasks Engine
* **Precise Expiry Switch Management**: Set a target time (YYYY-MM-DD HH:mm:ss) to automatically switch specified Windows system scheduled tasks to **ENABLE** or **DISABLE**.
* **Quick Presets & Second-Level Polling**: Supports one-click `+1 min`, `+5 mins`, `+30 mins`, `+1 hour` quick setups, backed by high-precision, second-level scanning polling in the backend thread.
* **Real-time Execution Logging**: Comprehensively logs rule additions, trigger statuses (Pending / Success / Failed), and detailed system logs.

### 2. ⚡ Advanced Custom Task Engine
* **Multiple Recurring Cycle Schedules**:
  * 🔄 **Daily (DAILY)**: Triggers at fixed times every day.
  * 📅 **Weekly/Specific Days (WEEKLY)**: Supports Mon-Fri, weekends, or custom multiple selections of days.
  * 📆 **Specific Days of Month (MONTHLY)**: Supports multiple selections from 1st to 31st, or the "last day of the month."
  * 💼 **Statutory Workdays (WORKDAY)**: Automatically skips statutory holidays (e.g., National Day break) and triggers normally on weekend make-up working days.
  * 🎉 **Statutory Holidays (HOLIDAY)**: Triggers only during national statutory holidays.
  * ⏱️ **Single/Irregular Times (ONCE)**: Triggers once or at multiple scattered times.
* **Flexible Time Grouping & Task Editing**: Supports secondary editing of existing custom tasks directly in the interface, making it easy to add, modify, or delete time groups.
* **Dynamic Chinese Holiday & Shifted Workday Calendar**:
  * Fetches authoritative holiday schedule data published by the General Office of the State Council online (Timor / Jiejiari API).
  * Intelligently distinguishes dynamically changing "statutory holidays" and "weekend make-up days" every year.
  * Local persistent caching (`holidays.json`) allows offline fallback use, with a built-in one-click manual sync button in the UI.
* **Multiple Effective Time Windows**: Set one or multiple effective running intervals (start time to end time), responding only within the time windows.
* **Multi-Action Combinations**:
  - **Program Invocation**: Supports configuring and triggering multiple external program paths or command lines simultaneously (fully supports running with arbitrary arguments).
  - **Popup Reminders**: Supports multiple independent message contents, and window **Top-Most (Always-On-Top)** forced popping.
* **Trigger History Traceability**: Built-in Triggered History log for easy auditing and status checking.

### 3. 🎨 Modern Ultimate UI & Experience
* **Multi-language Support (i18n)**: Natively supports seamless switching between English and Chinese; the UI language follows user settings.
* **Dark Glassmorphism UI**: Carefully mixed color palettes and micro-animation interactions dynamically adapt to the task list height, solving element overflow issues.
* **Real-time System Clock & Permission Monitoring**: The title bar integrates a dynamic high-precision clock and automatically detects current Windows Administrator privileges.
* **Automatic Configuration Persistence**: All data is automatically saved locally in JSON format (`tasks.json` / `custom_tasks.json` / `holidays.json`), ready to use out of the box.

### 4. 🛠️ Automated CI/CD & Multi-Architecture Binary Release
* **Fully Automated Build Workflow**: Integrated GitHub Actions workflow (`.github/workflows/build.yml`).
* **Version Tag Triggered Builds**: Pushing a version tag (e.g., `v1.0.0`) automatically triggers multi-architecture builds and publishes executable files in GitHub Releases.
* **Manual Build Support (`workflow_dispatch`)**: One-click manual trigger of compilation supported in the GitHub Actions interface (pushing code without tags will not trigger auto-builds).
* **Dual Architecture Native Support**: Simultaneously builds native `.exe` executables for **Windows x64** (`x86_64-pc-windows-msvc`) and **Windows ARM64** (`aarch64-pc-windows-msvc`).

---

## 🚀 Core Advantages

| Dimension | TaskModifier | Traditional Solutions / Native Task Scheduler |
| :--- | :--- | :--- |
| **Auto Enable/Disable System Tasks on Expiry** | Perfectly Supported (ENABLE/DISABLE down to the second) | ❌ Not supported, requires manual intervention or scripts |
| **Workday/Holiday Recognition** | **Intelligently skips holidays, includes weekend make-up days** (Online dynamic calendar) | ❌ Does not support holiday/shifted-day recognition |
| **Multiple Recurring Cycles** | Daily / specific weekdays / specific dates / month-end / workdays | Only simple fixed cycles, lacks flexibility |
| **Memory & CPU Usage** | **Extremely Low** (Rust core, <30MB RAM) | High (e.g., Python/Electron tools) |
| **Windows ARM64 Adaptation** | **Natively Supported** (Cross-architecture build artifacts) | Mostly x86/x64 only |
| **UI & Usability** | Modern dark UI, intuitive visual scheduling | Outdated interfaces or CLI only |
| **Multiple Time Windows & Independent Times** | Freely combinable configuration | Cumbersome setup, inflexible |
| **Deployment Convenience** | Portable single `.exe`, unzip & run | Requires complex environment dependencies |

---

## 🛠️ Tech Stack Architecture

* **Core Backend**: Rust, [Tauri v2](https://tauri.app/), `tokio`, `chrono`, `reqwest`, `serde`
* **Frontend UI**: Vanilla JavaScript (ES6+), HTML5, Vanilla CSS (Design Tokens, Dark Theme)
* **Build System & CI/CD**: Node.js, npm, Rust Cargo, GitHub Actions (Multi-arch MSVC runner)

---

## 📦 Local Development & Build

### Prerequisites
- Install [Node.js](https://nodejs.org/) (v18+ recommended)
- Install [Rust Environment](https://www.rust-lang.org/) (includes `cargo`)
- Windows C++ Build Tools (MSVC)

### Run Locally

```bash
# 1. Clone the repository
git clone https://github.com/your-username/TaskModifier.git
cd TaskModifier

# 2. Install frontend/Tauri CLI dependencies
npm install

# 3. Run in dev mode
npm run tauri dev
```

### Build & Package Locally

```bash
# Compile Release executable for the current platform
npm run tauri build
```

The compiled binary will be saved in `src-tauri/target/release/TaskModifier.exe`.

---

## 🤖 GitHub Actions Automated Compilation Guide

This project contains complete GitHub Actions automated compilation scripts:

1. **Version Tag Builds (Tag Triggered)**: Pushing a version tag prefixed with `v` (e.g., `git tag v1.0.0 && git push origin v1.0.0`) automatically starts a build and publishes the compiled `TaskModifier-windows-x64.exe` and `TaskModifier-windows-arm64.exe` to the Releases page.
2. **Manual Builds (`workflow_dispatch`)**: In the GitHub repository page, click **Actions** -> select **Build Windows Executables** -> click **Run workflow** to manually trigger the build.
3. **No Trigger on Standard Pushes**: Regular code commits and pushes without a version tag (e.g., pushing code modifications to main/master) will not trigger auto-builds to avoid consuming resources.

---

## 📄 Open Source License

This project is licensed under the [MIT License](LICENSE).
