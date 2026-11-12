import React from 'react'

/**
 * Armory skin card.
 *
 * Layout and palette follow the CS2 item card reference: rarity-tinted shell,
 * glass weapon/rarity header, custom-name pill with StatTrak marker, art in the
 * middle and a float / seed footer. Written with plain CSS classes (no Tailwind)
 * so it drops into the Obsidian stylesheet.
 */

export type SkinRarity =
  | 'Consumer Grade'
  | 'Industrial Grade'
  | 'Mil-Spec Grade'
  | 'Restricted'
  | 'Classified'
  | 'Covert'
  | 'Exceedingly Rare'
  | 'Contraband'

type RarityTheme = {
  border: string
  gradientFrom: string
  gradientTo: string
  textAccent: string
  pillBg: string
}

const RARITY_THEMES: Record<SkinRarity, RarityTheme> = {
  'Consumer Grade': {
    border: '#b0c3d9',
    gradientFrom: '#7b8999',
    gradientTo: '#31373e',
    textAccent: '#d9e4f0',
    pillBg: 'rgba(30, 35, 42, 0.55)',
  },
  'Industrial Grade': {
    border: '#5e98d9',
    gradientFrom: '#3d699c',
    gradientTo: '#16283d',
    textAccent: '#8ec2ff',
    pillBg: 'rgba(15, 28, 46, 0.55)',
  },
  'Mil-Spec Grade': {
    border: '#4b69ff',
    gradientFrom: '#3146b5',
    gradientTo: '#101847',
    textAccent: '#8da1ff',
    pillBg: 'rgba(12, 18, 56, 0.55)',
  },
  Restricted: {
    border: '#8847ff',
    gradientFrom: '#5b2db3',
    gradientTo: '#210e47',
    textAccent: '#bd99ff',
    pillBg: 'rgba(26, 11, 56, 0.55)',
  },
  Classified: {
    border: '#d32ce6',
    gradientFrom: '#941ca1',
    gradientTo: '#3a0840',
    textAccent: '#f58cff',
    pillBg: 'rgba(46, 7, 51, 0.55)',
  },
  Covert: {
    border: '#b91c1c',
    gradientFrom: '#991b1b',
    gradientTo: '#450a0a',
    textAccent: '#ef4444',
    pillBg: 'rgba(69, 10, 10, 0.6)',
  },
  'Exceedingly Rare': {
    border: '#ffd700',
    gradientFrom: '#b89600',
    gradientTo: '#473900',
    textAccent: '#ffe866',
    pillBg: 'rgba(56, 44, 0, 0.6)',
  },
  Contraband: {
    border: '#e4ae39',
    gradientFrom: '#a67a1e',
    gradientTo: '#422e06',
    textAccent: '#ffcf66',
    pillBg: 'rgba(54, 37, 4, 0.6)',
  },
}

/**
 * The catalogue and the agent/glove families name the same tiers differently
 * ("Extraordinary", "Master", "Remarkable", ...). Map them onto the official
 * palette instead of falling back to one colour for everything.
 */
export function rarityThemeFor(rarity: string | null | undefined): RarityTheme {
  const value = (rarity ?? '').trim()

  if (value in RARITY_THEMES) return RARITY_THEMES[value as SkinRarity]

  const name = value.toLowerCase()

  if (name.includes('contraband')) return RARITY_THEMES.Contraband
  if (name.includes('exceedingly') || name.includes('extraordinary')) {
    return RARITY_THEMES['Exceedingly Rare']
  }
  if (name.includes('covert') || name.includes('master') || name.includes('exceptional')) {
    return RARITY_THEMES.Covert
  }
  if (name.includes('classified')) return RARITY_THEMES.Classified
  if (name.includes('restricted') || name.includes('exotic')) return RARITY_THEMES.Restricted
  if (name.includes('mil-spec') || name.includes('remarkable')) return RARITY_THEMES['Mil-Spec Grade']
  if (name.includes('industrial') || name.includes('high grade')) return RARITY_THEMES['Industrial Grade']

  return RARITY_THEMES['Consumer Grade']
}

