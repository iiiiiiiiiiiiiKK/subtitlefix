import '@testing-library/jest-dom/vitest';

// jsdom lacks a few browser APIs the app touches during render.
if (!globalThis.matchMedia) {
  Object.defineProperty(globalThis, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

if (!globalThis.URL.createObjectURL) {
  Object.defineProperty(globalThis.URL, 'createObjectURL', {
    writable: true,
    value: () => 'blob:mock',
  });
  Object.defineProperty(globalThis.URL, 'revokeObjectURL', {
    writable: true,
    value: () => {},
  });
}

// jsdom has no <dialog> implementation; provide the bits the app uses.
if (typeof HTMLDialogElement !== 'undefined') {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
  }
}

// ResizeObserver is used by the cue list virtualiser.
if (!globalThis.ResizeObserver) {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    writable: true,
    value: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
}
