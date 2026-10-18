/**
 * Nova Video Downloader - Content Script
 * Scans DOM and page markup for Facebook, Instagram, and web video streams,
 * extracts progressive high-quality MP4 URLs, and renders floating download buttons.
 */

(() => {
  if (window.__NOVA_DOWNLOADER_LOADED__) return;
  window.__NOVA_DOWNLOADER_LOADED__ = true;

  let showFloatingButton = true;
  const detectedMediaMap = new Map(); // url -> mediaItem
  let scanDebounceTimer = null;

  // Load user settings
  if (chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.get(['showFloatingBtn'], (cfg) => {
      if (typeof cfg.showFloatingBtn === 'boolean') {
        showFloatingButton = cfg.showFloatingBtn;
      }
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes.showFloatingBtn) {
        showFloatingButton = changes.showFloatingBtn.newValue;
        document.querySelectorAll('.nova-floating-btn-container').forEach(el => {
          el.style.display = showFloatingButton ? 'flex' : 'none';
        });
      }
    });
  }

  // Inject interceptor into main page context as fallback
  try {
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('content/interceptor.js');
    s.onload = () => s.remove();
    (document.head || document.documentElement).appendChild(s);
  } catch (e) {}

  /**
   * Show in-page toast notification
   */
  function showToast(message, isSuccess = true) {
    let toast = document.getElementById('nova-toast-root');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'nova-toast-root';
      toast.className = 'nova-toast-notification';
      document.body.appendChild(toast);
    }

    const iconSvg = isSuccess 
      ? `<svg class="nova-toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>`
      : `<svg class="nova-toast-icon" style="color: #ef4444" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path stroke-linecap="round" d="M12 8v4m0 4h.01"/></svg>`;

    toast.innerHTML = `${iconSvg}<span>${message}</span>`;
    toast.classList.add('nova-toast-visible');

    setTimeout(() => {
      toast.classList.remove('nova-toast-visible');
    }, 3200);
  }

  /**
   * Determine platform name based on hostname
   */
  function getCurrentPlatform() {
    const host = window.location.hostname.toLowerCase();
    if (host.includes('facebook.com')) return 'Facebook';
    if (host.includes('instagram.com')) return 'Instagram';
    if (host.includes('youtube.com')) return 'YouTube';
    if (host.includes('tiktok.com')) return 'TikTok';
    if (host.includes('twitter.com') || host.includes('x.com')) return 'Twitter/X';
    if (host.includes('reddit.com')) return 'Reddit';
    if (host.includes('vimeo.com')) return 'Vimeo';
    return 'Web Video';
  }

  /**
   * Clean and unescape JSON URL strings
   */
  function unescapeUrl(url) {
    if (!url || typeof url !== 'string') return '';
    try {
      return JSON.parse(`"${url}"`);
    } catch (e) {
      return url.replace(/\\\//g, '/').replace(/&amp;/g, '&');
    }
  }

  /**
   * Normalize progressive URL (strip range bytestart/byteend for full video download)
   */
  function normalizeProgressiveUrl(url) {
    if (!url) return '';
    try {
      const unescaped = url.replace(/\\\//g, '/').replace(/&amp;/g, '&');
      const u = new URL(unescaped);
      u.searchParams.delete('bytestart');
      u.searchParams.delete('byteend');
      u.searchParams.delete('range');
      u.searchParams.delete('sq');
      u.hash = '';
      return u.toString();
    } catch (e) {
      return url.replace(/&bytestart=\d+/g, '').replace(/&byteend=\d+/g, '');
    }
  }

  /**
   * Extract contextual title for the video based on platform
   */
  function extractContextualTitle(videoEl) {
    const platform = getCurrentPlatform();
    let title = '';

    if (platform === 'Instagram') {
      const article = videoEl ? videoEl.closest('article, div[role="dialog"]') : document.querySelector('article');
      if (article) {
        const author = article.querySelector('header a, span._ap3a, a.notranslate');
        const caption = article.querySelector('h1, span._a9zs, div._a9zs');
        const authorText = author ? author.innerText.trim() : '';
        const captionText = caption ? caption.innerText.slice(0, 40).trim() : '';
        if (authorText) title = `@${authorText}${captionText ? ' - ' + captionText : ''}`;
      }
    } else if (platform === 'Facebook') {
      const post = videoEl ? videoEl.closest('div[role="article"], div[data-ad-preview="message"], div.x1n2onr6') : document.querySelector('div[role="article"]');
      if (post) {
        const header = post.querySelector('h2, h3, h4, strong');
        const message = post.querySelector('div[dir="auto"], div[data-ad-preview="message"]');
        const headerText = header ? header.innerText.trim() : '';
        const messageText = message ? message.innerText.slice(0, 40).trim() : '';
        if (headerText) title = `${headerText}${messageText ? ' - ' + messageText : ''}`;
        else if (messageText) title = messageText;
      }
    }

    if (!title) {
      title = document.title ? document.title.replace(/\|.*$|- Facebook.*$|- Instagram.*$/i, '').trim() : 'Video';
    }

    return title || `${platform} Video`;
  }

  /**
   * Find poster / thumbnail for video
   */
  function extractThumbnail(videoEl) {
    if (videoEl && videoEl.poster) return videoEl.poster;
    if (videoEl && videoEl.getAttribute('poster')) return videoEl.getAttribute('poster');

    const ogImg = document.querySelector('meta[property="og:image"]');
    if (ogImg && ogImg.content) return ogImg.content;

    const container = videoEl ? (videoEl.closest('article, div[role="article"], div[role="dialog"]') || videoEl.parentElement) : null;
    if (container) {
      const img = container.querySelector('img[src*="fbcdn.net"], img[src*="cdninstagram.com"], img[src*="image"]');
      if (img && img.src) return img.src;
    }
    return '';
  }

  /**
   * Format duration in mm:ss or hh:mm:ss
   */
  function formatDuration(sec) {
    if (!sec || isNaN(sec) || sec === Infinity) return '';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  /**
   * Register detected progressive video and forward to background
   */
  function registerProgressiveVideo(item) {
    if (!item || !item.url) return;
    const clean = normalizeProgressiveUrl(item.url);
    if (!clean.startsWith('http')) return;

    if (detectedMediaMap.has(clean)) {
      const existing = detectedMediaMap.get(clean);
      detectedMediaMap.set(clean, { ...existing, ...item, url: clean });
    } else {
      detectedMediaMap.set(clean, {
        url: clean,
        title: item.title || extractContextualTitle(null),
        poster: item.poster || extractThumbnail(null),
        quality: item.quality || '1080p FHD',
        format: 'MP4',
        platform: item.platform || getCurrentPlatform(),
        duration: item.duration || 0,
        durationFormatted: item.durationFormatted || ''
      });
    }

    // Send update to background
    chrome.runtime.sendMessage({
      action: 'DOM_VIDEOS_FOUND',
      videos: Array.from(detectedMediaMap.values())
    });
  }

  /**
   * Listen for messages from page-context interceptor
   */
  window.addEventListener('message', (event) => {
    if (event.source === window && event.data && event.data.type === 'NOVA_INTERCEPTED_STREAM') {
      const payload = event.data.payload;
      if (payload && payload.url) {
        registerProgressiveVideo(payload);
      }
    }
  });

  /**
   * Scan full page HTML & scripts for video stream URLs
   */
  function scanPageScriptTags() {
    const platform = getCurrentPlatform();
    const rawHtml = document.documentElement.innerHTML || '';
    const unescapedHtml = rawHtml.replace(/\\\//g, '/').replace(/&amp;/g, '&');

    // 1. Direct Regex match for Facebook & Instagram CDN media URLs in HTML
    const cdnRegex = /https?:\/\/[^\s"'\<\>]+?(?:fbcdn\.net|cdninstagram\.com)[^\s"'\<\>]+/g;
    let match;
    while ((match = cdnRegex.exec(unescapedHtml)) !== null) {
      const u = match[0];
      if (u.includes('.mp4') || u.includes('/v/') || u.includes('bytestart')) {
        const clean = normalizeProgressiveUrl(u);
        registerProgressiveVideo({
          url: clean,
          quality: '1080p FHD',
          platform: u.includes('cdninstagram') ? 'Instagram' : 'Facebook'
        });
      }
    }

    // 2. Scan for Facebook native keys
    if (platform === 'Facebook' || unescapedHtml.includes('browser_native_')) {
      const hdRegex = /"browser_native_hd_url"\s*:\s*"([^"]+)"/g;
      const playHdRegex = /"playable_url_quality_hd"\s*:\s*"([^"]+)"/g;
      const sdRegex = /"browser_native_sd_url"\s*:\s*"([^"]+)"/g;
      const playSdRegex = /"playable_url"\s*:\s*"([^"]+)"/g;

      let m;
      while ((m = hdRegex.exec(unescapedHtml)) !== null) {
        registerProgressiveVideo({ url: unescapeUrl(m[1]), quality: '1080p FHD', platform: 'Facebook' });
      }
      while ((m = playHdRegex.exec(unescapedHtml)) !== null) {
        registerProgressiveVideo({ url: unescapeUrl(m[1]), quality: '1080p FHD', platform: 'Facebook' });
      }
      while ((m = sdRegex.exec(unescapedHtml)) !== null) {
        registerProgressiveVideo({ url: unescapeUrl(m[1]), quality: 'SD', platform: 'Facebook' });
      }
      while ((m = playSdRegex.exec(unescapedHtml)) !== null) {
        registerProgressiveVideo({ url: unescapeUrl(m[1]), quality: 'SD', platform: 'Facebook' });
      }
    }

    // 3. Scan for Instagram native keys
    if (platform === 'Instagram' || unescapedHtml.includes('video_versions')) {
      const videoUrlRegex = /"video_url"\s*:\s*"([^"]+)"/g;
      const versionsRegex = /"video_versions"\s*:\s*\[([\s\S]*?)\]/g;

      let m;
      while ((m = videoUrlRegex.exec(unescapedHtml)) !== null) {
        registerProgressiveVideo({ url: unescapeUrl(m[1]), quality: 'HD', platform: 'Instagram' });
      }
      while ((m = versionsRegex.exec(unescapedHtml)) !== null) {
        try {
          const arr = JSON.parse(`[${m[1]}]`);
          for (const item of arr) {
            if (item && item.url) {
              const q = item.height ? `${item.height}p` : '1080p FHD';
              registerProgressiveVideo({ url: item.url, quality: q, platform: 'Instagram' });
            }
          }
        } catch (e) {}
      }
    }

    // 4. OpenGraph video meta tags
    const ogVideo = document.querySelector('meta[property="og:video"], meta[property="og:video:secure_url"], meta[property="og:video:url"]');
    if (ogVideo && ogVideo.content && ogVideo.content.startsWith('http')) {
      registerProgressiveVideo({
        url: ogVideo.content,
        quality: '1080p FHD',
        platform
      });
    }
  }

  /**
   * Get best available progressive URL for a video element, with background fallback
   */
  async function resolveBestUrl(videoEl) {
    // 1. Check direct non-blob src
    let src = videoEl.currentSrc || videoEl.src;
    if (src && !src.startsWith('blob:') && src.startsWith('http')) {
      return normalizeProgressiveUrl(src);
    }

    const source = videoEl.querySelector('source[src]');
    if (source && source.src && !source.src.startsWith('blob:')) {
      return normalizeProgressiveUrl(source.src);
    }

    // 2. Check local extracted media map
    const list = Array.from(detectedMediaMap.values());
    if (list.length > 0) {
      const best = list.find(item => item.quality.includes('1080p')) || list[0];
      if (best && best.url) return best.url;
    }

    // 3. Request sniffed media from background service worker
    try {
      const res = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'GET_TAB_MEDIA' }, resolve);
      });
      if (res && res.media && res.media.length > 0) {
        return res.media[0].url;
      }
    } catch (e) {}

    return '';
  }

  /**
   * Inject floating download button over video container
   */
  function attachFloatingButton(videoEl) {
    if (videoEl.dataset.novaAttached === 'true') return;
    videoEl.dataset.novaAttached = 'true';

    let parent = videoEl.parentElement;
    if (!parent) return;

    const computed = window.getComputedStyle(parent);
    if (computed.position === 'static') {
      parent.classList.add('nova-video-wrapper');
    }

    const btnContainer = document.createElement('div');
    btnContainer.className = 'nova-floating-btn-container';
    btnContainer.style.display = showFloatingButton ? 'flex' : 'none';

    btnContainer.innerHTML = `
      <button type="button" class="nova-download-pill" title="Download this video in full HD">
        <svg viewBox="0 0 24 24">
          <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/>
        </svg>
        <span>Download</span>
        <span class="nova-download-badge">1080p</span>
      </button>
    `;

    const button = btnContainer.querySelector('.nova-download-pill');
    button.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      scanPageScriptTags();

      const platform = getCurrentPlatform();
      const title = extractContextualTitle(videoEl);
      const targetUrl = await resolveBestUrl(videoEl);

      if (!targetUrl) {
        showToast('Stream detected! Click Nova icon in toolbar to download.', true);
        chrome.runtime.sendMessage({ action: 'FORCE_SCAN_TAB' });
        return;
      }

      showToast(`Starting full HD download: ${platform} Video...`);

      const cleanFilename = `${platform}_${title.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 40)}.mp4`;

      chrome.runtime.sendMessage({
        action: 'DOWNLOAD_MEDIA',
        url: targetUrl,
        filename: cleanFilename,
        platform
      }, (res) => {
        if (res && res.success) {
          showToast(`✓ Download started in full HD!`);
        } else {
          showToast(`Download initiated via browser.`);
        }
      });
    });

    parent.appendChild(btnContainer);
  }

  /**
   * Scan DOM for HTML5 <video> elements
   */
  function scanVideos() {
    scanPageScriptTags();

    const videos = Array.from(document.querySelectorAll('video'));
    for (const v of videos) {
      attachFloatingButton(v);

      let src = v.currentSrc || v.src;
      if (src && !src.startsWith('blob:') && src.startsWith('http')) {
        const poster = extractThumbnail(v);
        const title = extractContextualTitle(v);
        const duration = v.duration && !isNaN(v.duration) ? Math.round(v.duration) : 0;
        const durationFormatted = formatDuration(duration);
        const height = v.videoHeight || 0;
        let quality = 'HD';
        if (height >= 1080) quality = '1080p FHD';
        else if (height >= 720) quality = '720p HD';

        registerProgressiveVideo({
          url: src,
          title,
          poster,
          duration,
          durationFormatted,
          quality,
          platform: getCurrentPlatform()
        });
      }
    }

    return detectedMediaMap.size;
  }

  function scheduleScan() {
    if (scanDebounceTimer) clearTimeout(scanDebounceTimer);
    scanDebounceTimer = setTimeout(() => {
      scanVideos();
    }, 400);
  }

  // Initial scan
  scanVideos();

  // Watch for dynamic infinite scroll / post injection (Reels, Feed, etc.)
  const observer = new MutationObserver(() => {
    scheduleScan();
  });

  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true
  });

  // Listen for messages from popup and background
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'SCAN_VIDEOS_NOW') {
      const count = scanVideos();
      sendResponse({ count, media: Array.from(detectedMediaMap.values()) });
    } else if (msg.action === 'GET_PAGE_VIDEOS') {
      scanVideos();
      sendResponse({ media: Array.from(detectedMediaMap.values()) });
    }
  });
})();
