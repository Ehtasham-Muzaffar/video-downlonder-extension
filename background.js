/**
 * Nova Video Downloader - Service Worker (Manifest V3)
 * Handles declarative network rules for CORS/Referer bypass, media stream registry,
 * range normalization, badge updates, and downloads.
 */

// In-memory cache for fast access, backed by chrome.storage
const tabMedia = new Map();

// Helper to determine storage engine (session or local)
const getStorage = () => (chrome.storage && chrome.storage.session ? chrome.storage.session : chrome.storage.local);

// Setup Declarative Net Request rules to bypass CDN hotlink & CORS restrictions
async function setupDNRRules() {
  if (!chrome.declarativeNetRequest) return;
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [1, 2],
      addRules: [
        {
          id: 1,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            responseHeaders: [
              { header: 'Access-Control-Allow-Origin', operation: 'set', value: '*' },
              { header: 'Cross-Origin-Resource-Policy', operation: 'set', value: 'cross-origin' }
            ],
            requestHeaders: [
              { header: 'Referer', operation: 'set', value: 'https://www.facebook.com/' }
            ]
          },
          condition: {
            urlFilter: '*fbcdn.net*',
            resourceTypes: ['media', 'xmlhttprequest', 'other']
          }
        },
        {
          id: 2,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            responseHeaders: [
              { header: 'Access-Control-Allow-Origin', operation: 'set', value: '*' },
              { header: 'Cross-Origin-Resource-Policy', operation: 'set', value: 'cross-origin' }
            ],
            requestHeaders: [
              { header: 'Referer', operation: 'set', value: 'https://www.instagram.com/' }
            ]
          },
          condition: {
            urlFilter: '*cdninstagram.com*',
            resourceTypes: ['media', 'xmlhttprequest', 'other']
          }
        }
      ]
    });
  } catch (err) {}
}

setupDNRRules();

// Video MIME types to detect
const VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
  'video/x-matroska',
  'application/x-mpegurl',
  'application/vnd.apple.mpegurl'
];

// URL extensions to detect
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mkv', '.mov', '.m4v', '.m3u8'];

/**
 * Format bytes into human readable string (e.g. 14.5 MB)
 */
function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return 'Full Video';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Clean URL and remove range query parameters (bytestart/byteend) so full file is downloaded
 */
function normalizeUrl(url) {
  if (!url) return '';
  try {
    const unescaped = url.replace(/\\\//g, '/').replace(/&amp;/g, '&');
    const parsed = new URL(unescaped);
    parsed.searchParams.delete('bytestart');
    parsed.searchParams.delete('byteend');
    parsed.searchParams.delete('range');
    parsed.searchParams.delete('sq');
    parsed.hash = '';
    return parsed.toString();
  } catch (e) {
    return url.replace(/&bytestart=\d+/g, '').replace(/&byteend=\d+/g, '');
  }
}

/**
 * Detect platform from URL or initiator
 */
function detectPlatform(url, tabUrl = '') {
  const combined = (url + ' ' + tabUrl).toLowerCase();
  if (combined.includes('facebook.com') || combined.includes('fbcdn.net') || combined.includes('fb.watch')) {
    return 'Facebook';
  }
  if (combined.includes('instagram.com') || combined.includes('cdninstagram.com')) {
    return 'Instagram';
  }
  if (combined.includes('youtube.com') || combined.includes('youtu.be') || combined.includes('googlevideo.com')) {
    return 'YouTube';
  }
  if (combined.includes('tiktok.com') || combined.includes('tiktokcdn.com')) {
    return 'TikTok';
  }
  if (combined.includes('twitter.com') || combined.includes('x.com') || combined.includes('twimg.com')) {
    return 'Twitter/X';
  }
  if (combined.includes('reddit.com') || combined.includes('v.redd.it')) {
    return 'Reddit';
  }
  if (combined.includes('vimeo.com')) {
    return 'Vimeo';
  }
  return 'Web Video';
}

/**
 * Estimate resolution quality
 */
function estimateQuality(width, height, url = '') {
  if (height) {
    if (height >= 2160) return '4K UHD';
    if (height >= 1440) return '2K QHD';
    if (height >= 1080) return '1080p FHD';
    if (height >= 720) return '720p HD';
    if (height >= 480) return '480p SD';
    return `${height}p`;
  }
  const u = (url || '').toLowerCase();
  if (u.includes('1080p') || u.includes('_hd') || u.includes('hd.mp4') || u.includes('1080')) return '1080p FHD';
  if (u.includes('720p') || u.includes('720')) return '720p HD';
  if (u.includes('480p') || u.includes('_sd') || u.includes('sd.mp4')) return '480p SD';
  if (u.includes('.m3u8')) return 'HLS Stream';
  return '1080p FHD';
}

/**
 * Sanitize filename for download
 */
function sanitizeFilename(title, platform = 'Video', ext = 'mp4') {
  let clean = (title || 'Video')
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length > 50) {
    clean = clean.substring(0, 50);
  }
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `${platform}_${clean}_${dateStr}.${ext}`;
}

