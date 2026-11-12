import React from 'react';

export type SkinRarity =
  | 'Consumer Grade'
  | 'Industrial Grade'
  | 'Mil-Spec Grade'
  | 'Restricted'
  | 'Classified'
  | 'Covert'
  | 'Extraordinary'
  | 'Exceedingly Rare'
  | 'Contraband';

export interface CS2SkinCardProps {
  weaponName: string;
  rarity: SkinRarity | string;
  imageUrl: string;
  nameTag?: string;
  isStatTrak?: boolean;
  floatValue: number | null;
  seed: number | null;
  stickers?: string[];
  charm?: string;
  onOpen?: () => void;
  onRemove?: () => void;
}

const RARITY_STYLES: Record<
  string,
  {
    gradient: string;
    textColor: string;
    badgeBg: string;
    topHighlight: string;
  }
> = {
  'Consumer Grade': {
    gradient: 'linear-gradient(165deg, #080808 -100%, #4B5563 50%, #080808 100%)',
    textColor: '#E5E7EB',
    badgeBg: 'rgba(17, 24, 39, 0.55)',
    topHighlight: 'rgba(229, 231, 235, 0.25)',
  },
  'Industrial Grade': {
    gradient: 'linear-gradient(165deg, #080808 -100%, #2B4C73 50%, #080808 100%)',
    textColor: '#93C5FD',
    badgeBg: 'rgba(15, 23, 42, 0.55)',
    topHighlight: 'rgba(147, 197, 253, 0.25)',
  },
  'Mil-Spec Grade': {
    gradient: 'linear-gradient(165deg, #080808 -100%, #233282 50%, #080808 100%)',
    textColor: '#93C5FD',
    badgeBg: 'rgba(15, 23, 42, 0.6)',
    topHighlight: 'rgba(147, 197, 253, 0.25)',
  },
  Restricted: {
    gradient: 'linear-gradient(165deg, #080808 -100%, #422082 50%, #080808 100%)',
    textColor: '#D8B4FE',
    badgeBg: 'rgba(24, 12, 46, 0.6)',
    topHighlight: 'rgba(216, 180, 254, 0.25)',
  },
  Classified: {
    gradient: 'linear-gradient(165deg, #080808 -100%, #571264 50%, #080808 100%)',
    textColor: '#E879F9',
    badgeBg: 'rgba(42, 8, 52, 0.72)',
    topHighlight: 'rgba(240, 171, 252, 0.25)',
  },
  Covert: {
    gradient: 'linear-gradient(165deg, #080808 -100%, #6E1616 50%, #080808 100%)',
    textColor: '#FCA5A5',
    badgeBg: 'rgba(56, 10, 10, 0.72)',
    topHighlight: 'rgba(252, 165, 165, 0.25)',
  },
  Extraordinary: {
    gradient: 'linear-gradient(165deg, #080808 -100%, #714E05 50%, #080808 100%)',
    textColor: '#FDE047',
    badgeBg: 'rgba(54, 38, 4, 0.72)',
    topHighlight: 'rgba(253, 224, 71, 0.25)',
  },
  'Exceedingly Rare': {
    gradient: 'linear-gradient(165deg, #080808 -100%, #714E05 50%, #080808 100%)',
    textColor: '#FDE047',
    badgeBg: 'rgba(54, 38, 4, 0.72)',
    topHighlight: 'rgba(253, 224, 71, 0.25)',
  },
  Contraband: {
    gradient: 'linear-gradient(165deg, #080808 -100%, #785314 50%, #080808 100%)',
    textColor: '#FCD34D',
    badgeBg: 'rgba(58, 39, 8, 0.72)',
    topHighlight: 'rgba(252, 211, 77, 0.25)',
  },
};

const DEFAULT_THEME = RARITY_STYLES['Classified'];

function getWearLabel(floatVal: number | null | undefined): 'FN' | 'MW' | 'FT' | 'WW' | 'BS' | null {
  if (floatVal == null || !Number.isFinite(floatVal)) return null;
  if (floatVal < 0.07) return 'FN';
  if (floatVal < 0.15) return 'MW';
  if (floatVal < 0.38) return 'FT';
  if (floatVal < 0.45) return 'WW';
  return 'BS';
}

