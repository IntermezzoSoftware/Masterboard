/**
 * Formats a PGN time control string (seconds+increment) into a human-readable
 * form. Examples: "120+1" → "2+1", "600+0" → "10+0", "30+0" → "30s+0".
 */
export function formatTimeControl(tc: string): string {
  if (!tc || tc === '-' || tc === '?') return '—'
  const match = tc.match(/^(\d+)(?:\+(\d+))?$/)
  if (!match) return tc
  const baseSec = parseInt(match[1], 10)
  const incSec  = match[2] !== undefined ? parseInt(match[2], 10) : 0
  const inc     = `+${incSec}`
  if (baseSec >= 60) {
    const mins = baseSec / 60
    return `${Number.isInteger(mins) ? mins : mins.toFixed(1)}${inc}`
  }
  return `${baseSec}s${inc}`
}
