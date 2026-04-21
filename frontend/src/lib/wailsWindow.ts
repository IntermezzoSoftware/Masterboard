// Typed declaration for the Wails runtime window.go binding.
// Wails injects window.go.main.App with all exported *App methods at startup.
interface WailsAppBinding {
  SetTitleBarTheme: (theme: boolean) => Promise<void>
}

interface WailsGoBinding {
  main: { App: WailsAppBinding }
}

declare global {
  interface Window {
    go?: WailsGoBinding
  }
}

export {}
