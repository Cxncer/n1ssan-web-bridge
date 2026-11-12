import React from 'react';
import '../OverviewCard.css';

export interface InventoryCount {
  label: string;
  count: number;
}

interface OverviewCardProps {
  totalUnits: number;
  counts: InventoryCount[];
  subtitle?: string;
}

export const OverviewCard: React.FC<OverviewCardProps> = ({
  totalUnits,
  counts,
  subtitle = 'Across your collection',
}) => {
  return (
    <div className="overview-card">
      {/* Total Section with Blue Gradient Background */}
      <div className="overview-total-section">
        <span className="metric-label">
          ITEMS IN<br />INVENTORY
        </span>
        <div className="total-value">{String(totalUnits).padStart(2, '0')}</div>
        <small className="overview-subtitle">{subtitle}</small>
      </div>

      {/* Breakdown Grid / Columns */}
      <div className="overview-stats-grid">
        {counts.map((c) => (
          <div className="overview-stat-item" key={c.label}>
            <strong className={`quantity quantity-${c.label.toLowerCase()}`}>
              {String(c.count).padStart(2, '0')}
            </strong>
            <small>{c.label.toUpperCase()}</small>
          </div>
        ))}
      </div>
    </div>
  );
};