/**
 * Update extension action badge
 */
function updateBadge(tabId) {
  const list = tabMedia.get(tabId) || [];
  const count = list.length;
  chrome.action.setBadgeText({
    tabId,
    text: count > 0 ? String(count) : ''
  });
  chrome.action.setBadgeBackgroundColor({
    tabId,
    color: '#6366F1'
  });
}

/**
 * Save media state to persistent storage
 */
async function persistTabMedia(tabId) {
  try {
    const list = tabMedia.get(tabId) || [];
    const storage = getStorage();
    await storage.set({ [`tab_${tabId}`]: list });
  } catch (err) {}
}

/**
 * Load tab media from storage if not in memory
 */
async function loadTabMedia(tabId) {
  if (tabMedia.has(tabId)) {
    return tabMedia.get(tabId);
  }
  try {
    const storage = getStorage();
    const data = await storage.get(`tab_${tabId}`);
    const list = data[`tab_${tabId}`] || [];
    tabMedia.set(tabId, list);
    return list;
  } catch (err) {
    return [];
  }
}

/**
 * Register a newly detected video item
 */
function addOrUpdateMedia(tabId, mediaItem) {
  if (!tabId || tabId < 0 || !mediaItem.url) return;

  // Filter out blob: URLs
  if (mediaItem.url.startsWith('blob:')) return;

  // Filter out audio-only streams
  const lower = mediaItem.url.toLowerCase();
  if (lower.includes('mime=audio') || lower.includes('/audio/') || (mediaItem.format && mediaItem.format.toLowerCase().includes('audio'))) {
    return;
  }

  // Normalize URL to full file without chunk parameters
  const cleanFullUrl = normalizeUrl(mediaItem.url);
  if (!cleanFullUrl.startsWith('http')) return;

  let list = tabMedia.get(tabId) || [];

  // Match existing by clean URL
  const existingIndex = list.findIndex(item => item.url === cleanFullUrl || item.cleanUrl === cleanFullUrl);

  if (existingIndex >= 0) {
    const existing = list[existingIndex];
    list[existingIndex] = {
      ...existing,
      ...mediaItem,
      url: cleanFullUrl,
      size: Math.max(existing.size || 0, mediaItem.size || 0),
      sizeFormatted: formatBytes(Math.max(existing.size || 0, mediaItem.size || 0)),
      quality: mediaItem.quality || existing.quality || '1080p FHD',
      poster: mediaItem.poster || existing.poster,
      title: (mediaItem.title && !mediaItem.title.includes('Video')) ? mediaItem.title : existing.title
    };
  } else {
    // New item
    const newItem = {
      id: 'media_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      url: cleanFullUrl,
      cleanUrl: cleanFullUrl,
      title: mediaItem.title || 'Video',
      poster: mediaItem.poster || '',
      size: mediaItem.size || 0,
      sizeFormatted: formatBytes(mediaItem.size || 0),
      format: mediaItem.format || 'MP4',
      quality: mediaItem.quality || '1080p FHD',
      duration: mediaItem.duration || 0,
      durationFormatted: mediaItem.durationFormatted || '',
      platform: mediaItem.platform || 'Web Video',
      detectedAt: Date.now()
    };
    list.unshift(newItem);
  }

  if (list.length > 50) {
    list = list.slice(0, 50);
  }

  tabMedia.set(tabId, list);
  persistTabMedia(tabId);
  updateBadge(tabId);
}

