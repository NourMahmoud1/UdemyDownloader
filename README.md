<div align="center">

<img src="logo.png" alt="Udemy Downloader Logo" width="96" height="96" />

# Udemy Downloader

**A production-grade Chrome / Edge browser extension for downloading Udemy course content.**

[![Manifest Version](https://img.shields.io/badge/Manifest-v3-blue?style=flat-square)](https://developer.chrome.com/docs/extensions/mv3/)
[![Version](https://img.shields.io/badge/Version-1.0.0-teal?style=flat-square)](./manifest.json)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](./LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Chrome%20%7C%20Edge-orange?style=flat-square)](#installation)

Download course videos, articles, subtitles, and supplementary assets — all from inside the browser with zero external tools required.

</div>

---

## Table of Contents

- [Features](#features)
- [Screenshots](#screenshots)
- [Architecture](#architecture)
- [Installation](#installation)
- [Usage Guide](#usage-guide)
- [Configuration Options](#configuration-options)
- [Download Tracker Sheet](#download-tracker-sheet)
- [DRM & Limitations](#drm--limitations)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Module Reference](#module-reference)
- [Known Issues & Troubleshooting](#known-issues--troubleshooting)
- [Contributing](#contributing)
- [License](#license)

---

## Features

### Core Downloading
- **Video downloads** at any quality — Highest, Lowest, or a specific resolution (1080p, 720p, 480p, 360p)
- **Article downloads** exported as self-contained, styled HTML files
- **Subtitle / caption downloads** in any available language (`.vtt` format)
- **Supplementary assets** — PDFs, source code archives, presentation slides, and other attached files
- **Bulk download queue** — sequentially processes an entire course or a hand-picked selection

### Smart Queue Management
- **Skip already-downloaded files** — persistent completion log per course prevents re-downloading
- **Automatic retry** — up to 3 attempts on interrupted downloads with exponential back-off
- **Queue cancellation** — stop a bulk run at any time with a single click
- **Configurable delays** — adjustable per-request and per-download delay to be gentle on Udemy servers

### Real-time Progress Tracking
- **Per-file progress bar** with smooth animation in every table row
- **Live transfer stats** — downloaded / total size, current speed (KB/s or MB/s), and ETA
- **Overall queue progress bar** — shows X of Y files complete across the entire session
- **Visual status indicators** — colour-coded download buttons (downloading → complete → failed)

### Content Discovery
- **Automatic course list** — fetches all subscribed courses on login with pagination support
- **Full playlist builder** — resolves chapters, lecture order, types, and all metadata in one pass
- **API response caching** — courses and playlists are stored in LocalStorage to avoid redundant network calls
- **Corporate / B2B account support** — auto-detects custom Udemy subdomains and falls back from `stream_urls` to `download_urls` for enterprise accounts

### Excel Tracker Sheet
- One-click `.xlsx` tracker generated alongside every bulk download
- 8 columns: `#`, `Lecture Title`, `Type`, `Duration`, `Size`, `Status`, `Rating`, `Notes`
- Dropdown validations for Status (`Not Started / In Progress / Completed / Skipped`) and Rating (⭐1–5)
- Live `% Complete` formula — auto-updates as you tick off lectures in Excel
- Frozen header row + first two columns for comfortable scrolling through large courses
- Alternating row tints, chapter dividers, and a bold totals row

### Design & UX
- **Ocean Depths design system** — maritime teal palette with glassmorphism surfaces
- **Responsive layout** — sidebar collapses automatically on narrow viewports
- **DRM badge** — yellow `DRM` badge on Widevine-protected lectures with a clear count in the toolbar
- **Accessible** — ARIA attributes on all progress bars; Lucide icon set throughout

---

## Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│                         Popup UI (popup.html)                     │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │   app.js     │  │    ui.js     │  │   sheet-generator.js   │  │
│  │  Controller  │  │  Renderer    │  │   Excel Tracker        │  │
│  └──────┬───────┘  └──────┬───────┘  └────────────────────────┘  │
│         │                 │                                        │
│  ┌──────▼───────┐  ┌──────▼──────────────────────────────────┐   │
│  │   api.js     │  │         download-manager.js              │   │
│  │  Udemy REST  │  │  Queue · Poller · Retry · Progress UI    │   │
│  └──────┬───────┘  └──────┬──────────────────────────────────┘   │
│         │                 │                                        │
│  ┌──────▼─────────────────▼──────────────────┐                   │
│  │          storage.js + utils.js             │                   │
│  │  LocalStorage · Path builder · Formatters  │                   │
│  └───────────────────────────────────────────┘                   │
└──────────────────────┬────────────────────────────────────────────┘
                       │ chrome.downloads / chrome.cookies / chrome.notifications
                       ▼
             ┌─────────────────────┐
             │  createWindow.js    │
             │  MV3 Service Worker │
             └─────────────────────┘
```

**Data flow:**

1. `app.js` reads cookies → `api.js` resolves the Udemy domain and fetches courses
2. On course selection, `api.js` fetches the playlist and normalises every lecture into a common video object
3. `ui.js` renders the normalised list into a searchable, paginated DataTable
4. On download, `download-manager.js` builds a flat queue of `{ url, filename }` items and processes them one-by-one via `chrome.downloads`
5. A 500ms poller reads `chrome.downloads.search` to update the per-row progress bar and stats
6. Completion state is persisted to LocalStorage by `storage.js`

---

## Installation

> **Requirements:** Google Chrome 109+ or Microsoft Edge 109+  
> The extension uses Manifest V3 and requires no Node.js, Python, or external tools.

### Method 1 — Load unpacked (recommended for development)

1. **Download or clone** this repository to a local folder.
2. Open your browser and navigate to `chrome://extensions` (or `edge://extensions`).
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked**.
5. Select the root folder of this repository (the one containing `manifest.json`).
6. The extension icon will appear in the toolbar.

### Method 2 — Install from `.crx`

1. Download `UdemyDownloader.crx` from this repository.
2. Drag and drop the `.crx` file onto `chrome://extensions`.
3. Confirm the installation prompt.

> **Note:** Chrome may block `.crx` installs from outside the Web Store. If so, use Method 1.

---

## Usage Guide

### Step 1 — Log in to Udemy

Make sure you are logged in to [udemy.com](https://www.udemy.com) in the same browser profile. The extension reads your authentication cookies automatically — no password prompt is shown.

### Step 2 — Open the extension

Click the **Udemy Downloader** icon in the toolbar. The extension will verify your login. If no session is detected, a Udemy login tab will open automatically.

### Step 3 — Load your courses

Click **My Courses**. Your subscribed course list will load and be cached for future sessions.

### Step 4 — Open a course playlist

Click any course card to load its full lecture list. The extension fetches every lecture's stream URLs, captions, and assets. A progress counter shows how many lectures have been resolved.

### Step 5 — Download

**Single file:**  
Click the **Download** button in any row to download that lecture immediately at the default quality.

**Selected files:**  
Check the checkboxes in the first column, then click **Download Selected Videos** in the toolbar.

**Entire course (bulk):**  
Click the **Bulk Download** button and configure:
- **Video quality** — Highest, Lowest, or a specific resolution
- **Subtitle language** — any available caption locale, or none
- **Include supplementary assets** — PDFs, source code, slides

Click **Start Bulk Download** to begin. The tracker Excel sheet is generated automatically alongside the download.

### Step 6 — Track progress

While downloading you will see:
- A **teal progress bar** in each row filling in real time
- A **stats line** showing `downloaded / total · speed · ETA`
- An **overall progress bar** at the top of the table showing queue completion

When all files finish, a browser notification confirms completion.

---

## Configuration Options

Open the extension's **Options** page (right-click the toolbar icon → Options, or navigate to `options.html`) to configure:

| Option | Description | Default |
|---|---|---|
| **Default download folder** | Root folder for all downloads. Use an absolute path like `F:/Udemy_Download`. | `Udemy/` |
| **Naming template** | Path template for each file. Supports `{instructor}`, `{course}`, `{chapter}`, `{video_index}`, `{video_title}`. | `{instructor}/{course}/{chapter}/{video_index}. {video_title}` |
| **API request delay** | Milliseconds to wait between lecture detail API calls (prevents rate limiting). | `500` |
| **Download delay** | Milliseconds to wait between successive downloads in a bulk queue. | `1000` |
| **Default quality** | Preferred video resolution for bulk downloads. | `highest` |

### Naming template examples

| Template | Result |
|---|---|
| `{instructor}/{course}/{chapter}/{video_index}. {video_title}` | `Hussein Nasser/Fundamentals of OS/1. Before we start/1. Welcome.mp4` |
| `{course}/{video_index} - {video_title}` | `Fundamentals of OS/1 - Welcome.mp4` |
| `Downloads/{course}/{chapter}/{video_title}` | `Downloads/Fundamentals of OS/1. Before we start/Welcome.mp4` |

---

## Download Tracker Sheet

Every bulk download automatically generates an Excel workbook (`.xlsx`) alongside the downloaded files. You can also generate it manually from the **Bulk Download** menu without starting a download.

### Sheet layout

| Column | Content |
|---|---|
| `#` | Lecture index |
| `Lecture Title` | Full lecture title (HTML-safe) |
| `Type` | Video · Article · File · Link |
| `Duration` | Formatted as `Xm XXs` or `Xh XXm` |
| `Size` | File size (populated when available) |
| `Status` | Dropdown: **Not Started** / In Progress / Completed / Skipped |
| `Rating` | Dropdown: ⭐1 – ⭐⭐⭐⭐⭐5 |
| `Notes` | Free-text notes cell |

### Dashboard summary (rows 4–7)

The top of the sheet contains a summary block with:
- Total lecture count
- Total course duration
- Completed lecture count (editable)
- **% Complete** — a live Excel formula (`COUNTIF`) that auto-updates as you change Status cells

### Tips

- Change a **Status** cell to `Completed` and the `% Complete` cell updates automatically.
- The header row (row 9) and the first two columns (`#` and `Lecture Title`) are **frozen** for comfortable scrolling through large courses.
- Chapter divider rows are styled in dark teal so you can visually scan the curriculum structure at a glance.

---

## DRM & Limitations

### DRM-protected content

Some Udemy courses are protected with **Widevine DRM**. The extension detects these automatically and marks them with a yellow `DRM` badge. A counter in the toolbar shows how many DRM lectures are in the current course.

**Why can't DRM lectures be downloaded?**  
Widevine decryption keys live inside Chrome's sandboxed Content Decryption Module (CDM) — a native OS process that is completely inaccessible to browser extensions, JavaScript, or any web API. The encrypted video segments are delivered to Chrome directly; the decrypted frames never pass through any interceptable interface. No extension-level workaround exists for Widevine-protected content.

Non-DRM lectures in the same course download normally.

### Other limitations

| Limitation | Reason |
|---|---|
| Videos are downloaded one at a time | `chrome.downloads` does not expose a reliable parallel-download API; sequential downloads are more stable and resumable |
| Download folder must be under the browser's Downloads directory | Chrome's `chrome.downloads.download()` API only accepts paths relative to the user's Downloads folder; absolute paths are stripped automatically |
| Course list is cached per session | Reloading the extension clears the cache; use **Clear Download Cache** in the Bulk Download menu to reset the per-course completion log |
| Maximum ~1400 lectures per API call | Udemy's curriculum API has a hard page size limit; very large courses may need multiple fetches |

---

## Development Setup

No build step is required. The extension is plain HTML, CSS, and vanilla JavaScript.

```bash
# Clone the repository
git clone https://github.com/your-username/UdemyDownloader.git
cd UdemyDownloader

# Open in your editor
code .
```

Load the folder as an unpacked extension (see [Installation](#installation)), then edit any file and click **Reload** on the Extensions page to apply changes.

### Code style

- ES2020+ features are used throughout (async/await, optional chaining, nullish coalescing)
- No bundler or transpiler — files are loaded via `<script>` tags in `popup.html`
- JSDoc comments on all public methods
- All DOM queries inside the hot polling path use cached jQuery references to avoid layout thrashing

### Debugging

Open DevTools on the extension popup:
```
Right-click the extension icon → Inspect popup
```

All modules prefix their console output:
```
[UdemyAPI]         → api.js
[DownloadManager]  → download-manager.js
[SheetGenerator]   → sheet-generator.js
[App]              → app.js
[UDL]              → Logger (utils.js)
```

Set `Logger.level = 0` in the console to enable verbose debug output.

---

## Project Structure

```
UdemyDownloader/
│
├── manifest.json              # MV3 extension manifest
├── popup.html                 # Main extension UI
├── options.html               # Settings page
├── createWindow.js            # MV3 service worker (background)
├── logo.png                   # Extension icon (source)
│
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
│
├── css/
│   └── custom.css             # Ocean Depths design system
│
├── js/
│   ├── app.js                 # Main controller — auth, events, data loading
│   ├── api.js                 # All Udemy REST API communication
│   ├── download-manager.js    # Queue, retry, progress polling, UI feedback
│   ├── ui.js                  # DataTable rendering, course/playlist views
│   ├── storage.js             # LocalStorage persistence layer
│   ├── utils.js               # Path builder, formatters, Logger
│   └── sheet-generator.js     # Excel tracker workbook generation
│
└── Plugins/
    └── xlsx.full.min.js       # SheetJS CE — Excel file generation
```

---

## Module Reference

### `api.js` — `UdemyAPI`

| Method | Description |
|---|---|
| `initFromCookies(onReady)` | Reads browser cookies, resolves Udemy domain (including corporate subdomains), calls `onReady(isLoggedIn)` |
| `fetchCourses()` | Returns subscribed course list (cached in LocalStorage) |
| `fetchPlaylist(courseId)` | Returns raw curriculum item list (cached per course) |
| `fetchVideoDetails(courseId, lectureId)` | Returns stream URLs, captions, asset details for one lecture |
| `buildVideoList(courseId, onProgress)` | Orchestrates full playlist build; returns normalised video array |

### `download-manager.js` — `DownloadManager`

| Method | Description |
|---|---|
| `buildQueue(videos, courseDetail, opts)` | Converts normalised video list into flat download queue |
| `startSequential(queue, courseId, onComplete)` | Runs the queue one item at a time with retry and progress UI |
| `cancelQueue()` | Sets cancellation flag and cancels the active `chrome.downloads` item |
| `_pollProgress(downId)` | 500ms poller — updates progress bar, speed, and ETA |
| `_onDownloadFinished(status)` | Updates row button and stats on complete / failed / retrying |

### `utils.js`

| Export | Description |
|---|---|
| `sanitizeFilename(str)` | Strips characters illegal in Windows/macOS file paths |
| `buildPath(template, video, course, ext, titleOverride)` | Expands a naming template into a full relative file path |
| `formatBytes(bytes, decimals)` | `1572864` → `"1.5 MB"` |
| `formatSpeed(bps)` | `3145728` → `"3.0 MB/s"` |
| `formatETA(seconds)` | `195` → `"3m 15s remaining"` |
| `Logger` | Levelled console logger; set `Logger.level` to filter output |

### `storage.js` — `Storage`

| Method | Description |
|---|---|
| `getSetting(key)` | Returns a user-configured option from LocalStorage |
| `save(key, value)` | Serialises and stores a value |
| `load(key)` | Deserialises and returns a stored value |
| `markDownloaded(path, courseId)` | Records a file as successfully downloaded |
| `isDownloaded(path, courseId)` | Returns `true` if the file is already in the completion log |
| `clearDownloadLog(courseId)` | Removes the completion log for a specific course |

---

## Known Issues & Troubleshooting

### "Invalid filename" error in the console

Chrome's download API rejects paths that contain a Windows drive prefix (e.g. `F:/`). The extension strips this automatically. If you see this error, check that your **Default download folder** in Options does **not** start with a drive letter — use a relative path like `Udemy_Download/` instead, and Chrome will place it inside your system Downloads folder.

### Downloads not starting after a page reload

The extension's LocalStorage cache may be stale. Click **Clear Download Cache** from the Bulk Download menu, then reload the course playlist.

### Course list is empty

Your Udemy session may have expired. Visit [udemy.com](https://www.udemy.com), log in again, then re-open the extension.

### Subtitles not downloading

Udemy's caption URLs are signed and expire. If you loaded a playlist a long time ago, the caption URLs may have expired. Reload the playlist to refresh the signed URLs.

### "DRM" badge on all videos in a course

The entire course is Widevine-protected. See [DRM & Limitations](#drm--limitations) — these videos cannot be downloaded through any browser extension.

### Extension is slow on large courses (200+ lectures)

The `api_delay` setting controls how long the extension waits between lecture detail API calls. Increasing this value reduces the risk of Udemy temporarily rate-limiting your account, at the cost of a longer initial load time.

---

## Contributing

Contributions are welcome. Please follow these guidelines:

1. **Fork** the repository and create a feature branch (`git checkout -b feature/my-feature`).
2. Keep changes **focused** — one feature or fix per pull request.
3. Follow the existing **code style** — ES2020+, JSDoc on public methods, named constants over magic strings.
4. Test with both a **regular** Udemy account and, if possible, a **corporate (B2B)** account.
5. Open a **pull request** with a clear description of what changed and why.

### Reporting bugs

Please include:
- Browser name and version
- Extension version (`v` number shown in the sidebar)
- The exact error message from DevTools → Console
- Whether the affected course is DRM-protected

---

## License

This project is licensed under the **MIT License** — see the [LICENSE](./LICENSE) file for details.

---

<div align="center">

Built with the **Ocean Depths** design system · Powered by [SheetJS CE](https://sheetjs.com/) · Icons by [Lucide](https://lucide.dev/)

If this project saved you time, please ⭐ star the repository — it helps others find it.

</div>
