import { useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import './SpecularButton.css'

type SpecularButtonProps = {
  children: ReactNode
  size?: 'sm' | 'md' | 'lg'
  radius?: number
  tint?: string
  tintOpacity?: number
  textColor?: string
  lineColor?: string
  baseColor?: string
  intensity?: number
  idleIntensity?: number
  shineSize?: number
  shineFade?: number
  thickness?: number
  glow?: number
  followMouse?: boolean
  proximity?: number
  onClick?: () => void
  className?: string
}

export default function SpecularButton({
  children,
  size = 'md',
  radius = 18,
  tint = '#ffffff',
  tintOpacity = 0.04,
  textColor = '#f5f5f5',
  lineColor = '#ffffff',
  baseColor = '#111111',
  intensity = 1,
  idleIntensity = 0.35,
  shineSize = 10,
  shineFade = 34,
  thickness = 1.2,
  glow = 1,
  followMouse = true,
  proximity = 250,
  onClick,
  className = '',
}: SpecularButtonProps) {
  const [pointer, setPointer] = useState({ x: 50, y: 50, active: false })
  const handleMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!followMouse) return
    const rect = event.currentTarget.getBoundingClientRect()
    setPointer({
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100,
      active: true,
    })
  }
  const style = {
    '--spec-radius': `${radius}px`,
    '--spec-tint': tint,
    '--spec-tint-opacity': tintOpacity,
    '--spec-text': textColor,
    '--spec-line': lineColor,
    '--spec-base': baseColor,
    '--spec-intensity': intensity,
    '--spec-idle': idleIntensity,
    '--spec-shine-size': `${shineSize}px`,
    '--spec-shine-fade': `${shineFade}%`,
    '--spec-thickness': `${thickness}px`,
    '--spec-glow': glow,
    '--spec-x': `${pointer.x}%`,
    '--spec-y': `${pointer.y}%`,
    '--spec-pointer-opacity': pointer.active ? 1 : 0,
    '--spec-proximity': `${proximity}px`,
  } as CSSProperties
  return (
    <button
      type="button"
      className={`specular-button specular-button--${size}${className ? ` ${className}` : ''}`}
      style={style}
      onPointerMove={handleMove}
      onPointerLeave={() => setPointer(current => ({ ...current, active: false }))}
      onClick={onClick}
    >
      <span className="specular-button__shine" aria-hidden="true" />
      <span className="specular-button__content">{children}</span>
    </button>
  )
}
