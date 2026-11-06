import skinColorIndex from './skinColorIndex.json'

/** Fast image-derived color matching. The histogram is generated offline by scripts/build-skin-color-index.mjs. */
type Histogram = { hue: number[]; neutral: number[] }
type ColorIndex = { version?: number; colors?: Record<string, Histogram> }
const index = skinColorIndex as ColorIndex

function rgbToHsl(r: number, g: number, b: number) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min
  let h = 0, s = 0
  const l = (max + min) / 2
  if (delta) {
    s = delta / (1 - Math.abs(2 * l - 1))
    if (max === r) h = 60 * (((g - b) / delta) % 6)
    else if (max === g) h = 60 * ((b - r) / delta + 2)
    else h = 60 * ((r - g) / delta + 4)
  }
  return { h: (h + 360) % 360, s, l }
}
function parseTarget(value: string) {
  const names: Record<string, string> = {
    red:'#e34b4b', orange:'#ee8b36', yellow:'#e6c94b', green:'#49b96b', cyan:'#45c6d4', blue:'#4d82e8',
    purple:'#a16be0', pink:'#e879b6', brown:'#9b6c4c', white:'#e8e8e8', gray:'#8c9298', grey:'#8c9298', black:'#252729'
  }
  const normalized = names[value.toLowerCase()] || value
  const match = normalized.match(/^#?([0-9a-f]{6})$/i)
  if (!match) return null
  const hex = match[1]
  return rgbToHsl(parseInt(hex.slice(0,2),16), parseInt(hex.slice(2,4),16), parseInt(hex.slice(4,6),16))
}
function histogramMatches(histogram: Histogram | undefined, target: string) {
  const color = parseTarget(target)
  if (!color || !histogram) return false
  if (color.s < 0.2) {
    const bucket = color.l < 0.22 ? 0 : color.l > 0.78 ? 2 : 1
    return (histogram.neutral?.[bucket] || 0) >= (bucket === 1 ? 0.18 : 0.12)
  }
  let percentage = 0
  for (let i = 0; i < (histogram.hue?.length || 0); i++) {
    const center = i * 15 + 7.5
    const distance = Math.min(Math.abs(center - color.h), 360 - Math.abs(center - color.h))
    if (distance <= 25) percentage += histogram.hue[i]
  }
  return percentage >= 0.10
}

export async function imageMatchesColor(idOrUrl: number | string, target: string): Promise<boolean> {
  // A numeric ID is the preferred key. URL support remains for backwards compatibility.
  const id = typeof idOrUrl === 'number' ? idOrUrl : null
  const histogram = id === null ? undefined : index.colors?.[String(id)]
  return histogramMatches(histogram, target)
}

export async function findImageColorMatches<T extends { id: number | string; image?: string; art?: string }>(
  items: T[],
  target: string,
  // Kept for API compatibility. The implementation reads the precomputed
  // histogram by item ID, so the image URL is no longer used here, but the
  // parameter is still part of the public signature and must remain.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _imageFor?: (item: T) => string,
): Promise<Set<T['id']>> {
  const result = new Set<T['id']>()
  for (const item of items) {
    if (histogramMatches(index.colors?.[String(item.id)], target)) result.add(item.id)
  }
  return result
}