export const CS2SkinCard: React.FC<CS2SkinCardProps> = ({
  weaponName,
  rarity,
  imageUrl,
  nameTag,
  isStatTrak = false,
  floatValue,
  seed,
  stickers = [],
  charm,
  onOpen,
  onRemove,
}) => {
  const theme = RARITY_STYLES[rarity] || DEFAULT_THEME;
  const wearLabel = getWearLabel(floatValue);

  return (
    <>
      <style>
        {`
          @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&display=swap');

          .cs2-card {
            font-family: 'Barlow', sans-serif;
            width: 200px;
            height: 292px;
            background-color: #080808;
            border: 1px solid #171717;
            border-radius: 18px;
            padding: 9px 9px 10px 9px;
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            user-select: none;
          }

          .cs2-card-inner {
            position: relative;
            width: 100%;
            height: 248px;
            border-radius: 12px 12px 0 0;
            padding: 9px 9px 6px 9px;
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            overflow: hidden;
          }

          .cs2-glass-header {
            background: rgba(255, 255, 255, 0.07);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.14);
            border-radius: 9px;
            padding: 8px 10px;
            z-index: 2;
          }

          .cs2-weapon-name {
            color: #FFFFFF;
            font-size: 13.5px;
            font-weight: 700;
            line-height: 1.15;
            margin: 0;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          .cs2-rarity-label {
            font-size: 10.5px;
            font-weight: 600;
            line-height: 1.2;
            margin-top: 2px;
          }

          .cs2-tags-row {
            display: flex;
            align-items: center;
            margin-top: 8px;
            min-height: 20px;
            z-index: 2;
          }

          .cs2-nametag-pill {
            color: #FFFFFF;
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.4px;
            padding: 3px 10px;
            border-radius: 9999px;
            line-height: 1;
          }

          .cs2-stattrak-text {
            color: #CF6A32;
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.4px;
            line-height: 0.8;
          }

          .cs2-preview-box {
            position: relative;
            width: 168px;
            min-width: 166px;
            min-height: 110px;
            height: 124px;
            margin: auto -3px 33px -3px;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1;
          }

          .cs2-skin-img {
            width: 120%;
            height: 120%;
            object-fit: contain;
            filter: drop-shadow(0 10px 12px rgba(0, 0, 0, 0.75));
            transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
            will-change: transform;
          }

          .cs2-card:hover .cs2-skin-img {
            transform: scale(1.06);
          }

          .cs2-attachments-row {
            position: absolute;
            bottom: 4px;
            left: 5px;
            display: flex;
            align-items: center;
            gap: 4px;
            z-index: 3;
          }

          .cs2-attachment-slot {
            width: 30px;
            height: 30px;
            border-radius: 5px;
            background: rgba(15, 15, 15, 0.85);
            border: 1px solid rgba(255, 255, 255, 0.14);
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 1px;
            box-sizing: border-box;
          }

          .cs2-attachment-slot.is-charm {
            border-color: rgba(234, 179, 8, 0.45);
          }

          .cs2-attachment-slot img {
            width: 130%;
            height: 130%;
            object-fit: contain;
          }

          .cs2-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 4px 4px 0 4px;
            font-size: 9.5px;
            font-weight: 500;
            letter-spacing: 0.3px;
            color: #9CA3AF;
          }

          .cs2-footer-val {
            color: #F3F4F6;
            font-weight: 600;
          }

          .cs2-remove-button {
            position: absolute;
            top: 6px;
            right: 6px;
            z-index: 5;
            width: 22px;
            height: 22px;
            border: 1px solid rgba(255,255,255,.2);
            border-radius: 50%;
            background: rgba(8,8,8,.78);
            color: #fff;
            cursor: pointer;
            line-height: 1;
          }

          .cs2-wear-badge {
            color: #FFFFFF;
            font-weight: 700;
            font-size: 10px;
          }
        `}
      </style>

      <div className="cs2-card" onClick={onOpen} onKeyDown={event => { if (onOpen && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onOpen(); } }} role={onOpen ? 'button' : undefined} tabIndex={onOpen ? 0 : undefined}>
        <div
          className="cs2-card-inner"
          style={{
            background: theme.gradient,
            boxShadow: `inset 0 1px 0 ${theme.topHighlight}`,
          }}
        >
          {onRemove && <button type="button" className="cs2-remove-button" aria-label="Remove item" onClick={event => { event.stopPropagation(); onRemove(); }}>×</button>}
          <div className="cs2-glass-header">
            <h3 className="cs2-weapon-name" title={weaponName}>
              {weaponName}
            </h3>
            <div
              className="cs2-rarity-label"
              style={{ color: theme.textColor }}
            >
              {rarity}
            </div>
          </div>

          {(nameTag || isStatTrak) && (
            <div className="cs2-tags-row">
              {nameTag && (
                <span
                  className="cs2-nametag-pill"
                  style={{ backgroundColor: theme.badgeBg }}
                >
                  {nameTag}
                </span>
              )}
              {isStatTrak && (
                <span
                  className="cs2-stattrak-text"
                  style={{ marginLeft: nameTag ? '5px' : '0px' }}
                >
                  ST
                </span>
              )}
            </div>
          )}

          <div className="cs2-preview-box">
            <img
              src={imageUrl}
              alt={weaponName}
              className="cs2-skin-img"
              draggable={false}
            />
          </div>

          {(stickers.length > 0 || charm) && (
            <div className="cs2-attachments-row">
              {stickers.map((stickerUrl, idx) => (
                <div key={idx} className="cs2-attachment-slot">
                  <img src={stickerUrl} alt={`Sticker ${idx + 1}`} />
                </div>
              ))}
              {charm && (
                <div className="cs2-attachment-slot is-charm">
                  <img src={charm} alt="Charm" />
                </div>
              )}
            </div>
          )}
        </div>

        {(floatValue != null || seed != null || wearLabel) && <div className="cs2-footer">
          {floatValue != null && <span>FLOAT: <span className="cs2-footer-val">{floatValue}</span></span>}
          {seed != null && <span>SEED: <span className="cs2-footer-val">{seed}</span></span>}
          {wearLabel && <span className="cs2-wear-badge">{wearLabel}</span>}
        </div>}
      </div>
    </>
  );
};

export default CS2SkinCard;