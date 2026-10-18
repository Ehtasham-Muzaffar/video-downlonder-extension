# Nova Video Downloader — Chrome Extension (Manifest V3)

A modern, high-performance Chrome Extension built with **Manifest V3** that allows you to easily detect and download videos from **Facebook**, **Instagram**, and universal video websites with 1 click.

---

## 🚀 Key Features

- **⚡ Dual-Layer Detection Engine**:
  - **Network Stream Sniffer**: Intercepts background media requests (`video/mp4`, `video/webm`, HLS `.m3u8`, `.mkv`, etc.) to capture high-definition streams even when embedded in custom players.
  - **DOM Video Scanner**: Automatically detects HTML5 `<video>` elements, posters, resolution tags (`1080p FHD`, `720p HD`), and video duration.
- **✨ In-Page Floating Download Button**:
  - Hover over any video on Facebook, Instagram Reels, or web pages to see a sleek, glassmorphic **`[ ⬇ Download MP4 | 1080p ]`** pill button.
  - 1-click download directly from the video player without opening the extension popup!
  - Can be toggled on/off in Settings.
- **🎬 In-Popup Video Preview**:
  - Watch videos directly in the popup player before downloading to verify audio and video clarity.
- **🎯 Smart Auto-Renaming**:
  - Automatically names downloaded files cleanly with context (e.g., `Instagram_@username_canyon_sunset_20261018.mp4` or `Facebook_Post_Title_20261018.mp4`).
- **📁 Customizable Download Subfolder**:
  - Save all downloaded videos directly to a dedicated folder (e.g., `Downloads/NovaDownloads/`).
- **🛡️ Manifest V3 Compliant**:
  - Lightweight, secure, battery-efficient background service worker with zero memory leaks.

---

## 📦 How to Install in Google Chrome

1. Open Google Chrome.
2. Navigate to:
   ```
   chrome://extensions
   ```
3. Enable **Developer mode** using the toggle switch in the top-right corner.
4. Click the **"Load unpacked"** button in the top-left corner.
5. Select the folder:
   ```
   /home/shami/Desktop/video downlonader extension
   ```
6. The **Nova Video Downloader** extension is now installed! Pin it to your Chrome toolbar by clicking the puzzle icon 🧩 and pinning Nova.

---

## 📖 How to Download Videos

### 1. Facebook Videos & Reels
- Open any Facebook video, Reel, or Watch stream.
- Play the video so the browser initiates the stream buffer.
- Either:
  - **Hover over the video** and click the floating **`⬇ Download`** button on the top right.
  - Or click the **Nova Video Downloader icon** in the Chrome toolbar to see all detected streams and click **Download**.

### 2. Instagram Reels & Posts
- Navigate to Instagram and open a video post or Reel.
- As the Reel plays, click the in-page download pill or open the Nova popup.
- The creator's `@username` and post caption will automatically be included in the file name!

### 3. YouTube Videos
- Due to Google Chrome Web Store policies and Terms of Service, extensions hosted in the Chrome ecosystem are restricted from enabling 1-click downloads for YouTube videos.
- Nova detects YouTube videos, displays their metadata (title, channel, duration), and provides detected stream addresses or copy links.
- For 1-click downloads, Nova works seamlessly across **Facebook, Instagram, TikTok, Twitter/X, Reddit, Vimeo**, and 1000s of other video websites!

### 4. Universal Web Pages (Blogs, News, Video Portals)
- Works on any standard HTML5 or streaming web video.
- Click the extension icon, preview the video, and click **Download**.

---

## 🛠️ Extension Structure

```
video downlonader extension/
├── manifest.json              # Chrome Manifest V3 configuration
├── background.js              # Service worker (webRequest sniffer, badge counter, downloads)
├── content/
│   ├── content.js             # DOM scanner, caption extractor, floating hover buttons
│   └── content.css            # Styles for in-page hover buttons and toasts
├── popup/
│   ├── popup.html             # Sleek glassmorphism popup UI
│   ├── popup.css              # Dark mode styling & animations
│   └── popup.js               # Tab media loader, search filter, preview modal
├── options/
│   ├── options.html           # Settings & platform documentation
│   ├── options.css            # Settings page styles
│   └── options.js             # Preferences persistence
├── icons/                     # Crisp icons (16px, 32px, 48px, 128px)
├── test_demo_page.html        # Interactive local demo page for testing
└── README.md                  # Installation and usage documentation
```
