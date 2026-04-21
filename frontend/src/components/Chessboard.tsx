import { useEffect, useRef, type MutableRefObject } from 'react'
import { Chessground } from '@lichess-org/chessground'
import type { Api } from '@lichess-org/chessground/api'
import type { Config } from '@lichess-org/chessground/config'
import '@lichess-org/chessground/assets/chessground.base.css'
import '@lichess-org/chessground/assets/chessground.brown.css'
import '@lichess-org/chessground/assets/chessground.cburnett.css'

interface ChessboardProps {
  config?: Config
  /** Optional ref to the live chessground API for imperative updates. */
  cgApiRef?: MutableRefObject<Api | null>
}

export default function Chessboard({ config, cgApiRef }: ChessboardProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<Api | null>(null)

  // Mount: initialise once the DOM node is available
  useEffect(() => {
    if (!containerRef.current) return
    apiRef.current = Chessground(containerRef.current, config)
    if (cgApiRef) cgApiRef.current = apiRef.current
    return () => {
      apiRef.current?.destroy()
      apiRef.current = null
      if (cgApiRef) cgApiRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Config updates: forward to the live api without destroying/recreating
  useEffect(() => {
    if (apiRef.current && config) {
      apiRef.current.set(config)
    }
  }, [config])

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}
