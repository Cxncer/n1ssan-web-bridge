
import React from 'react';

export type AttachmentRarity =
  | 'High Grade'
  | 'Remarkable'
  | 'Exotic'
  | 'Extraordinary'
  | 'Contraband';

export interface CS2AttachmentCardProps {
  itemName: string;
  itemType: 'Sticker' | 'Charm';
  rarity: AttachmentRarity | string;
  imageUrl: string;
  qualityOrFinish?: string;
  quantity: number;
  onOpen?: () => void;
  onRemove?: () => void;
}

const ATTACHMENT_RARITY_STYLES: Record<
  string,
  {
    gradient: string;
    textColor: string;
    badgeBg: string;
    topHighlight: string;
  }
> = {
  'High Grade': {
    gradient: 'linear-gradient(165deg, #080808 -10%, #323963 10%, #080808 90%)',
    textColor: '#93C5FD',
    badgeBg: 'rgba(15, 23, 42, 0.55)',
    topHighlight: 'rgba(147, 197, 253, 0.25)',
  },
  Remarkable: {
    gradient: 'linear-gradient(165deg, #080808 -10%, #330e57 10%, #080808 90%)',
    textColor: '#D8B4FE',
    badgeBg: 'rgba(24, 12, 46, 0.6)',
    topHighlight: 'rgba(216, 180, 254, 0.25)',
  },
  Exotic: {
    gradient: 'linear-gradient(165deg, #080808 -10%, #2f0b36 10%, #080808 90%)',
    textColor: '#E879F9',
    badgeBg: 'rgba(42, 8, 52, 0.72)',
    topHighlight: 'rgba(240, 171, 252, 0.25)',
  },
  Extraordinary: {
    gradient: 'linear-gradient(165deg, #080808 -10%, #38290a 10%, #080808 90%)',
    textColor: '#FCA5A5',
    badgeBg: 'rgba(56, 10, 10, 0.72)',
    topHighlight: 'rgba(252, 165, 165, 0.25)',
  },
  Contraband: {
    gradient: 'linear-gradient(165deg, #080808 -10%, #38290a 10%, #080808 90%)',
    textColor: '#FCD34D',
    badgeBg: 'rgba(58, 39, 8, 0.72)',
    topHighlight: 'rgba(252, 211, 77, 0.25)',
  },
};

const DEFAULT_THEME = ATTACHMENT_RARITY_STYLES['Remarkable'];

