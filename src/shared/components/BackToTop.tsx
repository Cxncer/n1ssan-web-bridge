import { useEffect, useState } from 'react'
import './BackToTop.css'

/** Arrow appears once the page has been scrolled away from the top. */
export function BackToTop({ threshold = 400 }: { threshold?: number }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > threshold)
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [threshold])

  if (!visible) return null

  return (
    <button
      type="button"
      className="n1-back-to-top"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label="Back to top"
      title="Back to top"
    >
      <svg className="n1-back-to-top-arrow" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <path d="M10 16V4M10 4l-5 5M10 4l5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}

export default BackToTop
