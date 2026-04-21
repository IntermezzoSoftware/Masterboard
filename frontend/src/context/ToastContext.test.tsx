import { render, screen, act, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ToastProvider, useToast, useToastState } from './ToastContext'


function ToastDisplay() {
  const { toasts, removeToast } = useToastState()
  return (
    <ul>
      {toasts.map(t => (
        <li key={t.id} data-testid={`toast-${t.id}`} data-type={t.type} data-dismissing={String(!!t.dismissing)}>
          {t.message}
          <button onClick={() => removeToast(t.id)}>dismiss</button>
        </li>
      ))}
    </ul>
  )
}

function Trigger({ message, type }: { message: string; type?: 'success' | 'error' }) {
  const showToast = useToast()
  return <button onClick={() => showToast(message, type)}>show-{message}</button>
}


describe('ToastContext', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.runAllTimers()
    vi.useRealTimers()
  })

  it('starts with no toasts', () => {
    render(
      <ToastProvider>
        <Trigger message="hello" />
        <ToastDisplay />
      </ToastProvider>
    )
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('adds a toast when showToast is called', () => {
    render(
      <ToastProvider>
        <Trigger message="Success!" />
        <ToastDisplay />
      </ToastProvider>
    )
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'show-Success!' })) })
    expect(screen.getByText('Success!')).toBeInTheDocument()
  })

  it('defaults to success type', () => {
    render(
      <ToastProvider>
        <Trigger message="ok" />
        <ToastDisplay />
      </ToastProvider>
    )
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'show-ok' })) })
    const item = screen.getAllByRole('listitem')[0]
    expect(item.getAttribute('data-type')).toBe('success')
  })

  it('respects error type', () => {
    render(
      <ToastProvider>
        <Trigger message="fail" type="error" />
        <ToastDisplay />
      </ToastProvider>
    )
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'show-fail' })) })
    const item = screen.getAllByRole('listitem')[0]
    expect(item.getAttribute('data-type')).toBe('error')
  })

  it('auto-dismisses after 2500ms + 150ms animation', () => {
    render(
      <ToastProvider>
        <Trigger message="bye" />
        <ToastDisplay />
      </ToastProvider>
    )
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'show-bye' })) })
    expect(screen.getByText('bye')).toBeInTheDocument()

    act(() => { vi.advanceTimersByTime(2500 + 150) })
    expect(screen.queryByText('bye')).not.toBeInTheDocument()
  })

  it('marks toast as dismissing before removal', () => {
    render(
      <ToastProvider>
        <Trigger message="fade" />
        <ToastDisplay />
      </ToastProvider>
    )
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'show-fade' })) })

    act(() => { vi.advanceTimersByTime(2500) })
    const items = screen.getAllByRole('listitem')
    expect(items[0].getAttribute('data-dismissing')).toBe('true')

    act(() => { vi.advanceTimersByTime(150) })
    expect(screen.queryByText('fade')).not.toBeInTheDocument()
  })

  it('removeToast dismisses only the targeted toast', () => {
    render(
      <ToastProvider>
        <Trigger message="first" />
        <Trigger message="second" />
        <ToastDisplay />
      </ToastProvider>
    )

    act(() => { fireEvent.click(screen.getByRole('button', { name: 'show-first' })) })
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'show-second' })) })

    expect(screen.getByText('first')).toBeInTheDocument()
    expect(screen.getByText('second')).toBeInTheDocument()

    act(() => { fireEvent.click(screen.getAllByRole('button', { name: 'dismiss' })[0]) })
    act(() => { vi.advanceTimersByTime(150) })

    expect(screen.queryByText('first')).not.toBeInTheDocument()
    expect(screen.getByText('second')).toBeInTheDocument()
  })

  it('throws when useToast is called outside provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Trigger message="x" />)).toThrow('useToast must be used inside ToastProvider')
    spy.mockRestore()
  })

  it('throws when useToastState is called outside provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<ToastDisplay />)).toThrow('useToastState must be used inside ToastProvider')
    spy.mockRestore()
  })
})