export const CS2AttachmentCard: React.FC<CS2AttachmentCardProps> = ({
  itemName,
  itemType,
  rarity,
  imageUrl,
  qualityOrFinish,
  quantity,
  onOpen,
  onRemove,
}) => {
  const theme = ATTACHMENT_RARITY_STYLES[rarity] || DEFAULT_THEME;

  return (
    <>
      <style>
        {`
          @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&display=swap');

          .cs2-att-card {
            font-family: 'Barlow', sans-serif;
            width: 200px;
            height: 292px;
            background-color: #080808;
            border: 0px solid #171717;
            border-radius: 18px;
            padding: 9px 9px 10px 9px;
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            user-select: none;
            cursor: pointer;
            transition:
              transform 0.25s ease,
              border-color 0.25s ease,
              box-shadow 0.25s ease;
          }

          /* Whole card hover */
          .cs2-att-card:hover {
            transform: translateY(-3px);
            border-color: rgba(255, 255, 255, 0.3);
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
          }

          .cs2-att-card-inner {
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

          .cs2-att-glass-header {
            background: rgba(255, 255, 255, 0.07);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.14);
            border-radius: 9px;
            padding: 8px 10px;
            z-index: 2;
          }

          .cs2-att-name {
            color: #FFFFFF;
            font-size: 13px;
            font-weight: 700;
            line-height: 1.15;
            margin: 0;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          .cs2-att-rarity-label {
            font-size: 10.5px;
            font-weight: 600;
            line-height: 1.2;
            margin-top: 2px;
          }

          .cs2-att-tags-row {
            display: flex;
            align-items: center;
            margin-top: 8px;
            min-height: 20px;
            z-index: 2;
          }

          .cs2-att-type-badge {
            font-size: 9.5px;
            font-weight: 600;
            letter-spacing: 0.4px;
            text-transform: uppercase;
            padding: 3px 10px;
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.1);
            color: #FFFFFF;
            line-height: 1;
          }

          .cs2-att-preview-box {
            position: relative;
            width: 100%;
            height: 150px;
            margin: auto 0;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1;
          }

          .cs2-att-img {
            max-width: 80%;
            max-height: 90%;
            object-fit: contain;
            filter: drop-shadow(0 12px 16px rgba(0, 0, 0, 0.85));
            transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
            will-change: transform;
          }

          .cs2-att-card:hover .cs2-att-img {
            transform: scale(1.08);
          }

          .cs2-att-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 4px 4px 0 4px;
            font-size: 9.5px;
            font-weight: 500;
            letter-spacing: 0.3px;
            color: #9CA3AF;
          }

          .cs2-att-footer-val {
            color: #F3F4F6;
            font-weight: 600;
          }

          .cs2-att-remove-button {
            position: absolute;
            top: 6px;
            right: 6px;
            z-index: 5;
            width: 22px;
            height: 22px;
            border: 0px solid rgba(255,255,255,.2);
            border-radius: 1000%;
            background: rgba(73, 71, 71, 0.36);
            color: #000000;
            cursor: pointer;
            line-height: 1;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.2s ease;
          }

          /* Reveal remove button on whole-card hover */
          .cs2-att-card:hover .cs2-att-remove-button,
          .cs2-att-card:focus-within .cs2-att-remove-button {
            opacity: 1;
            pointer-events: auto;
          }

          .cs2-att-remove-button:hover {
            background: rgba(180, 35, 35, 0.43);
            border-color: rgba(255, 100, 100, 0.6);
          }

          .cs2-att-finish-badge {
            color: #FBBF24;
            font-weight: 500;
            font-size: 10px;
          }

          @media (prefers-reduced-motion: reduce) {
            .cs2-att-card,
            .cs2-att-img,
            .cs2-att-remove-button {
              transition: none;
            }
          }
        `}
      </style>

      <div
        className="cs2-att-card"
        onClick={onOpen}
        onKeyDown={event => {
          if (onOpen && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            onOpen();
          }
        }}
        role={onOpen ? 'button' : undefined}
        tabIndex={onOpen ? 0 : undefined}
      >
        <div
          className="cs2-att-card-inner"
          style={{
            background: theme.gradient,
            boxShadow: `inset 0 1px 0 ${theme.topHighlight}`,
          }}
        >
          {onRemove && (
            <button
              type="button"
              className="cs2-att-remove-button"
              aria-label="Remove item"
              onClick={event => {
                event.stopPropagation();
                onRemove();
              }}
            >
              ×
            </button>
          )}

          {/* Header */}
          <div className="cs2-att-glass-header">
            <h3 className="cs2-att-name" title={itemName}>
              {itemName}
            </h3>
            <div
              className="cs2-att-rarity-label"
              style={{ color: theme.textColor }}
            >
              {rarity}
            </div>
          </div>

          {/* Type Badge */}
          <div className="cs2-att-tags-row">
            <span className="cs2-att-type-badge">{itemType}</span>
          </div>

          {/* Item Preview */}
          <div className="cs2-att-preview-box">
            <img
              src={imageUrl}
              alt={itemName}
              className="cs2-att-img"
              draggable={false}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="cs2-att-footer">
          <span>
            QTY: <span className="cs2-att-footer-val">x{quantity}</span>
          </span>
          <span className="cs2-att-finish-badge">
            {qualityOrFinish || (itemType === 'Sticker' ? 'Holo' : 'Armory')}
          </span>
        </div>
      </div>
    </>
  );
};

export default CS2AttachmentCard;
