import React from 'react';

export type UniversalRarity =
  // Weapons, Knives, Gloves
  | 'Consumer Grade'
  | 'Industrial Grade'
  | 'Mil-Spec Grade'
  | 'Restricted'
  | 'Classified'
  | 'Covert'
  | 'Extraordinary'
  | 'Exceedingly Rare'
  | 'Contraband'
  // Stickers & Charms
  | 'High Grade'
  | 'Remarkable'
  | 'Exotic';

export interface AddtoInvItemCardProps {
  itemName: string;     // e.g., "M4A1-S | Party Animal", "Sticker | Crown (Foil)", "Specialist Gloves | Fade"
  itemType: string;     // e.g., "Rifle", "Knife", "Gloves", "Agent", "Sticker", "Charm"
  rarity: UniversalRarity | string;
  imageUrl: string;
  isSelected?: boolean;
  onClick?: () => void;
}

const UNIVERSAL_RARITY_STYLES: Record<
  string,
  {
    gradient: string;
    textColor: string;
    topHighlight: string;
  }
> = {
  // Standard & Weapon/Knife/Glove/Agent Rarities
  'Consumer Grade': {
    gradient: 'linear-gradient(165deg, #080808 -100%, #4B5563 50%, #080808 100%)',
    textColor: '#E5E7EB',
    topHighlight: 'rgba(229, 231, 235, 0.25)',
  },
  'Industrial Grade': {
    gradient: 'linear-gradient(165deg, #080808 -100%, #2B4C73 50%, #080808 100%)',
    textColor: '#93C5FD',
    topHighlight: 'rgba(147, 197, 253, 0.25)',
  },
  'Mil-Spec Grade': {
    gradient: 'linear-gradient(165deg, #080808 -100%, #233282 50%, #080808 100%)',
    textColor: '#93C5FD',
    topHighlight: 'rgba(147, 197, 253, 0.25)',
  },
  Restricted: {
    gradient: 'linear-gradient(165deg, #080808 -100%, #422082 50%, #080808 100%)',
    textColor: '#D8B4FE',
    topHighlight: 'rgba(216, 180, 254, 0.25)',
  },
  Classified: {
    gradient: 'linear-gradient(165deg, #080808 -100%, #571264 50%, #080808 100%)',
    textColor: '#E879F9',
    topHighlight: 'rgba(240, 171, 252, 0.25)',
  },
  Covert: {
    gradient: 'linear-gradient(165deg, #080808 -100%, #6E1616 50%, #080808 100%)',
    textColor: '#FCA5A5',
    topHighlight: 'rgba(252, 165, 165, 0.25)',
  },
  Extraordinary: {
    gradient: 'linear-gradient(165deg, #080808 -100%, #714E05 50%, #080808 100%)',
    textColor: '#FDE047',
    topHighlight: 'rgba(253, 224, 71, 0.25)',
  },
  'Exceedingly Rare': {
    gradient: 'linear-gradient(165deg, #080808 -100%, #714E05 50%, #080808 100%)',
    textColor: '#FDE047',
    topHighlight: 'rgba(253, 224, 71, 0.25)',
  },
  Contraband: {
    gradient: 'linear-gradient(165deg, #080808 -100%, #785314 50%, #080808 100%)',
    textColor: '#FCD34D',
    topHighlight: 'rgba(252, 211, 77, 0.25)',
  },

  // Sticker & Charm Specific Tiers
  'High Grade': {
    gradient: 'linear-gradient(165deg, #080808 -100%, #2B4C73 50%, #080808 100%)',
    textColor: '#93C5FD',
    topHighlight: 'rgba(147, 197, 253, 0.25)',
  },
  Remarkable: {
    gradient: 'linear-gradient(165deg, #080808 -100%, #422082 50%, #080808 100%)',
    textColor: '#D8B4FE',
    topHighlight: 'rgba(216, 180, 254, 0.25)',
  },
  Exotic: {
    gradient: 'linear-gradient(165deg, #080808 -100%, #571264 50%, #080808 100%)',
    textColor: '#E879F9',
    topHighlight: 'rgba(240, 171, 252, 0.25)',
  },
};

const DEFAULT_THEME = UNIVERSAL_RARITY_STYLES['Classified'];

export const AddtoInvItemCard: React.FC<AddtoInvItemCardProps> = ({
  itemName,
  itemType,
  rarity,
  imageUrl,
  isSelected = false,
  onClick,
}) => {
  const theme = UNIVERSAL_RARITY_STYLES[rarity] || DEFAULT_THEME;

  return (
    <>
      <style>
        {`
          @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&display=swap');

          .universal-inv-card {
            font-family: 'Barlow', sans-serif;
            width: 150px;
            height: 150px;
            min-width: 140px;
            min-height: 140px;
            max-width: 160px;
            max-height: 160px;
            background-color: #080808;
            border: 0px solid ${isSelected ? '#3b82f6' : 'transparent'};
            border-radius: 14px;
            padding: 7px;
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            cursor: pointer;
            user-select: none;
            transition: all 0.2s ease;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
          }

          .universal-inv-card:hover {
            border-color: ${isSelected ? '#3b82f6' : '#4b5563'};
            transform: translateY(-2px);
          }

          .universal-inv-card-inner {
            position: relative;
            width: 100%;
            height: 100%;
            border-radius: 9px;
            padding: 7px 8px;
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            overflow: hidden;
          }

          .universal-inv-header {
            display: flex;
            flex-direction: column;
            gap: 2px;
            z-index: 2;
          }

          .universal-inv-name {
            color: #ffffff;
            font-size: 11px;
            font-weight: 700;
            line-height: 1.15;
            margin: 0;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          .universal-inv-sub {
            display: flex;
            align-items: center;
            justify-content: space-between;
          }

          .universal-inv-rarity {
            font-size: 9px;
            font-weight: 600;
            line-height: 1;
          }

          .universal-inv-type {
            font-size: 8px;
            font-weight: 500;
            text-transform: uppercase;
            letter-spacing: 0.3px;
            padding: 1px 5px;
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.12);
            color: #E5E7EB;
            margin-top: 3px;
          }

          .universal-inv-preview {
            width: 100%;
            height: 80px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 5px 0;
            z-index: 1;
          }

          .universal-inv-img {
            max-width: 100%;
            max-height: 100%;
            object-fit: contain;
            filter: drop-shadow(0 6px 10px rgba(0, 0, 0, 0.7));
            transition: transform 0.2s ease;
          }

          .universal-inv-card:hover .universal-inv-img {
            transform: scale(1.06);
          }
        `}
      </style>

      <div className="universal-inv-card" onClick={onClick}>
        <div
          className="universal-inv-card-inner"
          style={{
            background: theme.gradient,
            boxShadow: `inset 0 1px 0 ${theme.topHighlight}`,
          }}
        >
          <div className="universal-inv-header">
            <h4 className="universal-inv-name" title={itemName}>
              {itemName}
            </h4>
            <div className="universal-inv-sub">
              <span
                className="universal-inv-rarity"
                style={{ color: theme.textColor }}
              >
                {rarity}
              </span>
              <span className="universal-inv-type">{itemType}</span>
            </div>
          </div>

          <div className="universal-inv-preview">
            <img
              src={imageUrl}
              alt={itemName}
              className="universal-inv-img"
              draggable={false}
            />
          </div>
        </div>
      </div>
    </>
  );
};

export default AddtoInvItemCard;