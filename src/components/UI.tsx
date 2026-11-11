import { useEffect, useState, type ReactNode } from 'react'

let toastFn: ((m: string) => void) | null = null
export function toast(msg: string) {
  toastFn?.(msg)
}

export function ToastHost() {
  const [msg, setMsg] = useState('')
  useEffect(() => {
    let timer = 0
    toastFn = (m: string) => {
      setMsg(m)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setMsg(''), 1800)
    }
    return () => {
      toastFn = null
      window.clearTimeout(timer)
    }
  }, [])
  return msg ? <div className="toast">{msg}</div> : null
}

export function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}) {
  if (!open) return null
  return (
    <div className="sheet-mask" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  )
}

export function Stepper({
  value,
  onChange,
  step = 1,
  min = 0,
  max,
  onMinus,
  onPlus,
}: {
  value: number
  onChange: (v: number) => void
  step?: number
  min?: number
  max?: number
  onMinus?: () => void
  /** 到上限时点「+」不再 disabled，改走这个回调（顶层满层 → 层数 +1、顶层归 1） */
  onPlus?: () => void
}) {
  const cap = max ?? Number.POSITIVE_INFINITY
  const atMin = value <= min
  const atMax = value >= cap
  return (
    <div className="stepper">
      <button
        onClick={() => {
          if (atMin) onMinus?.()
          else onChange(Math.max(min, value - step))
        }}
        aria-label="减少"
        disabled={atMin && !onMinus}
      >
        −
      </button>
      <div className="val num">{value}</div>
      <button
        onClick={() => {
          if (atMax) onPlus?.()
          else onChange(Math.min(cap, value + step))
        }}
        aria-label="增加"
        disabled={atMax && !onPlus}
      >
        +
      </button>
    </div>
  )
}

const ICONS: Record<string, ReactNode> = {
  ship: (
    <>
      <path d="M12 15V4" />
      <path d="m8 8 4-4 4 4" />
      <path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
    </>
  ),
  stock: (
    <>
      <path d="M3 8.5 12 4l9 4.5-9 4.5z" />
      <path d="M3 12.5 12 17l9-4.5" />
      <path d="M3 16.5 12 21l9-4.5" />
    </>
  ),
  catalog: (
    <>
      <rect x="4" y="3.5" width="16" height="17" rx="2.5" />
      <path d="M8 9h8M8 13h8M8 17h5" />
    </>
  ),
  load: (
    <>
      <path d="M2 7h11v9H2z" />
      <path d="M13 10h4l3 3v3h-7z" />
      <circle cx="6.5" cy="18" r="1.6" />
      <circle cx="16.5" cy="18" r="1.6" />
    </>
  ),
  me: (
    <>
      <circle cx="12" cy="8.5" r="3.6" />
      <path d="M4.5 20c0-3.6 3.4-5.6 7.5-5.6s7.5 2 7.5 5.6" />
    </>
  ),
  records: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.4V12l3.1 2" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 7h15" />
      <path d="M9.6 7V5.3A1.3 1.3 0 0 1 10.9 4h2.2a1.3 1.3 0 0 1 1.3 1.3V7" />
      <path d="M6.6 7l.8 11.2A1.8 1.8 0 0 0 9.2 20h5.6a1.8 1.8 0 0 0 1.8-1.8L17.4 7" />
      <path d="M10.2 11v5M13.8 11v5" />
    </>
  ),
  pallet: (
    <>
      <path d="M4 4h16v11.5H4z" />
      <path d="M3 15.5h18V18H3z" />
      <path d="M7.5 18v2.5M12 18v2.5M16.5 18v2.5" />
    </>
  ),
  scan: (
    <>
      <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8" />
      <path d="M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8" />
      <path d="M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16" />
      <path d="M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
      <path d="M4 12h16" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14M5 12h14" />
    </>
  ),
  back: (
    <>
      <path d="M15 5l-7 7 7 7" />
    </>
  ),
  redo: (
    <>
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </>
  ),
  check: (
    <>
      <path d="M5 12.5 10 17.5 19 7" />
    </>
  ),
  chevron: (
    <>
      <path d="m6 9 6 6 6-6" />
    </>
  ),
  export: (
    <>
      <path d="M12 3v11" />
      <path d="m7 10 5 5 5-5" />
      <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M4 20h16" />
    </>
  ),
  close: (
    <>
      <path d="M6 6l12 12M18 6 6 18" />
    </>
  ),
}

export function Icon({ name, size = 20, className }: { name: string; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {ICONS[name]}
    </svg>
  )
}
