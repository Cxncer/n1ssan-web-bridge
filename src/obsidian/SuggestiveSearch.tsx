import { useEffect, useState } from 'react'

type SuggestiveSearchProps = {
  value: string
  onChange: (value: string) => void
  suggestions: string[]
  ariaLabel: string
}

export default function SuggestiveSearch({ value, onChange, suggestions, ariaLabel }: SuggestiveSearchProps) {
  const [hint, setHint] = useState('')
  const signature = suggestions.join('|')

  useEffect(() => {
    const words = signature.split('|').filter(Boolean)
    if (!words.length) return
    let wordIndex = 0
    let characterIndex = 0
    let deleting = false
    let timer: ReturnType<typeof setTimeout>

    const tick = () => {
      const word = words[wordIndex % words.length]
      characterIndex += deleting ? -1 : 1
      setHint(word.slice(0, Math.max(0, characterIndex)))

      let delay = deleting ? 28 : 52
      if (!deleting && characterIndex >= word.length) {
        deleting = true
        delay = 1050
      } else if (deleting && characterIndex <= 0) {
        deleting = false
        wordIndex = (wordIndex + 1) % words.length
        delay = 260
      }
      timer = setTimeout(tick, delay)
    }

    timer = setTimeout(tick, 350)
    return () => clearTimeout(timer)
  }, [signature])

  return (
    <label className="suggestive-search">
      <span className="suggestive-search-icon" aria-hidden="true" />
      <input
        className="lb-search suggestive-search-input"
        type="search"
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={hint || 'Search items...'}
        aria-label={ariaLabel}
        autoComplete="off"
      />
    </label>
  )
}
