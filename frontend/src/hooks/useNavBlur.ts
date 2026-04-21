import { useEffect } from 'react'

const NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'])
const INPUT_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/**
 * Blurs any mouse-focused non-input element when a navigation key is pressed,
 * preventing the browser from upgrading mouse-initiated focus to :focus-visible
 * when arrow keys are used for board navigation.
 *
 * Tracks the element that *receives focus* following a pointerdown (rather than
 * e.target on mousedown), which correctly handles cases where the clicked child
 * element differs from the focusable ancestor (e.g. dnd-kit tab items with
 * child drop-zone overlays).
 */
export function useNavBlur() {
  useEffect(() => {
    let lastPointerDown = 0
    let mouseFocusedEl: HTMLElement | null = null

    function onPointerDown() {
      lastPointerDown = performance.now()
    }

    function onFocus(e: FocusEvent) {
      const t = e.target as HTMLElement
      if (performance.now() - lastPointerDown < 300) {
        mouseFocusedEl = INPUT_TAGS.has(t.tagName) ? null : t
      } else {
        // Keyboard-initiated focus — clear so nav keys don't blur it.
        mouseFocusedEl = null
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      if (NAV_KEYS.has(e.key) && mouseFocusedEl && document.activeElement === mouseFocusedEl) {
        mouseFocusedEl.blur()
        mouseFocusedEl = null
      }
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('focus', onFocus, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('focus', onFocus, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [])
}
