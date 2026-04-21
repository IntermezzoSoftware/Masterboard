import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Upload, ChevronDown } from 'lucide-react'
import { btnTitlebarPrimary, menuContent, menuItemNormal, menuSeparator } from '@/lib/classNames'

interface ImportMenuProps {
  onPGNFile: () => void
  onPGNFolder: () => void
  onLichess: () => void
  onChessCom: () => void
  onLichessStudy: () => void
}

export function ImportMenu({ onPGNFile, onPGNFolder, onLichess, onChessCom, onLichessStudy }: ImportMenuProps) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className={`${btnTitlebarPrimary} active:!scale-100 data-[state=open]:opacity-90`}>
          <Upload size={12} aria-hidden="true" />
          Import
          <ChevronDown size={10} aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className={menuContent}>
          <DropdownMenu.Item className={menuItemNormal} onSelect={onPGNFile}>PGN file…</DropdownMenu.Item>
          <DropdownMenu.Item className={menuItemNormal} onSelect={onPGNFolder}>PGN folder…</DropdownMenu.Item>
          <DropdownMenu.Separator className={menuSeparator} />
          <DropdownMenu.Item className={menuItemNormal} onSelect={onLichess}>From Lichess…</DropdownMenu.Item>
          <DropdownMenu.Item className={menuItemNormal} onSelect={onLichessStudy}>From Lichess Study…</DropdownMenu.Item>
          <DropdownMenu.Item className={menuItemNormal} onSelect={onChessCom}>From Chess.com…</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
