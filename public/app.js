(() => {
  'use strict';

  // ==========================================
  // 1. MODERN WEB GUIDANCE HELPERS & FALLBACKS
  // ==========================================

  // A. Top-layer exit transition support probe (animate-to-from-top-layer)
  let supportsDisplayTransition;
  function canTransitionDisplay() {
    if (supportsDisplayTransition !== undefined) return supportsDisplayTransition;
    if (!window.CSS?.supports?.('transition-behavior', 'allow-discrete') || !document.body) {
      return false;
    }
    const probe = document.createElement('div');
    probe.style.cssText = 'transition: display 1s allow-discrete !important; display: block;';
    document.body.appendChild(probe);
    getComputedStyle(probe).display;
    probe.style.display = 'none';
    supportsDisplayTransition = getComputedStyle(probe).display === 'block';
    probe.remove();
    return supportsDisplayTransition;
  }

  function supportsTopLayerExit() {
    return window.CSS?.supports?.('overlay', 'auto') && canTransitionDisplay();
  }

  async function closeTopLayer(dialog) {
    if (!dialog || !dialog.open) return;
    if (!supportsTopLayerExit()) {
      dialog.setAttribute('data-closing', '');
      const animations = dialog.getAnimations({ subtree: true });
      if (animations.length > 0) {
        await Promise.race([
          Promise.allSettled(animations.map((a) => a.finished)),
          new Promise((r) => setTimeout(r, 2000))
        ]);
      }
      if (!dialog.hasAttribute('data-closing')) return;
      dialog.removeAttribute('data-closing');
    }
    dialog.close();
  }

  // B. Light-dismiss fallback for <dialog closedby="any">
  if (!('closedBy' in HTMLDialogElement.prototype)) {
    const outside = (e, dialog) => {
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    for (const dialog of document.querySelectorAll('dialog[closedby="any"]')) {
      let pressedOutside = false;
      dialog.addEventListener('pointerdown', (e) => {
        if (e.target !== dialog) {
          pressedOutside = false;
          return;
        }
        pressedOutside = outside(e, dialog);
      });
      dialog.addEventListener('pointerup', (e) => {
        if (pressedOutside && e.target === dialog && outside(e, dialog)) {
          closeTopLayer(dialog);
        }
        pressedOutside = false;
      });
    }
  }

  // Route native cancel (Esc) through closeTopLayer and reset returnValue on close
  for (const dialog of document.querySelectorAll('dialog')) {
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeTopLayer(dialog);
    });
    dialog.addEventListener('close', () => {
      dialog.returnValue = '';
    });
  }

  // C. Form validation after interaction (:user-invalid + ARIA sync + fallback)
  const linkError = (el, shown) => {
    const errorId = el.dataset?.error;
    if (!errorId) return;
    const ids = (el.getAttribute('aria-describedby') || '')
      .split(/\s+/)
      .filter((id) => id && id !== errorId);
    if (shown) ids.push(errorId);
    if (ids.length) el.setAttribute('aria-describedby', ids.join(' '));
    else el.removeAttribute('aria-describedby');
  };

  const announcer = document.createElement('div');
  announcer.setAttribute('aria-live', 'polite');
  announcer.classList.add('visually-hidden');
  document.body.append(announcer);
  let announceTimer;
  let announcedField;

  const spokenText = (node) => {
    const copy = node.cloneNode(true);
    copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
    copy.querySelectorAll('[role="img"][aria-label]').forEach((n) => {
      n.replaceWith(`${n.getAttribute('aria-label')}: `);
    });
    return copy.textContent.replace(/\s+/g, ' ').trim();
  };

  const announceError = (el) => {
    const error = document.getElementById(el.dataset.error);
    if (!error) return;
    const label = el.labels?.[0] ? `${spokenText(el.labels[0])}: ` : '';
    clearTimeout(announceTimer);
    announcer.textContent = '';
    announcedField = el;
    announceTimer = setTimeout(() => {
      announcer.textContent = label + spokenText(error);
    }, 500);
  };

  const supportsUserInvalid = Boolean(window.CSS?.supports?.('selector(:user-invalid)'));
  const flagged = new WeakSet();
  const announced = new WeakSet();
  const dirtyState = new WeakMap();

  const syncAria = (el, announce = false) => {
    if (!el.matches?.('input, select, textarea')) return;
    const invalid = supportsUserInvalid
      ? el.matches(':user-invalid')
      : el.classList.contains('user-invalid-fallback');
    if (invalid) {
      if (announce && !announced.has(el)) {
        announceError(el);
        announced.add(el);
      }
      el.setAttribute('aria-invalid', 'true');
      linkError(el, true);
      flagged.add(el);
    } else if (flagged.has(el) || el.getAttribute('aria-invalid') !== 'true') {
      el.setAttribute('aria-invalid', 'false');
      linkError(el, false);
      flagged.delete(el);
      announced.delete(el);
      if (announcedField === el) {
        clearTimeout(announceTimer);
        announcer.textContent = '';
      }
    }
  };

  const resetFormValidationState = (form) => {
    for (const control of form.elements) {
      if (!control.matches?.('input, select, textarea')) continue;
      dirtyState.delete(control);
      flagged.delete(control);
      announced.delete(control);
      control.classList.remove('user-invalid-fallback', 'user-valid-fallback');
      control.setAttribute('aria-invalid', 'false');
      linkError(control, false);
    }
  };

  document.querySelectorAll('input, select, textarea').forEach((el) => syncAria(el));

  document.addEventListener(
    'blur',
    (e) => {
      const input = e.target;
      if (!input.matches?.('input, select, textarea')) return;
      if (!supportsUserInvalid && input.checkValidity) {
        const state = dirtyState.get(input) || { hasInteracted: false, hasBlurred: false };
        state.hasBlurred = true;
        dirtyState.set(input, state);
        if (state.hasInteracted) {
          const isValid = input.validity.valid;
          input.classList.toggle('user-invalid-fallback', !isValid);
          input.classList.toggle('user-valid-fallback', isValid);
        }
      }
      syncAria(input, true);
    },
    true
  );

  document.addEventListener('input', (e) => {
    const input = e.target;
    if (!input.matches?.('input, select, textarea')) return;
    if (!supportsUserInvalid && input.checkValidity) {
      const state = dirtyState.get(input) || { hasInteracted: false, hasBlurred: false };
      state.hasInteracted = true;
      dirtyState.set(input, state);
      if (state.hasBlurred) {
        const isValid = input.validity.valid;
        input.classList.toggle('user-invalid-fallback', !isValid);
        input.classList.toggle('user-valid-fallback', isValid);
      }
    }
    if (input.hasAttribute('aria-invalid')) syncAria(input);
  });

  document.addEventListener(
    'invalid',
    (e) => {
      const input = e.target;
      if (!input.matches?.('input, select, textarea')) return;
      if (!supportsUserInvalid) {
        dirtyState.set(input, { hasInteracted: true, hasBlurred: true });
        input.classList.add('user-invalid-fallback');
        input.classList.remove('user-valid-fallback');
      }
      announced.add(input);
      syncAria(input);
    },
    true
  );

  // ==========================================
  // 2. YOUTUBE URL HELPERS
  // ==========================================

  function extractYouTubeId(input) {
    if (typeof input !== 'string') return null;
    const trimmed = input.trim();
    if (!trimmed) return '';

    if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
      return trimmed;
    }

    try {
      const url = new URL(trimmed);
      const host = url.hostname.replace(/^www\./, '').toLowerCase();

      if (host === 'youtu.be') {
        const id = url.pathname.split('/').filter(Boolean)[0];
        return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
      }

      if (
        host === 'youtube.com' ||
        host === 'm.youtube.com' ||
        host === 'music.youtube.com' ||
        host === 'youtube-nocookie.com'
      ) {
        const vParam = url.searchParams.get('v');
        if (vParam && /^[a-zA-Z0-9_-]{11}$/.test(vParam)) {
          return vParam;
        }
        const parts = url.pathname.split('/').filter(Boolean);
        if (parts.length >= 2 && ['embed', 'live', 'shorts', 'v'].includes(parts[0])) {
          const candidate = parts[1];
          if (/^[a-zA-Z0-9_-]{11}$/.test(candidate)) {
            return candidate;
          }
        }
      }
    } catch {
      return null;
    }
    return null;
  }

  function normalizeFeedEntry(entry) {
    if (typeof entry === 'string') {
      return { url: entry.trim(), volume: 100, muted: false };
    }
    if (entry && typeof entry === 'object') {
      const url = typeof entry.url === 'string' ? entry.url.trim() : '';
      const rawVol = Number(entry.volume);
      const volume = Number.isFinite(rawVol)
        ? Math.max(0, Math.min(100, Math.round(rawVol)))
        : 100;
      const muted = Boolean(entry.muted);
      return { url, volume, muted };
    }
    return { url: '', volume: 100, muted: false };
  }

  // iOS/iPadOS WebKit (used by both Safari and Chrome on iOS) blocks unmuted autoplay and pauses
  // iframes on programmatic unMute without a direct user gesture inside each frame.
  const IS_IOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const IS_IPAD =
    /iPad/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function buildEmbedUrl(feedEntry) {
    const feed = normalizeFeedEntry(feedEntry);
    const videoId = extractYouTubeId(feed.url);
    if (!videoId) return null;
    const isMuted = IS_IOS || feed.muted || feed.volume === 0;
    const params = new URLSearchParams({
      autoplay: '1',
      mute: isMuted ? '1' : '0',
      playsinline: '1',
      rel: '0',
      enablejsapi: '1',
      origin: window.location.origin
    });
    return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?${params.toString()}`;
  }

  function buildThumbnailUrl(feedEntry) {
    const feed = normalizeFeedEntry(feedEntry);
    const videoId = extractYouTubeId(feed.url);
    if (!videoId) return null;
    return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/mqdefault.jpg`;
  }

  // Track initial audio sync per iframe so opening a grid always enforces saved config,
  // while manual adjustments inside the YouTube player during a session aren't overwritten
  const iframeAudioSyncState = new WeakMap();

  function postYouTubeCommand(iframe, func, args = []) {
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage(
      JSON.stringify({ event: 'command', func, args }),
      '*'
    );
  }

  const IS_TOUCH_MOBILE =
    IS_IOS || Boolean(window.matchMedia?.('(pointer: coarse)')?.matches);

  function setPaneAudioButtonState(btn, isUnmuted) {
    if (!btn) return;
    btn.setAttribute('aria-pressed', isUnmuted ? 'true' : 'false');
  }

  function sendYouTubeAudioCommands(iframe, feedEntry) {
    if (!iframe?.contentWindow) return;
    const feed = normalizeFeedEntry(feedEntry);
    const state = iframeAudioSyncState.get(iframe);
    const shouldMute = IS_IOS
      ? !state?.userUnmuted
      : (feed.muted || feed.volume === 0);
    if (shouldMute) {
      postYouTubeCommand(iframe, 'setVolume', [feed.volume]);
      postYouTubeCommand(iframe, 'mute', []);
    } else {
      postYouTubeCommand(iframe, 'unMute', []);
      postYouTubeCommand(iframe, 'setVolume', [feed.volume > 0 ? feed.volume : 100]);
    }
  }

  function togglePaneAudio(iframe) {
    const state = iframeAudioSyncState.get(iframe);
    if (!state) return;

    const nextUnmuted = !state.userUnmuted;
    if (nextUnmuted) {
      // On iOS/mobile, mute other panes cleanly so only one audio stream plays at a time
      for (const otherFrame of streamWall.querySelectorAll('iframe.stream-frame')) {
        if (otherFrame === iframe) continue;
        const otherState = iframeAudioSyncState.get(otherFrame);
        if (otherState?.userUnmuted) {
          otherState.userUnmuted = false;
          setPaneAudioButtonState(otherState.audioBtn, false);
          postYouTubeCommand(otherFrame, 'mute', []);
        }
      }

      state.userUnmuted = true;
      state.syncedOnPlay = true;
      setPaneAudioButtonState(state.audioBtn, true);
      const targetVolume = state.feed.volume > 0 ? state.feed.volume : 100;
      postYouTubeCommand(iframe, 'unMute', []);
      postYouTubeCommand(iframe, 'setVolume', [targetVolume]);
      postYouTubeCommand(iframe, 'playVideo', []);
    } else {
      state.userUnmuted = false;
      setPaneAudioButtonState(state.audioBtn, false);
      postYouTubeCommand(iframe, 'mute', []);
    }
  }

  function registerIframeAudioInit(iframe, paneIndex, feedEntry, audioBtn = null) {
    const feed = normalizeFeedEntry(feedEntry);
    iframeAudioSyncState.set(iframe, {
      paneIndex,
      feed,
      audioBtn,
      userUnmuted: !(IS_IOS || feed.muted || feed.volume === 0),
      syncedOnPlay: false
    });

    const startListening = () => {
      if (!iframe.contentWindow) return;
      iframe.contentWindow.postMessage(
        JSON.stringify({
          event: 'listening',
          id: `gridtube-pane-${paneIndex}`,
          channel: 'widget'
        }),
        '*'
      );
      sendYouTubeAudioCommands(iframe, feed);
    };

    iframe.addEventListener('load', () => {
      startListening();
      setTimeout(startListening, 350);
      setTimeout(startListening, 1000);
    });
  }

  window.addEventListener('message', (event) => {
    if (!event.origin.includes('youtube.com') && !event.origin.includes('youtube-nocookie.com')) {
      return;
    }
    let data;
    try {
      data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
    } catch {
      return;
    }
    if (!data || typeof data !== 'object') return;

    const iframes = streamWall.querySelectorAll('iframe.stream-frame');
    for (const iframe of iframes) {
      if (iframe.contentWindow !== event.source) continue;
      const state = iframeAudioSyncState.get(iframe);
      if (!state) break;

      if (data.event === 'infoDelivery' && data.info && typeof data.info.muted === 'boolean') {
        const isUnmuted = !data.info.muted;
        if (state.syncedOnPlay || isUnmuted) {
          state.userUnmuted = isUnmuted;
          setPaneAudioButtonState(state.audioBtn, isUnmuted);
        }
      }

      if (state.syncedOnPlay) break;

      if (data.event === 'onReady') {
        sendYouTubeAudioCommands(iframe, state.feed);
      } else if (data.event === 'onStateChange' && data.info === 1) {
        sendYouTubeAudioCommands(iframe, state.feed);
        state.syncedOnPlay = true;
      } else if (
        data.event === 'infoDelivery' &&
        data.info &&
        data.info.playerState === 1
      ) {
        sendYouTubeAudioCommands(iframe, state.feed);
        state.syncedOnPlay = true;
      }
      break;
    }
  });

  // ==========================================
  // 3. STATE & DOM REFERENCES
  // ==========================================

  let grids = [];
  let activeGridId = null;
  let pendingDeleteGridId = null;

  const landingView = document.getElementById('landing-view');
  const landingHeading = document.getElementById('landing-heading');
  const playerView = document.getElementById('player-view');
  const playerGridTitle = document.getElementById('player-grid-title');
  const streamWall = document.getElementById('stream-wall');

  const gridsList = document.getElementById('grids-list');
  const emptyState = document.getElementById('empty-state');
  const statusBanner = document.getElementById('status-banner');
  const appVersionEl = document.getElementById('app-version');

  const newGridBtn = document.getElementById('new-grid-btn');
  const emptyNewGridBtn = document.getElementById('empty-new-grid-btn');
  const playerHud = document.getElementById('player-hud');
  const playerHudToggle = document.getElementById('player-hud-toggle');
  const closeHudBtn = document.getElementById('close-hud-btn');
  const backToGridsBtn = document.getElementById('back-to-grids-btn');
  const editActiveGridBtn = document.getElementById('edit-active-grid-btn');
  const fullscreenBtn = document.getElementById('fullscreen-btn');
  const fullscreenLabel = document.getElementById('fullscreen-label');

  // Add/Edit Modal
  const gridModal = document.getElementById('grid-modal');
  const gridModalTitle = document.getElementById('grid-modal-title');
  const closeGridModalBtn = document.getElementById('close-grid-modal-btn');
  const cancelGridModalBtn = document.getElementById('cancel-grid-modal-btn');
  const gridForm = document.getElementById('grid-form');
  const gridIdInput = document.getElementById('grid-id-input');
  const gridNameInput = document.getElementById('grid-name-input');
  const feedInputs = [
    document.getElementById('feed-url-0'),
    document.getElementById('feed-url-1'),
    document.getElementById('feed-url-2'),
    document.getElementById('feed-url-3')
  ];
  const feedMuteBtns = [
    document.getElementById('feed-mute-0'),
    document.getElementById('feed-mute-1'),
    document.getElementById('feed-mute-2'),
    document.getElementById('feed-mute-3')
  ];
  const feedVolSliders = [
    document.getElementById('feed-vol-0'),
    document.getElementById('feed-vol-1'),
    document.getElementById('feed-vol-2'),
    document.getElementById('feed-vol-3')
  ];
  const feedVolTexts = [
    document.getElementById('feed-vol-text-0'),
    document.getElementById('feed-vol-text-1'),
    document.getElementById('feed-vol-text-2'),
    document.getElementById('feed-vol-text-3')
  ];
  const slotLabels = ['Top-Left Feed', 'Top-Right Feed', 'Bottom-Left Feed', 'Bottom-Right Feed'];
  const lastNonZeroVolume = [100, 100, 100, 100];

  function syncSliderCssVars(slider) {
    slider.style.setProperty('--attr-min', slider.min || '0');
    slider.style.setProperty('--attr-max', slider.max || '100');
    slider.style.setProperty('--control-value', slider.value);
  }

  function setFeedAudioControlState(idx, volume, muted) {
    const clampedVol = Math.max(0, Math.min(100, Math.round(Number(volume) || 0)));
    const isMuted = Boolean(muted);
    if (clampedVol > 0) {
      lastNonZeroVolume[idx] = clampedVol;
    }

    const muteBtn = feedMuteBtns[idx];
    const slider = feedVolSliders[idx];
    const textEl = feedVolTexts[idx];

    slider.value = String(clampedVol);
    syncSliderCssVars(slider);

    muteBtn.setAttribute('aria-pressed', isMuted ? 'true' : 'false');
    muteBtn.setAttribute(
      'aria-label',
      isMuted ? `Unmute ${slotLabels[idx]}` : `Mute ${slotLabels[idx]}`
    );

    if (isMuted) {
      textEl.textContent = 'Muted';
      slider.setAttribute('aria-valuetext', `${clampedVol}% (Muted)`);
    } else {
      textEl.textContent = `${clampedVol}%`;
      slider.setAttribute('aria-valuetext', `${clampedVol}%`);
    }
  }

  for (let i = 0; i < 4; i++) {
    syncSliderCssVars(feedVolSliders[i]);

    feedMuteBtns[i].addEventListener('click', () => {
      const currentlyMuted = feedMuteBtns[i].getAttribute('aria-pressed') === 'true';
      const currentVol = Number(feedVolSliders[i].value);
      if (currentlyMuted) {
        const restoredVol = currentVol === 0 ? (lastNonZeroVolume[i] || 100) : currentVol;
        setFeedAudioControlState(i, restoredVol, false);
      } else {
        setFeedAudioControlState(i, currentVol, true);
      }
    });

    feedVolSliders[i].addEventListener('input', () => {
      const val = Number(feedVolSliders[i].value);
      if (val === 0) {
        setFeedAudioControlState(i, 0, true);
      } else {
        setFeedAudioControlState(i, val, false);
      }
    });
  }
  const formServerError = document.getElementById('form-server-error');
  const saveGridBtn = document.getElementById('save-grid-btn');

  // Delete Modal
  const deleteModal = document.getElementById('delete-modal');
  const closeDeleteModalBtn = document.getElementById('close-delete-modal-btn');
  const cancelDeleteBtn = document.getElementById('cancel-delete-btn');
  const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
  const deleteGridNameEl = document.getElementById('delete-grid-name');

  // ==========================================
  // 4. API CLIENT
  // ==========================================

  async function requestJson(url, options = {}, fallbackMessage = 'Request failed.') {
    const res = await fetch(url, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...options.headers
      }
    });

    const contentType = res.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');
    let data = null;

    if (isJson) {
      try {
        data = await res.json();
      } catch {
        data = null;
      }
    }

    if (!res.ok) {
      if (data?.error) {
        throw new Error(data.error);
      }
      if (res.status === 403 && !isJson) {
        throw new Error(
          'Request was blocked upstream (HTTP 403). If your security session expired or you switched device emulation, reload the page and try again.'
        );
      }
      throw new Error(`${fallbackMessage} (HTTP ${res.status})`);
    }

    if (!isJson || data === null) {
      throw new Error('Unexpected response from server. Try reloading the page.');
    }

    return data;
  }

  async function fetchGrids() {
    grids = await requestJson('/api/grids', {}, 'Failed to load saved grids.');
  }

  async function fetchVersion() {
    try {
      const data = await requestJson('/api/version', {}, 'Failed to load version.');
      if (data?.version && appVersionEl) {
        appVersionEl.textContent = `Version ${data.version}`;
        appVersionEl.hidden = false;
      }
    } catch {
      // Ignore version fetch errors silently
    }
  }

  function showStatusBanner(message) {
    statusBanner.textContent = message;
    statusBanner.hidden = false;
    setTimeout(() => {
      if (statusBanner.textContent === message) {
        statusBanner.hidden = true;
      }
    }, 4000);
  }

  // ==========================================
  // 5. RENDERING & SPA VIEW TRANSITIONS
  // ==========================================

  function runViewTransition(updateDomFn, focusTargetEl) {
    if (!document.startViewTransition) {
      updateDomFn();
      focusTargetEl?.focus();
      return;
    }
    const transition = document.startViewTransition(() => {
      updateDomFn();
    });
    transition.finished.finally(() => {
      focusTargetEl?.focus();
    });
  }

  function renderLandingList() {
    gridsList.innerHTML = '';

    if (!grids.length) {
      gridsList.hidden = true;
      emptyState.hidden = false;
      return;
    }

    gridsList.hidden = false;
    emptyState.hidden = true;

    for (const grid of grids) {
      const li = document.createElement('li');
      li.className = 'grid-card';

      const launchBtn = document.createElement('button');
      launchBtn.type = 'button';
      launchBtn.className = 'card-launch-btn';
      launchBtn.setAttribute('aria-label', `Open ${grid.name} stream grid`);
      launchBtn.addEventListener('click', () => navigateToGrid(grid.id));

      const matrix = document.createElement('div');
      matrix.className = 'card-preview-matrix';

      const feeds = Array.isArray(grid.feeds) ? grid.feeds : ['', '', '', ''];
      let activeCount = 0;

      for (let i = 0; i < 4; i++) {
        const rawUrl = feeds[i] || '';
        const thumbUrl = buildThumbnailUrl(rawUrl);
        const slot = document.createElement('div');
        slot.className = 'preview-slot';

        if (thumbUrl) {
          activeCount++;
          const img = document.createElement('img');
          img.src = thumbUrl;
          img.alt = '';
          img.width = 320;
          img.height = 180;
          img.loading = 'lazy';
          slot.appendChild(img);
        } else {
          slot.classList.add('preview-slot-empty');
          const emptyLabel = document.createElement('span');
          emptyLabel.textContent = 'Empty';
          slot.appendChild(emptyLabel);
        }

        const badge = document.createElement('span');
        badge.className = 'preview-slot-badge';
        badge.setAttribute('aria-hidden', 'true');
        badge.textContent = String(i + 1);
        slot.appendChild(badge);

        matrix.appendChild(slot);
      }

      launchBtn.appendChild(matrix);

      const footer = document.createElement('div');
      footer.className = 'card-footer';

      const meta = document.createElement('div');
      meta.className = 'card-meta';

      const titleBtn = document.createElement('button');
      titleBtn.type = 'button';
      titleBtn.className = 'card-title-btn';
      titleBtn.textContent = grid.name;
      titleBtn.addEventListener('click', () => navigateToGrid(grid.id));

      const countSpan = document.createElement('span');
      countSpan.className = 'card-count';
      countSpan.textContent = `${activeCount} of 4 feeds configured`;

      meta.append(titleBtn, countSpan);

      const actions = document.createElement('div');
      actions.className = 'card-actions';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'icon-btn';
      editBtn.setAttribute('aria-label', `Edit ${grid.name}`);
      editBtn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 20h9"></path>
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
        </svg>
      `;
      editBtn.addEventListener('click', () => openEditGridModal(grid));

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'icon-btn icon-btn-danger';
      deleteBtn.setAttribute('aria-label', `Delete ${grid.name}`);
      deleteBtn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          <line x1="10" y1="11" x2="10" y2="17"></line>
          <line x1="14" y1="11" x2="14" y2="17"></line>
        </svg>
      `;
      deleteBtn.addEventListener('click', () => openDeleteModal(grid));

      actions.append(editBtn, deleteBtn);
      footer.append(meta, actions);

      li.append(launchBtn, footer);
      gridsList.appendChild(li);
    }
  }

  const slotPositions = ['Top-Left', 'Top-Right', 'Bottom-Left', 'Bottom-Right'];

  function createPlayerPaneElement(grid, i, feedEntry) {
    const feed = normalizeFeedEntry(feedEntry);
    const videoId = extractYouTubeId(feed.url) || '';
    const embedUrl = buildEmbedUrl(feed);
    const pane = document.createElement('div');
    pane.className = 'stream-pane';
    pane.dataset.videoId = videoId;

    if (embedUrl) {
      const iframe = document.createElement('iframe');
      iframe.className = 'stream-frame';
      iframe.src = embedUrl;
      iframe.title = `${grid.name} — Pane ${i + 1} (${slotPositions[i]}) YouTube Live Feed`;
      iframe.allow =
        'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      iframe.allowFullscreen = true;
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';

      let audioBtn = null;
      if (IS_TOUCH_MOBILE) {
        const startsMuted = IS_IOS || feed.muted || feed.volume === 0;
        audioBtn = document.createElement('button');
        audioBtn.type = 'button';
        audioBtn.className = 'pane-audio-btn';
        audioBtn.setAttribute('aria-pressed', startsMuted ? 'false' : 'true');
        audioBtn.setAttribute('aria-label', `Pane ${i + 1} (${slotPositions[i]}) sound`);
        audioBtn.innerHTML = `
          <svg class="icon-unmuted" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
          </svg>
          <svg class="icon-muted" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <line x1="23" y1="9" x2="17" y2="15"></line>
            <line x1="17" y1="9" x2="23" y2="15"></line>
          </svg>
        `;
        audioBtn.addEventListener('click', () => togglePaneAudio(iframe));
      }

      registerIframeAudioInit(iframe, i, feed, audioBtn);
      pane.appendChild(iframe);
      if (audioBtn) {
        pane.appendChild(audioBtn);
      }
    } else {
      const emptyBox = document.createElement('div');
      emptyBox.className = 'empty-pane';

      const badge = document.createElement('span');
      badge.className = 'empty-pane-badge';
      badge.setAttribute('aria-hidden', 'true');
      badge.textContent = String(i + 1);

      const label = document.createElement('p');
      label.className = 'empty-pane-label';
      label.textContent = `Pane ${i + 1} (${slotPositions[i]}) — No feed URL provided`;

      const configBtn = document.createElement('button');
      configBtn.type = 'button';
      configBtn.className = 'empty-pane-btn';
      configBtn.textContent = 'Add Feed URL';
      configBtn.addEventListener('click', () => {
        const latestGrid = grids.find((g) => g.id === grid.id) || grid;
        openEditGridModal(latestGrid, i);
      });

      emptyBox.append(badge, label, configBtn);
      pane.appendChild(emptyBox);
    }

    return pane;
  }

  function renderPlayerWall(grid) {
    streamWall.innerHTML = '';
    playerGridTitle.textContent = grid.name;

    const feeds = Array.isArray(grid.feeds) ? grid.feeds : [];
    for (let i = 0; i < 4; i++) {
      streamWall.appendChild(createPlayerPaneElement(grid, i, feeds[i]));
    }
  }

  function updateActivePlayerWall(grid) {
    playerGridTitle.textContent = grid.name;
    document.title = `${grid.name} — GridTube`;

    const feeds = Array.isArray(grid.feeds) ? grid.feeds : [];
    const existingPanes = streamWall.querySelectorAll('.stream-pane');

    if (existingPanes.length !== 4) {
      renderPlayerWall(grid);
      return;
    }

    for (let i = 0; i < 4; i++) {
      const feed = normalizeFeedEntry(feeds[i]);
      const newVideoId = extractYouTubeId(feed.url) || '';
      const existingPane = existingPanes[i];
      const existingVideoId = existingPane.dataset.videoId || '';

      if (newVideoId && newVideoId === existingVideoId) {
        const iframe = existingPane.querySelector('iframe.stream-frame');
        if (iframe) {
          iframe.title = `${grid.name} — Pane ${i + 1} (${slotPositions[i]}) YouTube Live Feed`;
          const state = iframeAudioSyncState.get(iframe);
          if (state) {
            state.feed = feed;
            if (feed.muted || feed.volume === 0) {
              state.userUnmuted = false;
              setPaneAudioButtonState(state.audioBtn, false);
            }
          }
          sendYouTubeAudioCommands(iframe, feed);
          setTimeout(() => sendYouTubeAudioCommands(iframe, feed), 150);
          continue;
        }
      }

      const replacementPane = createPlayerPaneElement(grid, i, feed);
      existingPane.replaceWith(replacementPane);
    }
  }

  // ==========================================
  // 6. ROUTER
  // ==========================================

  function navigateToGrid(gridId) {
    const targetHash = `#/grid/${encodeURIComponent(gridId)}`;
    if (window.location.hash !== targetHash) {
      window.location.hash = targetHash;
    } else {
      handleRouteChange();
    }
  }

  function navigateToLanding() {
    if (window.location.hash && window.location.hash !== '#/') {
      window.location.hash = '#/';
    } else {
      handleRouteChange();
    }
  }

  function setPlayerHudOpen(open, returnFocusToToggle = false) {
    const isOpen = Boolean(open);
    playerHud.dataset.open = isOpen ? 'true' : 'false';
    playerHudToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    if (!isOpen) {
      if (playerHud.contains(document.activeElement)) {
        document.activeElement.blur();
      }
      if (returnFocusToToggle) {
        playerHudToggle.focus();
      }
    }
  }

  const viewportMeta = document.querySelector('meta[name="viewport"]');
  const BASE_VIEWPORT_CONTENT = IS_IPAD
    ? 'width=device-width, initial-scale=1'
    : 'width=device-width, initial-scale=1, viewport-fit=cover';

  if (IS_IPAD && viewportMeta) {
    // iPads have no notch; viewport-fit=cover can lock WKWebView layout width to portrait on rotation
    viewportMeta.setAttribute('content', BASE_VIEWPORT_CONTENT);
  }

  let viewportMetaRefreshTimer = null;
  let viewportMetaRetryTimer = null;

  function refreshIOSViewportMeta() {
    if (!IS_IOS || !viewportMeta) return;
    if (viewportMetaRefreshTimer) {
      clearTimeout(viewportMetaRefreshTimer);
      viewportMetaRefreshTimer = null;
    }
    viewportMeta.setAttribute(
      'content',
      BASE_VIEWPORT_CONTENT.replace('initial-scale=1', 'initial-scale=1.0001')
    );
    viewportMetaRefreshTimer = setTimeout(() => {
      viewportMeta.setAttribute('content', BASE_VIEWPORT_CONTENT);
      viewportMetaRefreshTimer = null;
    }, 50);
  }

  function scheduleIOSViewportMetaRefresh() {
    if (!IS_IOS || !viewportMeta) return;
    if (viewportMetaRetryTimer) {
      clearTimeout(viewportMetaRetryTimer);
      viewportMetaRetryTimer = null;
    }
    refreshIOSViewportMeta();
    viewportMetaRetryTimer = setTimeout(() => {
      refreshIOSViewportMeta();
      viewportMetaRetryTimer = null;
    }, 120);
  }

  let playerViewportTimers = [];

  function clearPlayerViewportSyncTimers() {
    for (const timerId of playerViewportTimers) {
      clearTimeout(timerId);
    }
    playerViewportTimers = [];
  }

  function clearPlayerViewportOverrides() {
    playerView.style.removeProperty('--player-inline-size');
    playerView.style.removeProperty('--player-block-size');
  }

  function syncPlayerViewport() {
    if (playerView.hidden || document.fullscreenElement) {
      clearPlayerViewportOverrides();
      return;
    }

    // Avoid resizing the video wall while the iOS virtual keyboard shrinks visualViewport inside a modal
    if (gridModal.open || deleteModal.open) {
      return;
    }

    const vv = window.visualViewport;
    const scale = vv && Number.isFinite(vv.scale) && vv.scale > 0 ? vv.scale : 1;
    const vvWidth = vv && vv.width > 0 ? Math.round(vv.width * scale) : 0;
    const vvHeight = vv && vv.height > 0 ? Math.round(vv.height * scale) : 0;
    const innerW = Math.round(window.innerWidth || 0);
    const innerH = Math.round(window.innerHeight || 0);
    const clientW = Math.round(document.documentElement.clientWidth || 0);
    const clientH = Math.round(document.documentElement.clientHeight || 0);

    let vpWidth = IS_IOS ? Math.max(vvWidth, innerW, clientW) : vvWidth || innerW || clientW;
    const vpHeight = vvHeight || innerH || clientH;

    if (vpWidth <= 0 || vpHeight <= 0) return;

    if (IS_IPAD) {
      const minScreenDim = Math.min(window.screen.width || 0, window.screen.height || 0);
      const maxScreenDim = Math.max(window.screen.width || 0, window.screen.height || 0);
      const isLandscape = window.matchMedia?.('(orientation: landscape)').matches;
      const outerW = Math.round(window.outerWidth || 0);

      // If WKWebView clamps visualViewport/innerWidth to portrait width while rotated to landscape,
      // outerWidth reflects the active iPadOS Chrome tab / Split View container width.
      if (
        isLandscape &&
        minScreenDim > 0 &&
        vpWidth <= minScreenDim + 2 &&
        outerW > vpWidth &&
        (maxScreenDim === 0 || outerW <= maxScreenDim)
      ) {
        vpWidth = outerW;
      }
    }

    if (!IS_IOS) {
      clearPlayerViewportOverrides();
      const rect = playerView.getBoundingClientRect();
      if (Math.abs(rect.width - vpWidth) <= 2 && Math.abs(rect.height - vpHeight) <= 2) {
        return;
      }
    }

    const nextWidth = `${vpWidth}px`;
    const nextHeight = `${vpHeight}px`;
    const prevWidth = playerView.style.getPropertyValue('--player-inline-size');
    const prevHeight = playerView.style.getPropertyValue('--player-block-size');

    playerView.style.setProperty('--player-inline-size', nextWidth);
    playerView.style.setProperty('--player-block-size', nextHeight);

    if (window.scrollX !== 0 || window.scrollY !== 0) {
      window.scrollTo(0, 0);
    }

    if (prevWidth !== nextWidth || prevHeight !== nextHeight) {
      // Force WebKit to recalculate grid tracks and iframe bounds without toggling display
      void streamWall.offsetHeight;
    }
  }

  function schedulePlayerViewportSync({ withRotationRetries = false } = {}) {
    clearPlayerViewportSyncTimers();
    if (playerView.hidden) {
      clearPlayerViewportOverrides();
      return;
    }

    requestAnimationFrame(() => syncPlayerViewport());

    if (withRotationRetries || IS_IOS) {
      // iOS/iPadOS WKWebView updates visualViewport/innerWidth asynchronously after rotation completes
      const delays = withRotationRetries ? [50, 180, 380, 650] : [60, 220];
      for (const delay of delays) {
        playerViewportTimers.push(setTimeout(() => syncPlayerViewport(), delay));
      }
    }
  }

  function handleRouteChange() {
    setPlayerHudOpen(false);
    const hash = window.location.hash || '#/';
    if (hash.startsWith('#/grid/')) {
      const id = decodeURIComponent(hash.slice('#/grid/'.length));
      const grid = grids.find((g) => g.id === id);

      if (!grid) {
        navigateToLanding();
        return;
      }

      activeGridId = grid.id;
      document.title = `${grid.name} — GridTube`;

      if (IS_IPAD && window.matchMedia?.('(orientation: landscape)').matches) {
        const minScreenDim = Math.min(window.screen.width || 0, window.screen.height || 0);
        if (minScreenDim > 0 && window.innerWidth <= minScreenDim + 2) {
          scheduleIOSViewportMetaRefresh();
        }
      }

      runViewTransition(() => {
        landingView.hidden = true;
        playerView.hidden = false;
        renderPlayerWall(grid);
        syncPlayerViewport();
      }, playerView);
      schedulePlayerViewportSync({ withRotationRetries: true });
    } else {
      activeGridId = null;
      document.title = 'GridTube — 2×2 YouTube Live Stream Wall';

      runViewTransition(() => {
        // Stop active video streams when returning to landing page
        streamWall.innerHTML = '';
        playerView.hidden = true;
        clearPlayerViewportSyncTimers();
        clearPlayerViewportOverrides();
        landingView.hidden = false;
        renderLandingList();
      }, landingHeading);
    }
  }

  window.addEventListener('hashchange', handleRouteChange);
  window.addEventListener('resize', () => schedulePlayerViewportSync());
  window.addEventListener('orientationchange', () => {
    scheduleIOSViewportMetaRefresh();
    schedulePlayerViewportSync({ withRotationRetries: true });
  });
  window.visualViewport?.addEventListener('resize', () => schedulePlayerViewportSync());
  screen.orientation?.addEventListener?.('change', () => {
    scheduleIOSViewportMetaRefresh();
    schedulePlayerViewportSync({ withRotationRetries: true });
  });

  // ==========================================
  // 7. MODAL CONTROLLERS (ADD/EDIT & DELETE)
  // ==========================================

  function openAddGridModal() {
    gridForm.reset();
    resetFormValidationState(gridForm);
    gridIdInput.value = '';
    for (let i = 0; i < 4; i++) {
      setFeedAudioControlState(i, 100, false);
    }
    gridModalTitle.textContent = 'Add New Stream Grid';
    saveGridBtn.textContent = 'Create Grid';
    formServerError.hidden = true;
    gridModal.showModal();
    gridNameInput.focus();
  }

  function openEditGridModal(grid, focusFeedIndex = null) {
    gridForm.reset();
    resetFormValidationState(gridForm);
    gridIdInput.value = grid.id;
    gridNameInput.value = grid.name;

    const feeds = Array.isArray(grid.feeds) ? grid.feeds : [];
    for (let i = 0; i < 4; i++) {
      const feed = normalizeFeedEntry(feeds[i]);
      feedInputs[i].value = feed.url;
      setFeedAudioControlState(i, feed.volume, feed.muted);
    }

    gridModalTitle.textContent = `Edit "${grid.name}"`;
    saveGridBtn.textContent = 'Save Changes';
    formServerError.hidden = true;
    gridModal.showModal();

    if (typeof focusFeedIndex === 'number' && feedInputs[focusFeedIndex]) {
      feedInputs[focusFeedIndex].focus();
    } else {
      gridNameInput.focus();
    }
  }

  gridForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    formServerError.hidden = true;

    // Validate fields and focus first invalid field if checkValidity fails
    if (!gridForm.checkValidity()) {
      const firstInvalid = gridForm.querySelector(':invalid');
      firstInvalid?.focus();
      return;
    }

    const editingId = gridIdInput.value.trim();
    const payload = {
      name: gridNameInput.value.trim(),
      feeds: [0, 1, 2, 3].map((i) => ({
        url: feedInputs[i].value.trim(),
        volume: Number(feedVolSliders[i].value),
        muted: feedMuteBtns[i].getAttribute('aria-pressed') === 'true'
      }))
    };

    saveGridBtn.disabled = true;
    try {
      const url = editingId ? `/api/grids/${encodeURIComponent(editingId)}` : '/api/grids';
      const method = editingId ? 'PUT' : 'POST';

      const data = await requestJson(
        url,
        {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        },
        'Could not save grid.'
      );

      await fetchGrids();
      await closeTopLayer(gridModal);

      if (activeGridId === data.id) {
        updateActivePlayerWall(data);
      } else {
        renderLandingList();
        showStatusBanner(
          editingId ? `Updated grid "${data.name}".` : `Created grid "${data.name}".`
        );
      }
    } catch (err) {
      formServerError.textContent = err.message;
      formServerError.hidden = false;
    } finally {
      saveGridBtn.disabled = false;
    }
  });

  function openDeleteModal(grid) {
    pendingDeleteGridId = grid.id;
    deleteGridNameEl.textContent = `"${grid.name}"`;
    deleteModal.showModal();
    cancelDeleteBtn.focus();
  }

  confirmDeleteBtn.addEventListener('click', async () => {
    if (!pendingDeleteGridId) return;
    const idToDelete = pendingDeleteGridId;
    const gridObj = grids.find((g) => g.id === idToDelete);

    confirmDeleteBtn.disabled = true;
    try {
      await requestJson(
        `/api/grids/${encodeURIComponent(idToDelete)}`,
        { method: 'DELETE' },
        'Failed to delete grid.'
      );
      pendingDeleteGridId = null;
      await fetchGrids();
      await closeTopLayer(deleteModal);
      renderLandingList();
      if (gridObj) {
        showStatusBanner(`Deleted grid "${gridObj.name}".`);
      }
    } catch (err) {
      alert(err.message);
    } finally {
      confirmDeleteBtn.disabled = false;
    }
  });

  // Wire up modal buttons
  newGridBtn.addEventListener('click', openAddGridModal);
  emptyNewGridBtn.addEventListener('click', openAddGridModal);
  closeGridModalBtn.addEventListener('click', () => closeTopLayer(gridModal));
  cancelGridModalBtn.addEventListener('click', () => closeTopLayer(gridModal));

  closeDeleteModalBtn.addEventListener('click', () => closeTopLayer(deleteModal));
  cancelDeleteBtn.addEventListener('click', () => closeTopLayer(deleteModal));

  gridModal.addEventListener('close', () => schedulePlayerViewportSync({ withRotationRetries: true }));
  deleteModal.addEventListener('close', () => schedulePlayerViewportSync({ withRotationRetries: true }));

  // Wire up Player HUD buttons
  playerHudToggle.addEventListener('click', (e) => {
    setPlayerHudOpen(true);
    if (e.detail === 0) {
      backToGridsBtn.focus();
    }
  });

  closeHudBtn.addEventListener('click', (e) => {
    setPlayerHudOpen(false, e.detail === 0);
  });

  document.addEventListener('pointerdown', (e) => {
    if (playerHud.dataset.open === 'true' && !playerHud.contains(e.target)) {
      setPlayerHudOpen(false);
    }
  });

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && playerHud.dataset.open === 'true' && !gridModal.open && !deleteModal.open) {
      setPlayerHudOpen(false, true);
      return;
    }

    if (
      (e.key === 'f' || e.key === 'F') &&
      !e.repeat &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey &&
      !playerView.hidden &&
      activeGridId &&
      !gridModal.open &&
      !deleteModal.open &&
      !e.target?.closest?.('input, textarea, select, [contenteditable]') &&
      !e.target?.isContentEditable
    ) {
      e.preventDefault();
      toggleFullscreen();
    }
  });

  backToGridsBtn.addEventListener('click', () => {
    setPlayerHudOpen(false);
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    navigateToLanding();
  });

  editActiveGridBtn.addEventListener('click', () => {
    setPlayerHudOpen(false);
    const grid = grids.find((g) => g.id === activeGridId);
    if (grid) openEditGridModal(grid);
  });

  fullscreenBtn.addEventListener('click', toggleFullscreen);

  document.addEventListener('fullscreenchange', () => {
    fullscreenLabel.textContent = document.fullscreenElement ? 'Exit Fullscreen' : 'Fullscreen';
    schedulePlayerViewportSync();
  });

  // ==========================================
  // 8. INITIALIZATION
  // ==========================================

  (async function init() {
    fetchVersion();
    try {
      await fetchGrids();
    } catch (err) {
      console.error(err);
    }
    handleRouteChange();
  })();
})();
