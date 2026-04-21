import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import './style.css'
import { ThemeProvider } from '@/context/ThemeContext'
import { router } from './router'
import SplashScreen from '@/components/SplashScreen'
import SetupWizard from '@/components/SetupWizard'

// When Escape closes a Radix menu, the browser returns focus to the trigger and marks
// it :focus-visible (keyboard context). Defer blur() to fire after Radix's synchronous
// focus restoration so no focus ring persists on the trigger.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    window.requestAnimationFrame(() => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur()
      }
    })
  }
}, { capture: true })

function AppRoot() {
  const splashDisabled = localStorage.getItem('masterboard-splashEnabled') === 'false'
  const [splashDone, setSplashDone] = useState(splashDisabled)
  const [appVisible, setAppVisible] = useState(splashDisabled)
  return (
    <>
      {!splashDone && (
        <SplashScreen
          onExiting={() => setAppVisible(true)}
          onDone={() => setSplashDone(true)}
        />
      )}
      <div className={`h-full${!splashDisabled && appVisible && !splashDone ? ' app-fade-in' : ''}`}>
        <RouterProvider router={router} />
      </div>
      {splashDone && <SetupWizard />}
    </>
  )
}

const root = createRoot(document.getElementById('root')!)

root.render(
  <ThemeProvider>
    <AppRoot />
  </ThemeProvider>
)
