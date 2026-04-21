import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { Grid3x3 } from 'lucide-react'
import NavItem from './NavItem'

function renderInRouter(initialEntries = ['/']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <NavItem to="/board" icon={Grid3x3} label="Board" />
    </MemoryRouter>
  )
}

describe('NavItem', () => {
  it('renders the label', () => {
    renderInRouter()
    expect(screen.getByText('Board')).toBeInTheDocument()
  })

  it('renders as a link with the correct href', () => {
    renderInRouter()
    expect(screen.getByRole('link', { name: 'Board' })).toHaveAttribute('href', '/board')
  })

  it('is inactive when path does not match', () => {
    renderInRouter(['/other'])
    expect(screen.getByRole('link', { name: 'Board' }).className).not.toContain('color-accent-subtle')
  })

  it('is active when path matches', () => {
    renderInRouter(['/board'])
    expect(screen.getByRole('link', { name: 'Board' }).className).toContain('color-accent-subtle')
  })
})
