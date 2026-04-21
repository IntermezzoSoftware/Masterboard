/**
 * Masterboard mark — compact app icon for the sidebar.
 * Uses PNG assets (not SVG) because SVGs render poorly at 125% scaling on 1440p.
 * mark-dark.png = white mark (from appicon.png), for dark theme.
 * mark-light.png = dark mark (from appicon-light.png), for light theme.
 * ("light"/"dark" in the filename = which theme it's for, not the mark colour.)
 */
import { useTheme } from '@/context/ThemeContext'

export default function MasterboardMark({ size = 24 }: { size?: number }) {
  const { theme } = useTheme()

  return (
    <img
      src={theme === 'dark' ? '/mark-dark.png' : '/mark-light.png'}
      alt="Masterboard"
      draggable={false}
      width={size}
      height={size}
      style={{ display: 'block', imageRendering: 'auto' }}
    />
  )
}
