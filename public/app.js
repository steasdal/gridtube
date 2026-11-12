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

  function buildEmbedUrl(rawUrl) {
    const videoId = extractYouTubeId(rawUrl);
    if (!videoId) return null;
    const params = new URLSearchParams({
      autoplay: '1',
      playsinline: '1',
      rel: '0'
    });
    return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?${params.toString()}`;
  }

  function buildThumbnailUrl(rawUrl) {
    const videoId = extractYouTubeId(rawUrl);
    if (!videoId) return null;
    return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/mqdefault.jpg`;
  }

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

  const newGridBtn = document.getElementById('new-grid-btn');
  const emptyNewGridBtn = document.getElementById('empty-new-grid-btn');
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

  async function fetchGrids() {
    const res = await fetch('/api/grids', { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('Failed to load saved grids.');
    grids = await res.json();
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

  function renderPlayerWall(grid) {
    streamWall.innerHTML = '';
    playerGridTitle.textContent = grid.name;

    const feeds = Array.isArray(grid.feeds) ? grid.feeds : ['', '', '', ''];
    const slotPositions = ['Top-Left', 'Top-Right', 'Bottom-Left', 'Bottom-Right'];

    for (let i = 0; i < 4; i++) {
      const rawUrl = feeds[i] || '';
      const embedUrl = buildEmbedUrl(rawUrl);
      const pane = document.createElement('div');
      pane.className = 'stream-pane';

      if (embedUrl) {
        const iframe = document.createElement('iframe');
        iframe.className = 'stream-frame';
        iframe.src = embedUrl;
        iframe.title = `${grid.name} — Pane ${i + 1} (${slotPositions[i]}) YouTube Live Feed`;
        iframe.allow =
          'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
        iframe.allowFullscreen = true;
        iframe.referrerPolicy = 'strict-origin-when-cross-origin';
        pane.appendChild(iframe);
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
        configBtn.addEventListener('click', () => openEditGridModal(grid, i));

        emptyBox.append(badge, label, configBtn);
        pane.appendChild(emptyBox);
      }

      streamWall.appendChild(pane);
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

  function handleRouteChange() {
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

      runViewTransition(() => {
        landingView.hidden = true;
        playerView.hidden = false;
        renderPlayerWall(grid);
      }, playerView);
    } else {
      activeGridId = null;
      document.title = 'GridTube — 2×2 YouTube Live Stream Wall';

      runViewTransition(() => {
        // Stop active video streams when returning to landing page
        streamWall.innerHTML = '';
        playerView.hidden = true;
        landingView.hidden = false;
        renderLandingList();
      }, landingHeading);
    }
  }

  window.addEventListener('hashchange', handleRouteChange);

  // ==========================================
  // 7. MODAL CONTROLLERS (ADD/EDIT & DELETE)
  // ==========================================

  function openAddGridModal() {
    gridForm.reset();
    resetFormValidationState(gridForm);
    gridIdInput.value = '';
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

    const feeds = Array.isArray(grid.feeds) ? grid.feeds : ['', '', '', ''];
    for (let i = 0; i < 4; i++) {
      feedInputs[i].value = feeds[i] || '';
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
      feeds: feedInputs.map((input) => input.value.trim())
    };

    saveGridBtn.disabled = true;
    try {
      const url = editingId ? `/api/grids/${encodeURIComponent(editingId)}` : '/api/grids';
      const method = editingId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Could not save grid.');
      }

      await fetchGrids();
      await closeTopLayer(gridModal);

      if (activeGridId === data.id) {
        renderPlayerWall(data);
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
      const res = await fetch(`/api/grids/${encodeURIComponent(idToDelete)}`, {
        method: 'DELETE'
      });
      if (!res.ok) {
        throw new Error('Failed to delete grid.');
      }
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

  // Wire up Player HUD buttons
  backToGridsBtn.addEventListener('click', () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    navigateToLanding();
  });

  editActiveGridBtn.addEventListener('click', () => {
    const grid = grids.find((g) => g.id === activeGridId);
    if (grid) openEditGridModal(grid);
  });

  fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });

  document.addEventListener('fullscreenchange', () => {
    fullscreenLabel.textContent = document.fullscreenElement ? 'Exit Fullscreen' : 'Fullscreen';
  });

  // ==========================================
  // 8. INITIALIZATION
  // ==========================================

  (async function init() {
    try {
      await fetchGrids();
    } catch (err) {
      console.error(err);
    }
    handleRouteChange();
  })();
})();
