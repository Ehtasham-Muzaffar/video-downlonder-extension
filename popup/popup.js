/**
 * Nova Video Downloader - Popup Script
 * Manages active tab state, video rendering, filtering, resilient preview player, and downloads.
 */

document.addEventListener('DOMContentLoaded', () => {
  let activeTab = null;
  let allMedia = [];
  let currentPreviewItem = null;
  let currentBlobUrl = null;

  // DOM Elements
  const siteTitleEl = document.getElementById('site-title');
  const videoCountBadgeEl = document.getElementById('video-count-badge');
  const videoListEl = document.getElementById('video-list');
  const emptyStateEl = document.getElementById('empty-state');
  const youtubeBannerEl = document.getElementById('youtube-banner');
  const searchInputEl = document.getElementById('search-input');
  const btnClearSearchEl = document.getElementById('btn-clear-search');
  const btnClearAllEl = document.getElementById('btn-clear-all');
  const btnScanEl = document.getElementById('btn-scan');
  const btnOptionsEl = document.getElementById('btn-options');
  const toastEl = document.getElementById('toast');
  const toastTextEl = document.getElementById('toast-text');

  // Modal Elements
  const previewModalEl = document.getElementById('preview-modal');
  const modalCloseBtnEl = document.getElementById('modal-close-btn');
  const modalVideoPlayerEl = document.getElementById('modal-video-player');
  const modalVideoTitleEl = document.getElementById('modal-video-title');
  const modalQualityBadgeEl = document.getElementById('modal-quality-badge');
  const modalSizeBadgeEl = document.getElementById('modal-size-badge');
  const modalDownloadBtnEl = document.getElementById('modal-download-btn');
  const modalLoaderEl = document.getElementById('modal-loader');
  const modalErrorFallbackEl = document.getElementById('modal-error-fallback');
  const modalFallbackOpenTabBtn = document.getElementById('modal-fallback-open-tab');

  /**
   * Display toast message
   */
  let toastTimer = null;
  function showToast(msg) {
    if (toastTimer) clearTimeout(toastTimer);
    toastTextEl.textContent = msg;
    toastEl.classList.remove('hidden');
    toastTimer = setTimeout(() => {
      toastEl.classList.add('hidden');
    }, 2800);
  }

  /**
   * Determine platform name & styling class from URL
   */
  function parsePlatformInfo(url = '') {
    const u = url.toLowerCase();
    if (u.includes('facebook.com') || u.includes('fbcdn.net') || u.includes('fb.watch')) {
      return { name: 'Facebook', tagClass: 'tag-fb' };
    }
    if (u.includes('instagram.com') || u.includes('cdninstagram.com')) {
      return { name: 'Instagram', tagClass: 'tag-insta' };
    }
    if (u.includes('youtube.com') || u.includes('youtu.be')) {
      return { name: 'YouTube', tagClass: 'tag-yt' };
    }
    if (u.includes('tiktok.com')) {
      return { name: 'TikTok', tagClass: 'tag-tiktok' };
    }
    return { name: 'Web Video', tagClass: 'tag-web' };
  }

  /**
   * Render video list
   */
  function renderMediaList(items) {
    videoListEl.innerHTML = '';
    const query = (searchInputEl.value || '').trim().toLowerCase();

    const filtered = items.filter(item => {
      if (!query) return true;
      const titleMatch = (item.title || '').toLowerCase().includes(query);
      const formatMatch = (item.format || '').toLowerCase().includes(query);
      const qualityMatch = (item.quality || '').toLowerCase().includes(query);
      const platformMatch = (item.platform || '').toLowerCase().includes(query);
      return titleMatch || formatMatch || qualityMatch || platformMatch;
    });

    videoCountBadgeEl.textContent = `${filtered.length} Found`;

    if (filtered.length === 0) {
      emptyStateEl.classList.remove('hidden');
      videoListEl.classList.add('hidden');
      return;
    }

    emptyStateEl.classList.add('hidden');
    videoListEl.classList.remove('hidden');

    filtered.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'video-card';

      const platformInfo = parsePlatformInfo(item.url || (activeTab ? activeTab.url : ''));
      const displayTitle = item.title || `${platformInfo.name} Video`;
      const quality = item.quality || '1080p FHD';
      const format = item.format || 'MP4';
      const sizeStr = item.sizeFormatted || (item.size > 0 ? `${(item.size / 1048576).toFixed(1)} MB` : 'Full Video');

      let thumbHtml = `
        <div class="thumb-placeholder">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z"/>
          </svg>
        </div>
      `;
      if (item.poster) {
        thumbHtml = `<img src="${item.poster}" alt="Preview" class="thumb-img" onerror="this.style.display='none'">`;
      }

      const durationHtml = item.durationFormatted 
        ? `<span class="thumb-duration">${item.durationFormatted}</span>` 
        : '';

      card.innerHTML = `
        <div class="card-top">
          <div class="thumb-container">
            ${thumbHtml}
            ${durationHtml}
          </div>
          <div class="video-info">
            <div>
              <span class="platform-tag ${platformInfo.tagClass}">${item.platform || platformInfo.name}</span>
              <h3 class="video-title" title="${escapeHtml(displayTitle)}">${escapeHtml(displayTitle)}</h3>
            </div>
            <div class="meta-badges">
              <span class="badge badge-quality">${escapeHtml(quality)}</span>
              <span class="badge badge-format">${escapeHtml(format)}</span>
              <span class="badge badge-size">${escapeHtml(sizeStr)}</span>
            </div>
          </div>
        </div>

        <div class="card-actions">
          <button class="btn btn-primary btn-download" title="Download full HD video">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/>
            </svg>
            Download HD
          </button>
          
          <button class="btn btn-secondary btn-preview" title="Watch preview in popup">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
            Preview
          </button>

          <button class="btn btn-secondary btn-copy" title="Copy video stream link">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
          </button>

          <button class="btn btn-secondary btn-open-tab" title="Open video in new tab">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </button>
        </div>
      `;

      const btnDownload = card.querySelector('.btn-download');
      btnDownload.addEventListener('click', () => {
        triggerDownload(item);
      });

      const btnPreview = card.querySelector('.btn-preview');
      btnPreview.addEventListener('click', () => {
        openPreviewModal(item);
      });

      const btnCopy = card.querySelector('.btn-copy');
      btnCopy.addEventListener('click', () => {
        navigator.clipboard.writeText(item.url).then(() => {
          showToast('Video link copied to clipboard!');
          btnCopy.style.color = '#10b981';
          setTimeout(() => {
            btnCopy.style.color = '';
          }, 1500);
        });
      });

      const btnOpenTab = card.querySelector('.btn-open-tab');
      btnOpenTab.addEventListener('click', () => {
        chrome.tabs.create({ url: item.url });
      });

      videoListEl.appendChild(card);
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function triggerDownload(item) {
    showToast(`Starting download: ${item.platform || 'Video'}...`);

    const cleanTitle = (item.title || 'Video')
      .replace(/[/\\?%*:|"<>]/g, '_')
      .slice(0, 40)
      .trim();
    const ext = (item.format || 'mp4').toLowerCase();
    const filename = `${item.platform || 'Nova'}_${cleanTitle}_${Date.now()}.${ext}`;

    chrome.runtime.sendMessage({
      action: 'DOWNLOAD_MEDIA',
      url: item.url,
      filename,
      platform: item.platform || 'Nova'
    }, (res) => {
      if (res && res.success) {
        showToast('✓ Full video download started!');
      } else {
        showToast(res && res.error ? `Error: ${res.error}` : 'Download initiated.');
      }
    });
  }

  async function openPreviewModal(item) {
    currentPreviewItem = item;
    modalVideoTitleEl.textContent = item.title || 'Video Preview';
    modalQualityBadgeEl.textContent = item.quality || '1080p FHD';
    modalSizeBadgeEl.textContent = item.sizeFormatted || 'Full Video';

    modalLoaderEl.classList.remove('hidden');
    modalErrorFallbackEl.classList.add('hidden');
    modalVideoPlayerEl.style.display = 'block';

    if (currentBlobUrl) {
      URL.revokeObjectURL(currentBlobUrl);
      currentBlobUrl = null;
    }

    previewModalEl.classList.remove('hidden');

    modalVideoPlayerEl.oncanplay = () => {
      modalLoaderEl.classList.add('hidden');
      modalVideoPlayerEl.play().catch(() => {});
    };

    modalVideoPlayerEl.onerror = async () => {
      console.warn('Direct preview blocked, fetching blob...');
      try {
        const resp = await fetch(item.url, { mode: 'cors' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        currentBlobUrl = URL.createObjectURL(blob);
        modalVideoPlayerEl.src = currentBlobUrl;
        modalLoaderEl.classList.add('hidden');
        modalVideoPlayerEl.play().catch(() => {});
      } catch (err) {
        console.error('Blob fetch failed:', err);
        modalLoaderEl.classList.add('hidden');
        modalVideoPlayerEl.style.display = 'none';
        modalErrorFallbackEl.classList.remove('hidden');
      }
    };

    modalVideoPlayerEl.src = item.url;
  }

  function closePreviewModal() {
    modalVideoPlayerEl.pause();
    modalVideoPlayerEl.removeAttribute('src');
    modalVideoPlayerEl.load();
    if (currentBlobUrl) {
      URL.revokeObjectURL(currentBlobUrl);
      currentBlobUrl = null;
    }
    previewModalEl.classList.add('hidden');
    currentPreviewItem = null;
  }

  modalCloseBtnEl.addEventListener('click', closePreviewModal);
  previewModalEl.addEventListener('click', (e) => {
    if (e.target === previewModalEl) closePreviewModal();
  });

  modalFallbackOpenTabBtn.addEventListener('click', () => {
    if (currentPreviewItem && currentPreviewItem.url) {
      chrome.tabs.create({ url: currentPreviewItem.url });
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !previewModalEl.classList.contains('hidden')) {
      closePreviewModal();
    }
  });

  modalDownloadBtnEl.addEventListener('click', () => {
    if (currentPreviewItem) {
      triggerDownload(currentPreviewItem);
      closePreviewModal();
    }
  });

  /**
   * Load media for current tab by querying BOTH background service worker & content script
   */
  function loadMedia() {
    if (!activeTab || !activeTab.id) return;

    // 1. Query background
    chrome.runtime.sendMessage({
      action: 'GET_TAB_MEDIA',
      tabId: activeTab.id
    }, (res) => {
      const bgMedia = (res && res.media) ? res.media : [];

      // 2. Query content script
      chrome.tabs.sendMessage(activeTab.id, { action: 'GET_PAGE_VIDEOS' }, (domRes) => {
        const pageMedia = (domRes && domRes.media) ? domRes.media : [];

        // Deduplicate and merge
        const mergedMap = new Map();
        for (const item of [...bgMedia, ...pageMedia]) {
          if (item && item.url) {
            mergedMap.set(item.url, item);
          }
        }

        allMedia = Array.from(mergedMap.values());
        renderMediaList(allMedia);
      });
    });
  }

  searchInputEl.addEventListener('input', () => {
    if (searchInputEl.value.trim().length > 0) {
      btnClearSearchEl.classList.remove('hidden');
    } else {
      btnClearSearchEl.classList.add('hidden');
    }
    renderMediaList(allMedia);
  });

  btnClearSearchEl.addEventListener('click', () => {
    searchInputEl.value = '';
    btnClearSearchEl.classList.add('hidden');
    renderMediaList(allMedia);
  });

  btnClearAllEl.addEventListener('click', () => {
    if (!activeTab || !activeTab.id) return;
    chrome.runtime.sendMessage({
      action: 'CLEAR_TAB_MEDIA',
      tabId: activeTab.id
    }, () => {
      allMedia = [];
      renderMediaList([]);
      showToast('Media list cleared');
    });
  });

  btnScanEl.addEventListener('click', () => {
    if (!activeTab || !activeTab.id) return;
    btnScanEl.classList.add('spin-anim');

    chrome.tabs.sendMessage(activeTab.id, { action: 'SCAN_VIDEOS_NOW' }, () => {
      setTimeout(() => {
        btnScanEl.classList.remove('spin-anim');
        loadMedia();
        showToast('Page re-scanned for videos');
      }, 500);
    });
  });

  btnOptionsEl.addEventListener('click', () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
    }
  });

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs[0]) {
      activeTab = tabs[0];
      const url = activeTab.url || '';
      
      try {
        const parsed = new URL(url);
        let domain = parsed.hostname.replace(/^www\./, '');
        if (domain.includes('facebook.com')) siteTitleEl.textContent = 'Facebook';
        else if (domain.includes('instagram.com')) siteTitleEl.textContent = 'Instagram';
        else if (domain.includes('youtube.com')) {
          siteTitleEl.textContent = 'YouTube';
          youtubeBannerEl.classList.remove('hidden');
        } else {
          siteTitleEl.textContent = domain || 'Active Page';
        }
      } catch (e) {
        siteTitleEl.textContent = 'Active Page';
      }

      loadMedia();

      // Trigger instant scan in content script
      chrome.tabs.sendMessage(activeTab.id, { action: 'SCAN_VIDEOS_NOW' }, () => {
        loadMedia();
      });
    }
  });
});
