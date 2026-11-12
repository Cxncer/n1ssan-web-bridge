import React, { useState, useRef, useEffect } from 'react';
import '../ProfileCard.css';

interface ProfileCardProps {
  name?: string;
  badge?: string;
  bio?: string;
  avatarUrl?: string;
  githubUrl?: string;
  alignRight?: boolean;
}

export function ProfileCard({
  name = 'Cxncer',
  badge = 'Hobbyist',
  bio = 'KDMV',
  avatarUrl = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=600&q=85',
  githubUrl = 'https://github.com',
  alignRight = false,
}: ProfileCardProps) {
  const [expanded, setExpanded] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside or pressing Escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (expanded && cardRef.current && !cardRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && expanded) {
        setExpanded(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [expanded]);

  return (
    <div className="profile-anchor">
      <div
        ref={cardRef}
        className={`profile-card ${expanded ? 'expanded' : ''}`}
        style={alignRight ? { left: 'auto', right: 0 } : undefined}
        onClick={() => !expanded && setExpanded(true)}
      >
        <div
          className="card-banner"
          onClick={(e) => {
            if (expanded) {
              e.stopPropagation();
              setExpanded(false);
            }
          }}
        >
          <img src={avatarUrl} alt={name} className="banner-img" />
          <div className="banner-scrim" />
          <div className="close-pill">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </div>
          <div className="banner-identity">
            <span className="dev-name">{name}</span>
            <span className="dev-badge">{badge}</span>
          </div>
        </div>

        <div className="card-body" onClick={(e) => e.stopPropagation()}>
          <p className="bio-text">{bio}</p>

          <a
            href={githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="github-btn"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
            <span>GitHub</span>
          </a>
        </div>
      </div>
    </div>
  );
}