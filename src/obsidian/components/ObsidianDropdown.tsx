import { useEffect, useRef, useState } from 'react'

type Option = { value: string; label: string; disabled?: boolean }
type Props = {
  value: string
  options: Option[]
  onChange: (value: string) => void
  ariaLabel: string
  className?: string
}

export default function ObsidianDropdown({ value, options, onChange, ariaLabel, className = '' }: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const active = options.find(option => option.value === value)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={rootRef} className={`ob-dropdown ${className}`}>
      <button
        type="button"
        className="ob-dropdown-trigger"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(current => !current)}
      >
        <span>{active?.label ?? value}</span>
        <svg className={open ? 'is-open' : ''} width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="ob-dropdown-content" role="menu" aria-label={ariaLabel}>
          {options.map(option => (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={option.value === value}
              disabled={option.disabled}
              key={option.value}
              className={`ob-dropdown-item ${option.value === value ? 'selected' : ''}`}
              onClick={() => { if (option.disabled) return; onChange(option.value); setOpen(false) }}
            >
              <span className="ob-dropdown-radio" aria-hidden="true"><i /></span>
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
