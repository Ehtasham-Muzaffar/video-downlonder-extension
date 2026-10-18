/**
 * Nova Video Downloader - Page Context Interceptor
 * Runs in the webpage execution context (MAIN world) on Facebook and Instagram.
 * Intercepts internal GraphQL and AJAX responses to extract genuine high-definition
 * progressive MP4 video URLs (with complete audio + video).
 */

(() => {
  if (window.__NOVA_INTERCEPTOR_ACTIVE__) return;
  window.__NOVA_INTERCEPTOR_ACTIVE__ = true;

  const dispatchedUrls = new Set();

  /**
   * Unescape JSON URL strings
   */
  function cleanUrl(url) {
    if (!url || typeof url !== 'string') return '';
    try {
      return JSON.parse(`"${url}"`);
    } catch (e) {
      return url.replace(/\\\//g, '/');
    }
  }

  /**
   * Dispatch extracted video to content script
   */
  function dispatchVideo(videoData) {
    if (!videoData || !videoData.url) return;
    const clean = cleanUrl(videoData.url);
    if (!clean.startsWith('http')) return;

    // Filter out chunks (bytestart > 0)
    if (clean.includes('bytestart=') && !clean.includes('bytestart=0')) return;

    // Normalize URL without bytestart/byteend for full file download
    let fullUrl = clean;
    try {
      const u = new URL(clean);
      if (u.searchParams.has('bytestart')) {
        u.searchParams.delete('bytestart');
        u.searchParams.delete('byteend');
        fullUrl = u.toString();
      }
    } catch (e) {}

    if (dispatchedUrls.has(fullUrl)) return;
    dispatchedUrls.add(fullUrl);

    window.postMessage({
      type: 'NOVA_INTERCEPTED_STREAM',
      payload: {
        url: fullUrl,
        quality: videoData.quality || '1080p FHD',
        format: 'MP4',
        platform: videoData.platform || (window.location.hostname.includes('facebook') ? 'Facebook' : 'Instagram'),
        title: videoData.title || document.title || 'Video',
        poster: videoData.poster || ''
      }
    }, '*');
  }

  /**
   * Recursively scan JSON objects for Facebook & Instagram video properties
   */
  function scanJsonObject(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 12) return;

    // Direct Facebook progressive video keys
    if (obj.browser_native_hd_url) {
      dispatchVideo({ url: obj.browser_native_hd_url, quality: '1080p FHD' });
    }
    if (obj.playable_url_quality_hd) {
      dispatchVideo({ url: obj.playable_url_quality_hd, quality: '1080p FHD' });
    }
    if (obj.browser_native_sd_url) {
      dispatchVideo({ url: obj.browser_native_sd_url, quality: 'SD' });
    }
    if (obj.playable_url) {
      dispatchVideo({ url: obj.playable_url, quality: 'SD' });
    }
    if (obj.hd_src) {
      dispatchVideo({ url: obj.hd_src, quality: '1080p FHD' });
    }
    if (obj.sd_src) {
      dispatchVideo({ url: obj.sd_src, quality: 'SD' });
    }

    // Direct Instagram video keys
    if (obj.video_versions && Array.isArray(obj.video_versions) && obj.video_versions.length > 0) {
      // Highest resolution is typically index 0
      const best = obj.video_versions[0];
      if (best && best.url) {
        const q = best.height ? `${best.height}p` : (best.width >= 1080 ? '1080p FHD' : 'HD');
        dispatchVideo({
          url: best.url,
          quality: q,
          poster: (obj.image_versions2 && obj.image_versions2.candidates && obj.image_versions2.candidates[0]) 
            ? obj.image_versions2.candidates[0].url : ''
        });
      }
    }

    if (obj.video_url && typeof obj.video_url === 'string') {
      dispatchVideo({ url: obj.video_url, quality: 'HD' });
    }

    // Traverse children
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (val && typeof val === 'object') {
        scanJsonObject(val, depth + 1);
      }
    }
  }

  // Hook window.fetch
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await origFetch.apply(this, args);
    try {
      const reqUrl = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
      const isTarget = reqUrl.includes('/graphql') || 
                       reqUrl.includes('reels') || 
                       reqUrl.includes('/api/') || 
                       reqUrl.includes('feed');
      if (isTarget) {
        const clone = response.clone();
        clone.json().then(data => {
          scanJsonObject(data);
        }).catch(() => {});
      }
    } catch (e) {}
    return response;
  };

  // Hook XMLHttpRequest
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this._novaTargetUrl = url;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener('load', function () {
      try {
        if (this._novaTargetUrl && (
          this._novaTargetUrl.includes('/graphql') || 
          this._novaTargetUrl.includes('reels') || 
          this._novaTargetUrl.includes('/api/')
        )) {
          const data = JSON.parse(this.responseText);
          scanJsonObject(data);
        }
      } catch (e) {}
    });
    return origSend.apply(this, arguments);
  };
})();
