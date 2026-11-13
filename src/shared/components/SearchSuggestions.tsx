import { useMemo } from 'react'
import './SearchSuggestions.css'

const STORAGE_PREFIX = 'n1ssan-search:'
const RECENT_LIMIT = 3

/** The last three searches typed into one specific search bar. */
export function readRecentSearches(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string').slice(0, RECENT_LIMIT)
      : []
  } catch {
    return []
  }
}

/** Remembers a search text for one specific search bar, newest first. */
export function rememberSearch(key: string, value: string): string[] {
  const text = value.trim()
  if (!text) return readRecentSearches(key)
  const next = [
    text,
    ...readRecentSearches(key).filter(entry => entry.toLowerCase() !== text.toLowerCase()),
  ].slice(0, RECENT_LIMIT)
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(next))
  } catch {
    // Storage unavailable: suggestions still work for this session.
  }
  return next
}

/** Completions taken from the catalogue content the search bar filters. */
export function suggestSearches(query: string, values: readonly string[], limit = 6): string[] {
  const text = query.trim().toLowerCase()
  if (!text) return []

  const seen = new Set<string>()
  const matches: { value: string; score: number }[] = []

  for (const value of values) {
    const lower = value.trim().toLowerCase()
    if (!lower || lower === text || seen.has(lower)) continue
    const index = lower.indexOf(text)
    if (index < 0) continue
    seen.add(lower)
    matches.push({ value, score: index === 0 ? 0 : 1 })
  }

  return matches
    .sort((a, b) => a.score - b.score || a.value.length - b.value.length || a.value.localeCompare(b.value))
    .slice(0, limit)
    .map(match => match.value)
}

type SearchSuggestionsProps = {
  /** Current text in the search bar. */
  query: string
  /** Catalogue values (weapon names, finishes, sticker names...) to complete from. */
  values: readonly string[]
  /** Recent searches for this specific bar. */
  recent: string[]
  /** Applied when a suggestion or recent entry is chosen. */
  onPick: (value: string) => void
  className?: string
}

/**
 * Suggestion layer for one search bar: content completions while typing, and
 * the last three searches of this bar while it is still empty. The parent wraps
 * the input and this layer in `.search-suggestions-anchor`; the layer shows on
 * focus within that anchor.
 */
export function SearchSuggestions({ query, values, recent, onPick, className }: SearchSuggestionsProps) {
  const matches = useMemo(() => suggestSearches(query, values), [query, values])
  const showingRecent = !query.trim()

  const entries = showingRecent
    ? recent.map(value => ({ value, recent: true }))
    : matches.map(value => ({ value, recent: false }))

  if (entries.length === 0) return null

  return (
    <div
      className={`search-suggestions${className ? ` ${className}` : ''}`}
      role="listbox"
      aria-label={showingRecent ? 'Recent searches' : 'Search suggestions'}
      onMouseDown={event => event.preventDefault()}
    >
      <span className="search-suggestions-label">{showingRecent ? 'RECENT SEARCHES' : 'SUGGESTIONS'}</span>
      {entries.map(entry => (
        <button
          type="button"
          role="option"
          aria-selected={false}
          className={`search-suggestion${entry.recent ? ' is-recent' : ''}`}
          key={`${entry.recent ? 'recent' : 'suggestion'}-${entry.value}`}
          onClick={() => onPick(entry.value)}
        >
          <span className="search-suggestion-icon" aria-hidden="true">{entry.recent ? '↺' : '⌕'}</span>
          <span className="search-suggestion-text">{entry.value}</span>
        </button>
      ))}
    </div>
  )
}

export default SearchSuggestions