/**
 * Monitor network response headers for video streams
 */
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    const { tabId, url, responseHeaders } = details;
    if (!tabId || tabId < 0) return;

    let contentType = '';
    let contentLength = 0;

    if (responseHeaders) {
      for (const h of responseHeaders) {
        const name = h.name.toLowerCase();
        if (name === 'content-type') {
          contentType = (h.value || '').toLowerCase();
        } else if (name === 'content-length') {
          contentLength = parseInt(h.value, 10) || 0;
        }
      }
    }

    const lowerUrl = url.toLowerCase();

    // Check if matching video content type or known video extension
    const isVideoMime = VIDEO_MIME_TYPES.some(m => contentType.includes(m));
    const isVideoExt = VIDEO_EXTENSIONS.some(ext => lowerUrl.includes(ext));
    const isFacebookVideo = (lowerUrl.includes('fbcdn.net') || lowerUrl.includes('facebook.com')) && 
                            (contentType.includes('video') || lowerUrl.includes('.mp4') || lowerUrl.includes('bytestart'));
    const isInstagramVideo = (lowerUrl.includes('cdninstagram.com') || lowerUrl.includes('fbcdn.net')) &&
                             (contentType.includes('video') || lowerUrl.includes('.mp4'));

    if (isVideoMime || isVideoExt || isFacebookVideo || isInstagramVideo) {
      let format = 'MP4';
      if (contentType.includes('webm') || lowerUrl.includes('.webm')) format = 'WEBM';
      else if (contentType.includes('mpegurl') || lowerUrl.includes('.m3u8')) format = 'M3U8';

      chrome.tabs.get(tabId, (tab) => {
        const tabTitle = (tab && tab.title) ? tab.title : 'Video';
        const platform = detectPlatform(url, tab ? tab.url : '');

        addOrUpdateMedia(tabId, {
          url,
          title: `${platform} - ${tabTitle}`,
          size: contentLength,
          format,
          quality: estimateQuality(0, 0, url),
          platform
        });
      });
    }
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

/**
 * Handle tab navigation - only clear if host domain changes
 */
const tabHostMap = new Map();
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    try {
      const newHost = new URL(changeInfo.url).hostname;
      const oldHost = tabHostMap.get(tabId);
      if (oldHost && oldHost !== newHost) {
        tabMedia.delete(tabId);
        persistTabMedia(tabId);
        updateBadge(tabId);
      }
      tabHostMap.set(tabId, newHost);
    } catch (e) {}
  }
});

/**
 * Handle tab close
 */
chrome.tabs.onRemoved.addListener((tabId) => {
  tabMedia.delete(tabId);
  tabHostMap.delete(tabId);
  try {
    getStorage().remove(`tab_${tabId}`);
  } catch (e) {}
});

/**
 * Listen for messages from popup and content scripts
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const senderTabId = (sender && sender.tab && sender.tab.id) ? sender.tab.id : null;

  switch (message.action) {
    case 'DOM_VIDEOS_FOUND': {
      const tabId = senderTabId || message.tabId;
      if (tabId && Array.isArray(message.videos)) {
        for (const item of message.videos) {
          addOrUpdateMedia(tabId, item);
        }
      }
      sendResponse({ success: true, count: (tabMedia.get(tabId) || []).length });
      break;
    }

    case 'GET_TAB_MEDIA': {
      const tabId = message.tabId || senderTabId;
      if (!tabId) {
        sendResponse({ media: [] });
        return true;
      }
      loadTabMedia(tabId).then((list) => {
        sendResponse({ media: list || [] });
      });
      return true;
    }

    case 'CLEAR_TAB_MEDIA': {
      const tabId = message.tabId;
      tabMedia.delete(tabId);
      persistTabMedia(tabId);
      updateBadge(tabId);
      sendResponse({ success: true });
      break;
    }

    case 'DOWNLOAD_MEDIA': {
      let { url, filename, platform } = message;
      if (!url) {
        sendResponse({ success: false, error: 'Missing download URL' });
        return;
      }

      url = normalizeUrl(url);

      chrome.storage.sync.get(['downloadFolder'], (cfg) => {
        let finalFilename = filename || sanitizeFilename('Video', platform || 'Nova', 'mp4');
        const folder = (cfg.downloadFolder || '').trim();
        
        if (folder) {
          const cleanFolder = folder.replace(/[/\\]+$/, '');
          finalFilename = `${cleanFolder}/${finalFilename}`;
        }

        try {
          chrome.downloads.download(
            {
              url,
              filename: finalFilename,
              saveAs: false
            },
            (downloadId) => {
              if (chrome.runtime.lastError) {
                chrome.downloads.download({
                  url,
                  saveAs: true
                }, (fallbackId) => {
                  if (chrome.runtime.lastError) {
                    sendResponse({ success: false, error: chrome.runtime.lastError.message });
                  } else {
                    sendResponse({ success: true, downloadId: fallbackId });
                  }
                });
              } else {
                sendResponse({ success: true, downloadId });
              }
            }
          );
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      });
      return true;
    }

    case 'FORCE_SCAN_TAB': {
      const tabId = message.tabId;
      if (tabId) {
        chrome.tabs.sendMessage(tabId, { action: 'SCAN_VIDEOS_NOW' }, (res) => {
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
          } else {
            sendResponse({ success: true, count: res ? res.count : 0 });
          }
        });
        return true;
      }
      break;
    }

    default:
      sendResponse({ status: 'unknown_action' });
  }
});
