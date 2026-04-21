/**
 * Thin wrapper around the Wails JS runtime event API.
 * Kept separate so tests can mock this module instead of the generated
 * wailsjs/runtime/runtime file, which cannot be resolved by Vite's
 * import-analysis plugin in the jsdom test environment.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Subscribe to a named Wails event. Returns an unsubscribe function.
 * In production this delegates to window.runtime.EventsOnMultiple.
 * In tests this module is mocked entirely.
 */
export function EventsOn(
  eventName: string,
  callback: (...data: any[]) => void,
): () => void {
  return (window as any).runtime?.EventsOnMultiple(eventName, callback, -1) ?? (() => {})
}

/** Minimize the window. */
export function WindowMinimise(): void {
  ;(window as any).runtime?.WindowMinimise()
}

/** Toggle between maximised and normal window state. */
export function WindowToggleMaximise(): void {
  ;(window as any).runtime?.WindowToggleMaximise()
}

/** Returns whether the window is currently maximised. */
export async function WindowIsMaximised(): Promise<boolean> {
  return (window as any).runtime?.WindowIsMaximised() ?? false
}

/** Quit the application. */
export function Quit(): void {
  ;(window as any).runtime?.Quit()
}
