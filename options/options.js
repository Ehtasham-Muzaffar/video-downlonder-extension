/**
 * Nova Video Downloader - Options Script
 * Manages tab switching, preference persistence, and defaults.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const navLinks = document.querySelectorAll('.nav-link');
  const tabPanes = document.querySelectorAll('.tab-pane');
  const form = document.getElementById('settings-form');
  const showFloatingBtnInput = document.getElementById('show-floating-btn');
  const downloadFolderInput = document.getElementById('download-folder');
  const namingPatternSelect = document.getElementById('naming-pattern');
  const minSizeFilterSelect = document.getElementById('min-size-filter');
  const resetBtn = document.getElementById('reset-btn');
  const feedbackEl = document.getElementById('save-feedback');

  const DEFAULTS = {
    showFloatingBtn: true,
    downloadFolder: 'NovaDownloads',
    namingPattern: 'platform_title_date',
    minSizeFilter: '262144'
  };

  /**
   * Tab Navigation
   */
  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const tabTarget = link.getAttribute('data-tab');

      navLinks.forEach(l => l.classList.remove('active'));
      link.classList.add('active');

      tabPanes.forEach(pane => {
        if (pane.id === `tab-${tabTarget}`) {
          pane.classList.remove('hidden');
          pane.classList.add('active');
        } else {
          pane.classList.add('hidden');
          pane.classList.remove('active');
        }
      });
    });
  });

  /**
   * Load saved options
   */
  function loadSettings() {
    if (chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get(DEFAULTS, (cfg) => {
        showFloatingBtnInput.checked = !!cfg.showFloatingBtn;
        downloadFolderInput.value = cfg.downloadFolder || '';
        namingPatternSelect.value = cfg.namingPattern || 'platform_title_date';
        minSizeFilterSelect.value = String(cfg.minSizeFilter || '262144');
      });
    }
  }

  /**
   * Save options
   */
  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const newConfig = {
      showFloatingBtn: showFloatingBtnInput.checked,
      downloadFolder: downloadFolderInput.value.trim(),
      namingPattern: namingPatternSelect.value,
      minSizeFilter: minSizeFilterSelect.value
    };

    if (chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.set(newConfig, () => {
        showSaveFeedback();
      });
    } else {
      showSaveFeedback();
    }
  });

  /**
   * Reset Defaults
   */
  resetBtn.addEventListener('click', () => {
    showFloatingBtnInput.checked = DEFAULTS.showFloatingBtn;
    downloadFolderInput.value = DEFAULTS.downloadFolder;
    namingPatternSelect.value = DEFAULTS.namingPattern;
    minSizeFilterSelect.value = DEFAULTS.minSizeFilter;

    if (chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.set(DEFAULTS, () => {
        showSaveFeedback('Reset to defaults');
      });
    }
  });

  let feedbackTimer = null;
  function showSaveFeedback(msg = '✓ Settings saved successfully!') {
    feedbackEl.textContent = msg;
    feedbackEl.classList.remove('hidden');
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => {
      feedbackEl.classList.add('hidden');
    }, 2500);
  }

  // Initialize
  loadSettings();
});
