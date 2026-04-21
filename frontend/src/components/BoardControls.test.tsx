import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BoardControls from './BoardControls'

const noop = () => {}

describe('BoardControls', () => {
  it('renders all five buttons', () => {
    render(
      <BoardControls
        canGoBack={true} canGoForward={true}
        onGoToStart={noop} onGoBack={noop} onGoForward={noop} onGoToEnd={noop} onFlip={noop}
      />
    )
    expect(screen.getByRole('button', { name: 'Go to start' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous move' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next move' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go to end' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Flip board' })).toBeInTheDocument()
  })

  it('back/start buttons are aria-disabled when canGoBack is false', () => {
    render(
      <BoardControls
        canGoBack={false} canGoForward={true}
        onGoToStart={noop} onGoBack={noop} onGoForward={noop} onGoToEnd={noop} onFlip={noop}
      />
    )
    expect(screen.getByRole('button', { name: 'Go to start' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'Previous move' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'Next move' })).toHaveAttribute('aria-disabled', 'false')
    expect(screen.getByRole('button', { name: 'Go to end' })).toHaveAttribute('aria-disabled', 'false')
  })

  it('forward/end buttons are aria-disabled when canGoForward is false', () => {
    render(
      <BoardControls
        canGoBack={true} canGoForward={false}
        onGoToStart={noop} onGoBack={noop} onGoForward={noop} onGoToEnd={noop} onFlip={noop}
      />
    )
    expect(screen.getByRole('button', { name: 'Next move' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'Go to end' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'Go to start' })).toHaveAttribute('aria-disabled', 'false')
    expect(screen.getByRole('button', { name: 'Previous move' })).toHaveAttribute('aria-disabled', 'false')
  })

  it('flip button is never disabled', () => {
    render(
      <BoardControls
        canGoBack={false} canGoForward={false}
        onGoToStart={noop} onGoBack={noop} onGoForward={noop} onGoToEnd={noop} onFlip={noop}
      />
    )
    expect(screen.getByRole('button', { name: 'Flip board' })).toHaveAttribute('aria-disabled', 'false')
  })

  it('calls onGoBack when previous move button is clicked', async () => {
    const onGoBack = vi.fn()
    render(
      <BoardControls
        canGoBack={true} canGoForward={true}
        onGoToStart={noop} onGoBack={onGoBack} onGoForward={noop} onGoToEnd={noop} onFlip={noop}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Previous move' }))
    expect(onGoBack).toHaveBeenCalledTimes(1)
  })

  it('calls onGoForward when next move button is clicked', async () => {
    const onGoForward = vi.fn()
    render(
      <BoardControls
        canGoBack={true} canGoForward={true}
        onGoToStart={noop} onGoBack={noop} onGoForward={onGoForward} onGoToEnd={noop} onFlip={noop}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Next move' }))
    expect(onGoForward).toHaveBeenCalledTimes(1)
  })

  it('calls onGoToStart when start button is clicked', async () => {
    const onGoToStart = vi.fn()
    render(
      <BoardControls
        canGoBack={true} canGoForward={true}
        onGoToStart={onGoToStart} onGoBack={noop} onGoForward={noop} onGoToEnd={noop} onFlip={noop}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Go to start' }))
    expect(onGoToStart).toHaveBeenCalledTimes(1)
  })

  it('calls onGoToEnd when end button is clicked', async () => {
    const onGoToEnd = vi.fn()
    render(
      <BoardControls
        canGoBack={true} canGoForward={true}
        onGoToStart={noop} onGoBack={noop} onGoForward={noop} onGoToEnd={onGoToEnd} onFlip={noop}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Go to end' }))
    expect(onGoToEnd).toHaveBeenCalledTimes(1)
  })

  it('calls onFlip when flip button is clicked', async () => {
    const onFlip = vi.fn()
    render(
      <BoardControls
        canGoBack={true} canGoForward={true}
        onGoToStart={noop} onGoBack={noop} onGoForward={noop} onGoToEnd={noop} onFlip={onFlip}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Flip board' }))
    expect(onFlip).toHaveBeenCalledTimes(1)
  })

  it('disabled buttons do not fire callbacks when clicked', async () => {
    const onGoBack = vi.fn()
    render(
      <BoardControls
        canGoBack={false} canGoForward={false}
        onGoToStart={noop} onGoBack={onGoBack} onGoForward={noop} onGoToEnd={noop} onFlip={noop}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Previous move' }))
    expect(onGoBack).not.toHaveBeenCalled()
  })
})
