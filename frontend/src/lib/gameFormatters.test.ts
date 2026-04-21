import { describe, it, expect } from 'vitest'
import { formatTimeControl } from './gameFormatters'

describe('formatTimeControl', () => {
  it('returns em dash for empty string', () => {
    expect(formatTimeControl('')).toBe('—')
  })
  it('returns em dash for dash sentinel', () => {
    expect(formatTimeControl('-')).toBe('—')
  })
  it('returns em dash for question mark sentinel', () => {
    expect(formatTimeControl('?')).toBe('—')
  })
  it('converts 120+1 to 2+1', () => {
    expect(formatTimeControl('120+1')).toBe('2+1')
  })
  it('converts 600+0 to 10+0', () => {
    expect(formatTimeControl('600+0')).toBe('10+0')
  })
  it('converts 90+0 to 1.5+0 (non-integer minutes)', () => {
    expect(formatTimeControl('90+0')).toBe('1.5+0')
  })
  it('keeps seconds below 60 with s suffix: 30+0 → 30s+0', () => {
    expect(formatTimeControl('30+0')).toBe('30s+0')
  })
  it('keeps seconds below 60 with increment: 15+10 → 15s+10', () => {
    expect(formatTimeControl('15+10')).toBe('15s+10')
  })
  it('passes through unrecognised format unchanged', () => {
    expect(formatTimeControl('∞')).toBe('∞')
  })
  it('handles format with no increment: 300 → 5+0', () => {
    expect(formatTimeControl('300')).toBe('5+0')
  })
})
