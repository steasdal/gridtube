export interface PlatformFlags {
  isIOS: boolean;
  isIPad: boolean;
  isCriOS: boolean;
  isTouchMobile: boolean;
}

export function detectPlatformFlags(): PlatformFlags {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') {
    return { isIOS: false, isIPad: false, isCriOS: false, isTouchMobile: false };
  }
  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isIPad =
    /iPad/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isCriOS = /CriOS/.test(navigator.userAgent);
  const isTouchMobile = isIOS || Boolean(window.matchMedia?.('(pointer: coarse)')?.matches);
  return { isIOS, isIPad, isCriOS, isTouchMobile };
}

interface OrientationState {
  minScreenDim: number;
  maxScreenDim: number;
  isPhysicalLandscape: boolean;
}

export function createPlayerViewportController({
  playerView,
  streamWall,
  isModalOpen
}: {
  playerView: HTMLElement;
  streamWall: HTMLElement;
  isModalOpen: () => boolean;
}) {
  const { isIOS, isIPad, isCriOS } = detectPlatformFlags();
  let viewportMeta = document.querySelector('meta[name="viewport"]');
  const BASE_VIEWPORT_CONTENT = isIPad
    ? 'width=device-width, initial-scale=1'
    : 'width=device-width, initial-scale=1, viewport-fit=cover';

  if (isIPad && viewportMeta) {
    // iPads have no notch; viewport-fit=cover can lock WKWebView layout width to portrait on rotation
    viewportMeta.setAttribute('content', BASE_VIEWPORT_CONTENT);
  }

  let viewportMetaRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let viewportMetaRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let forcedLandscapeMetaWidth = 0;
  let splitViewBypassedLandscapeWidth = false;
  let playerViewportTimers: Array<ReturnType<typeof setTimeout>> = [];

  function getViewportMetrics() {
    const vv = window.visualViewport;
    const scale = vv && Number.isFinite(vv.scale) && vv.scale > 0 ? vv.scale : 1;
    const vvWidth = vv && vv.width > 0 ? Math.round(vv.width * scale) : 0;
    const vvHeight = vv && vv.height > 0 ? Math.round(vv.height * scale) : 0;
    const innerW = Math.round(window.innerWidth || 0);
    const innerH = Math.round(window.innerHeight || 0);
    const clientW = Math.round(document.documentElement.clientWidth || 0);
    const clientH = Math.round(document.documentElement.clientHeight || 0);
    return { scale, vvWidth, vvHeight, innerW, innerH, clientW, clientH };
  }

  function getIPadOrientationState(): OrientationState {
    const screenW = Math.round(window.screen?.width || 0);
    const screenH = Math.round(window.screen?.height || 0);
    const minScreenDim = Math.min(screenW, screenH);
    const maxScreenDim = Math.max(screenW, screenH);
    const orientType = window.screen?.orientation?.type || '';
    const legacyAngle =
      typeof (window as Window & { orientation?: number }).orientation === 'number'
        ? Math.abs((window as Window & { orientation?: number }).orientation!)
        : null;
    const isPhysicalLandscape =
      orientType.startsWith('landscape') ||
      legacyAngle === 90 ||
      Boolean(window.matchMedia?.('(orientation: landscape)')?.matches);
    return { minScreenDim, maxScreenDim, isPhysicalLandscape };
  }

  function isIPadLandscapeWidthStuck(
    orientationState: OrientationState,
    reportedW: number,
    reportedH: number
  ): boolean {
    const { minScreenDim, maxScreenDim, isPhysicalLandscape } = orientationState;
    return (
      isPhysicalLandscape &&
      minScreenDim > 0 &&
      maxScreenDim > minScreenDim &&
      reportedH > 0 &&
      reportedH < minScreenDim - 16 &&
      Math.abs(reportedW - minScreenDim) <= 12
    );
  }

  function setViewportMetaContent(nextContent: string, { forceReparse = false } = {}) {
    if (!viewportMeta) return;
    if (viewportMeta.getAttribute('content') === nextContent) {
      if (!forceReparse) return;
      const freshMeta = document.createElement('meta');
      freshMeta.setAttribute('name', 'viewport');
      freshMeta.setAttribute('content', nextContent);
      viewportMeta.replaceWith(freshMeta);
      viewportMeta = freshMeta;
      return;
    }
    viewportMeta.setAttribute('content', nextContent);
  }

  function reconcileIPadViewport({ allowMetaMutation = true, forceReparse = false } = {}) {
    if (!isIPad || !viewportMeta) return;
    const { scale, vvWidth, vvHeight, innerW, innerH, clientW, clientH } = getViewportMetrics();
    const orientationState = getIPadOrientationState();
    const { minScreenDim, maxScreenDim, isPhysicalLandscape } = orientationState;

    if (minScreenDim <= 0 || maxScreenDim <= minScreenDim) return;

    const reportedW = Math.max(vvWidth, innerW, clientW);
    const reportedH = vvHeight || innerH || clientH;

    if (!isPhysicalLandscape) {
      splitViewBypassedLandscapeWidth = false;
      forcedLandscapeMetaWidth = 0;
      setViewportMetaContent(BASE_VIEWPORT_CONTENT, {
        forceReparse: forceReparse && reportedW > minScreenDim + 12
      });
      return;
    }

    if (reportedW > minScreenDim + 12 || (reportedW > 0 && reportedW < minScreenDim - 16)) {
      splitViewBypassedLandscapeWidth = false;
    }

    // If forcing landscape width zoomed the page out, WKWebView is inside a narrower Split View window
    if (forcedLandscapeMetaWidth > 0 && scale < 0.92) {
      splitViewBypassedLandscapeWidth = true;
      forcedLandscapeMetaWidth = 0;
      setViewportMetaContent(BASE_VIEWPORT_CONTENT, { forceReparse: true });
      return;
    }

    if (
      allowMetaMutation &&
      !splitViewBypassedLandscapeWidth &&
      isIPadLandscapeWidthStuck(orientationState, reportedW, reportedH)
    ) {
      forcedLandscapeMetaWidth = maxScreenDim;
      setViewportMetaContent(`width=${maxScreenDim}, initial-scale=1`, { forceReparse });
      if (forceReparse) {
        const prevY = window.scrollY;
        window.scrollBy(0, 1);
        window.scrollTo(window.scrollX, prevY);
      }
    }
  }

  function refreshIOSViewportMeta() {
    if (!isIOS || !viewportMeta) return;
    if (isIPad) {
      reconcileIPadViewport({ allowMetaMutation: isCriOS, forceReparse: true });
      return;
    }
    if (viewportMetaRefreshTimer) {
      clearTimeout(viewportMetaRefreshTimer);
      viewportMetaRefreshTimer = null;
    }
    viewportMeta.setAttribute(
      'content',
      BASE_VIEWPORT_CONTENT.replace('initial-scale=1', 'initial-scale=1.0001')
    );
    viewportMetaRefreshTimer = setTimeout(() => {
      viewportMeta?.setAttribute('content', BASE_VIEWPORT_CONTENT);
      viewportMetaRefreshTimer = null;
    }, 50);
  }

  function scheduleIOSViewportMetaRefresh() {
    if (!isIOS || !viewportMeta) return;
    if (viewportMetaRetryTimer) {
      clearTimeout(viewportMetaRetryTimer);
      viewportMetaRetryTimer = null;
    }
    refreshIOSViewportMeta();
    viewportMetaRetryTimer = setTimeout(() => {
      if (isIPad) {
        reconcileIPadViewport({ allowMetaMutation: true, forceReparse: true });
      } else {
        refreshIOSViewportMeta();
      }
      viewportMetaRetryTimer = null;
    }, 380);
  }

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

  function syncPlayerViewport({ fromTimer = false } = {}) {
    if (isIPad) {
      reconcileIPadViewport({ allowMetaMutation: isCriOS || fromTimer });
    }

    if (document.fullscreenElement) {
      clearPlayerViewportOverrides();
      return;
    }

    if (isModalOpen()) {
      return;
    }

    const { scale, vvWidth, vvHeight, innerW, innerH, clientW, clientH } = getViewportMetrics();
    let vpWidth = isIOS ? Math.max(vvWidth, innerW, clientW) : vvWidth || innerW || clientW;
    const vpHeight = vvHeight || innerH || clientH;

    if (vpWidth <= 0 || vpHeight <= 0) return;

    if (isIPad && !splitViewBypassedLandscapeWidth && scale >= 0.95) {
      const orientationState = getIPadOrientationState();
      const outerW = Math.round(window.outerWidth || 0);
      if (isIPadLandscapeWidthStuck(orientationState, vpWidth, vpHeight)) {
        vpWidth =
          outerW > vpWidth && outerW <= orientationState.maxScreenDim
            ? outerW
            : orientationState.maxScreenDim;
      }
    }

    if (!isIOS) {
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
      void streamWall.offsetHeight;
    }
  }

  function schedulePlayerViewportSync({ withRotationRetries = false } = {}) {
    clearPlayerViewportSyncTimers();
    requestAnimationFrame(() => syncPlayerViewport());

    if (withRotationRetries || isIOS) {
      const delays = withRotationRetries ? [50, 180, 380, 650, 950] : [60, 220];
      for (const delay of delays) {
        playerViewportTimers.push(
          setTimeout(() => {
            if (isIPad && delay >= 350) {
              reconcileIPadViewport({ allowMetaMutation: true, forceReparse: true });
            }
            syncPlayerViewport({ fromTimer: true });
          }, delay)
        );
      }
    }
  }

  const onResize = () => schedulePlayerViewportSync();
  const onOrientation = () => {
    scheduleIOSViewportMetaRefresh();
    schedulePlayerViewportSync({ withRotationRetries: true });
  };
  const onFullscreen = () => {
    schedulePlayerViewportSync();
  };

  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onOrientation);
  window.visualViewport?.addEventListener('resize', onResize);
  screen.orientation?.addEventListener?.('change', onOrientation);
  document.addEventListener('fullscreenchange', onFullscreen);

  if (isIPad) {
    reconcileIPadViewport({ allowMetaMutation: true, forceReparse: isCriOS });
  }
  syncPlayerViewport();
  schedulePlayerViewportSync({ withRotationRetries: true });

  return {
    scheduleSync: schedulePlayerViewportSync,
    destroy() {
      clearPlayerViewportSyncTimers();
      if (viewportMetaRefreshTimer) clearTimeout(viewportMetaRefreshTimer);
      if (viewportMetaRetryTimer) clearTimeout(viewportMetaRetryTimer);
      clearPlayerViewportOverrides();
      if (isIPad && viewportMeta) {
        setViewportMetaContent(BASE_VIEWPORT_CONTENT);
      }
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onOrientation);
      window.visualViewport?.removeEventListener('resize', onResize);
      screen.orientation?.removeEventListener?.('change', onOrientation);
      document.removeEventListener('fullscreenchange', onFullscreen);
    }
  };
}
