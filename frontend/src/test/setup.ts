import '@testing-library/jest-dom'

// scrollIntoView is not implemented in jsdom — provide a no-op stub.
Element.prototype.scrollIntoView = () => {}

// ResizeObserver is not implemented in jsdom — provide a no-op stub.
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// matchMedia is not implemented in jsdom — provide a default stub.
// Tests that need specific behaviour (e.g. dark mode preference) can
// override this with Object.defineProperty in their own beforeEach.
Object.defineProperty(window, 'matchMedia', {
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
})
