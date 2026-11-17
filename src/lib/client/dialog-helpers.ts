let supportsDisplayTransition: boolean | undefined;

function canTransitionDisplay(): boolean {
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

function supportsTopLayerExit(): boolean {
  return Boolean(window.CSS?.supports?.('overlay', 'auto')) && canTransitionDisplay();
}

export async function closeTopLayer(dialog: HTMLDialogElement | null): Promise<void> {
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

export function wireDialogBehavior(dialog: HTMLDialogElement): () => void {
  const cleanups: Array<() => void> = [];

  if (!('closedBy' in HTMLDialogElement.prototype)) {
    const outside = (e: PointerEvent) => {
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    let pressedOutside = false;
    const onPointerDown = (e: PointerEvent) => {
      if (e.target !== dialog) {
        pressedOutside = false;
        return;
      }
      pressedOutside = outside(e);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (pressedOutside && e.target === dialog && outside(e)) {
        closeTopLayer(dialog);
      }
      pressedOutside = false;
    };
    dialog.addEventListener('pointerdown', onPointerDown);
    dialog.addEventListener('pointerup', onPointerUp);
    cleanups.push(() => {
      dialog.removeEventListener('pointerdown', onPointerDown);
      dialog.removeEventListener('pointerup', onPointerUp);
    });
  }

  const onCancel = (event: Event) => {
    event.preventDefault();
    closeTopLayer(dialog);
  };
  const onClose = () => {
    dialog.returnValue = '';
  };

  dialog.addEventListener('cancel', onCancel);
  dialog.addEventListener('close', onClose);
  cleanups.push(() => {
    dialog.removeEventListener('cancel', onCancel);
    dialog.removeEventListener('close', onClose);
  });

  return () => {
    for (const fn of cleanups) fn();
  };
}

export interface FormValidationController {
  reset: () => void;
  destroy: () => void;
}

export function createFormValidationController(form: HTMLFormElement): FormValidationController {
  const supportsUserInvalid = Boolean(window.CSS?.supports?.('selector(:user-invalid)'));
  const flagged = new WeakSet<Element>();
  const announced = new WeakSet<Element>();
  const dirtyState = new WeakMap<Element, { hasInteracted: boolean; hasBlurred: boolean }>();

  const announcer = document.createElement('div');
  announcer.setAttribute('aria-live', 'polite');
  announcer.classList.add('visually-hidden');
  document.body.append(announcer);

  let announceTimer: ReturnType<typeof setTimeout> | undefined;
  let announcedField: HTMLInputElement | undefined;

  const linkError = (el: HTMLElement, shown: boolean) => {
    const errorId = el.dataset?.error;
    if (!errorId) return;
    const ids = (el.getAttribute('aria-describedby') || '')
      .split(/\s+/)
      .filter((id) => id && id !== errorId);
    if (shown) ids.push(errorId);
    if (ids.length) el.setAttribute('aria-describedby', ids.join(' '));
    else el.removeAttribute('aria-describedby');
  };

  const spokenText = (node: Node) => {
    const copy = node.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
    copy.querySelectorAll('[role="img"][aria-label]').forEach((n) => {
      n.replaceWith(`${n.getAttribute('aria-label')}: `);
    });
    return (copy.textContent || '').replace(/\s+/g, ' ').trim();
  };

  const announceError = (el: HTMLInputElement) => {
    const errorId = el.dataset.error;
    if (!errorId) return;
    const error = document.getElementById(errorId);
    if (!error) return;
    const label = el.labels?.[0] ? `${spokenText(el.labels[0])}: ` : '';
    clearTimeout(announceTimer);
    announcer.textContent = '';
    announcedField = el;
    announceTimer = setTimeout(() => {
      announcer.textContent = label + spokenText(error);
    }, 500);
  };

  const syncAria = (el: HTMLInputElement, announce = false) => {
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

  const onBlur = (e: FocusEvent) => {
    const input = e.target as HTMLInputElement | null;
    if (!input?.matches?.('input[type="text"]')) return;
    if (!supportsUserInvalid && typeof input.checkValidity === 'function') {
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
  };

  const onInput = (e: Event) => {
    const input = e.target as HTMLInputElement | null;
    if (!input?.matches?.('input[type="text"]')) return;
    if (!supportsUserInvalid && typeof input.checkValidity === 'function') {
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
  };

  const onInvalid = (e: Event) => {
    const input = e.target as HTMLInputElement | null;
    if (!input?.matches?.('input[type="text"]')) return;
    if (!supportsUserInvalid) {
      dirtyState.set(input, { hasInteracted: true, hasBlurred: true });
      input.classList.add('user-invalid-fallback');
      input.classList.remove('user-valid-fallback');
    }
    announced.add(input);
    syncAria(input);
  };

  form.addEventListener('blur', onBlur, true);
  form.addEventListener('input', onInput);
  form.addEventListener('invalid', onInvalid, true);

  return {
    reset() {
      for (const control of Array.from(form.elements)) {
        if (!control.matches?.('input[type="text"]')) continue;
        const input = control as HTMLInputElement;
        dirtyState.delete(input);
        flagged.delete(input);
        announced.delete(input);
        input.classList.remove('user-invalid-fallback', 'user-valid-fallback');
        input.setAttribute('aria-invalid', 'false');
        linkError(input, false);
      }
    },
    destroy() {
      clearTimeout(announceTimer);
      form.removeEventListener('blur', onBlur, true);
      form.removeEventListener('input', onInput);
      form.removeEventListener('invalid', onInvalid, true);
      announcer.remove();
    }
  };
}