function getWearFromFloat(value: number): 'FN' | 'MW' | 'FT' | 'WW' | 'BS' {
  if (value < 0.07) return 'FN'
  if (value < 0.15) return 'MW'
  if (value < 0.38) return 'FT'
  if (value < 0.45) return 'WW'
  return 'BS'
}

export type CS2SkinCardAttachment = {
  key: string
  kind: 'sticker' | 'charm'
  label: string
  image?: string
}

export type CS2SkinCardProps = {
  weaponName: string
  rarity: string
  imageUrl?: string
  customName?: string
  statTrak?: boolean
  float?: string | number | null
  seed?: string | number | null
  quantity?: number | null
  attachments?: CS2SkinCardAttachment[]
  onOpen?: () => void
  onRemove?: () => void
}

export const CS2SkinCard: React.FC<CS2SkinCardProps> = ({
  weaponName,
  rarity,
  imageUrl,
  customName,
  statTrak = false,
  float,
  seed,
  quantity,
  attachments,
  onOpen,
  onRemove,
}) => {
  const theme = rarityThemeFor(rarity)
  const numericFloat = typeof float === 'number' ? float : Number(float)
  const hasFloat = float !== null && float !== undefined && Number.isFinite(numericFloat)
  const wear = hasFloat ? getWearFromFloat(numericFloat) : null
  const shownAttachments = attachments ?? []

  const open = () => onOpen?.()

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${weaponName}${customName ? `, ${customName}` : ''}`}
      className="cs2-skin-card"
      style={{ backgroundColor: '#0b0b0c', borderColor: theme.border }}
      onClick={open}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          open()
        }
      }}
    >
      {onRemove && (
        <button
          type="button"
          className="cs2-skin-card-remove"
          aria-label={`Remove ${weaponName}`}
          title="Remove item"
          onClick={event => {
            event.stopPropagation()
            onRemove()
          }}
        >
          ×
        </button>
      )}

      <div
        className="cs2-skin-card-inner"
        style={{ background: `linear-gradient(180deg, ${theme.gradientFrom} 0%, ${theme.gradientTo} 100%)` }}
      >
        <div className="cs2-skin-card-top">
          <div className="cs2-skin-card-head">
            <h3 title={weaponName}>{weaponName}</h3>
            <p style={{ color: theme.textAccent }}>{rarity}</p>
          </div>

          {(customName || statTrak) && (
            <div className="cs2-skin-card-pills">
              {customName && (
                <span className="cs2-skin-card-name" style={{ backgroundColor: theme.pillBg }} title={customName}>
                  {customName}
                </span>
              )}
              {statTrak && (
                <span className="cs2-skin-card-st" style={{ marginLeft: customName ? 5 : 0 }}>
                  ST
                </span>
              )}
            </div>
          )}
        </div>

        <div className="cs2-skin-card-art">
          {imageUrl ? (
            <img src={imageUrl} alt={weaponName} loading="lazy" />
          ) : (
            <span className="cs2-skin-card-fallback">{wear ?? 'CS2'}</span>
          )}

          {shownAttachments.length > 0 && (
            <div className="cs2-skin-card-attachments" aria-label="Attached stickers and charm">
              {shownAttachments.map(attachment => (
                <span
                  key={attachment.key}
                  className={`cs2-skin-card-thumb ${attachment.kind}`}
                  title={`${attachment.kind === 'charm' ? 'Charm' : 'Sticker'}: ${attachment.label}`}
                >
                  {attachment.image ? (
                    <img src={attachment.image} alt={attachment.label} loading="lazy" />
                  ) : (
                    <i>{attachment.kind === 'charm' ? 'CH' : 'ST'}</i>
                  )}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="cs2-skin-card-foot">
        {hasFloat ? (
          <div className="cs2-skin-card-stats">
            <span>
              FLOAT: <strong>{float}</strong>
            </span>
            <span>
              SEED: <strong>{seed ?? '—'}</strong>
            </span>
          </div>
        ) : (
          <div className="cs2-skin-card-stats">
            {quantity && quantity > 0 ? (
              <span>
                QTY: <strong>×{quantity}</strong>
              </span>
            ) : (
              <span>{rarity}</span>
            )}
          </div>
        )}
        {wear && <span className="cs2-skin-card-wear">{wear}</span>}
      </div>
    </div>
  )
}

export default CS2SkinCard
