import { useEffect, useMemo, useState } from 'react'
import skinData from './skins.json'
import LoadoutBuilder from './LoadoutBuilder'
import './App.css'
import './ColorSearch.css'
import { findImageColorMatches } from './skinColorDetection'

type Skin = { id: number; weapon: string; name: string; type: string; rarity: string; color: string; art: string; description: string; image?: string; minFloat?: number | null; maxFloat?: number | null }
type Page = 'catalogue' | 'favorites' | 'loadout'
const skins: Skin[] = skinData
const categories = ['All Skins', 'Pistols', 'Mid-Tier', 'Rifles', 'Snipers', 'Gloves', 'Knives', 'T Agents', 'CT Agents']
const rarityOrder = ['Contraband', 'Extraordinary', 'Covert', 'Classified', 'Restricted', 'Mil-Spec', 'Industrial Grade', 'Consumer Grade']
const COLOR_OPTIONS = [
  { name: 'Red', hex: '#e34b4b' }, { name: 'Orange', hex: '#ee8b36' }, { name: 'Yellow', hex: '#e6c94b' },
  { name: 'Green', hex: '#49b96b' }, { name: 'Cyan', hex: '#45c6d4' }, { name: 'Blue', hex: '#4d82e8' },
  { name: 'Purple', hex: '#a16be0' }, { name: 'Pink', hex: '#e879b6' }, { name: 'Brown', hex: '#9b6c4c' },
  { name: 'White', hex: '#e8e8e8' }, { name: 'Gray', hex: '#8c9298' }, { name: 'Black', hex: '#252729' },
]
function getDisplayRarity(skin: Skin) {
  if (skin.rarity.toLowerCase() === 'contraband') return 'Contraband'
  if (skin.type.toLowerCase().includes('knife') || skin.type.toLowerCase().includes('glove')) return 'Extraordinary'
  return skin.rarity
}
function getRarityKey(skin: Skin) { return getDisplayRarity(skin).toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '') }
function getCategory(skin: Skin) {
  const type = (skin.type || '').toLowerCase(), weapon = (skin.weapon || '').toLowerCase()
  if (type === 't agents') return 'T Agents'
  if (type === 'ct agents') return 'CT Agents'
  if (type.includes('glove') || weapon.includes('glove')) return 'Gloves'
  if (type.includes('knife') || weapon.includes('knife')) return 'Knives'
  if (type.includes('sniper') || ['awp', 'ssg 08', 'g3sg1', 'scar-20'].includes(weapon)) return 'Snipers'
  if (type.includes('pistol') || ['glock-18','usp-s','p2000','p250','tec-9','five-seven','cz75-auto','desert eagle','r8 revolver','dual berettas'].includes(weapon)) return 'Pistols'
  if (type.includes('smg') || type.includes('machine gun') || type.includes('shotgun') || ['mac-10','mp7','mp5-sd','mp9','ump-45','p90','pp-bizon','nova','xm1014','mag-7','sawed-off','m249','negev'].includes(weapon)) return 'Mid-Tier'
  if (type.includes('rifle') || ['ak-47','m4a4','m4a1-s','famas','galil ar','aug','sg 553'].includes(weapon)) return 'Rifles'
  return 'Other'
}
function App() {
  const [page, setPage] = useState<Page>('catalogue')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('All Skins')
  const [sort, setSort] = useState('Featured')
  const [selectedColor, setSelectedColor] = useState('')
  const [colorMatchIds, setColorMatchIds] = useState<Set<number> | null>(null)
  const [colorScanBusy, setColorScanBusy] = useState(false)
  const [favorites, setFavorites] = useState<number[]>([])
  const [selected, setSelected] = useState<Skin | null>(null)
  const [showBackToTop, setShowBackToTop] = useState(false)
  useEffect(() => { const fn = () => setShowBackToTop(window.scrollY > 400); window.addEventListener('scroll', fn, { passive: true }); fn(); return () => window.removeEventListener('scroll', fn) }, [])
  useEffect(() => { const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelected(null) }; window.addEventListener('keydown', fn); return () => window.removeEventListener('keydown', fn) }, [])
  // Scans skin images when a color is selected. Reset of the scan state
  // happens in setColorFilter() below, so this effect never calls setState
  // synchronously in its body.
  useEffect(() => {
    if (!selectedColor) return
    let cancelled = false
    const eligible = skins.filter(s => getCategory(s) !== 'T Agents' && getCategory(s) !== 'CT Agents' && !!s.image)
    findImageColorMatches(eligible, selectedColor, s => s.image || '').then(ids => {
      if (!cancelled) { setColorMatchIds(ids); setColorScanBusy(false) }
    })
    return () => { cancelled = true }
  }, [selectedColor])
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'auto' }) }, [page])
  const filteredSkins = useMemo(() => {
    const query = search.trim().toLowerCase()
    const result = skins.filter(s => {
      const text = `${s.weapon} ${s.name} ${s.type} ${s.rarity} ${s.description || ''} ${s.color || ''}`.toLowerCase()
      return (!query || text.includes(query)) && (category === 'All Skins' || getCategory(s) === category) && (!selectedColor || (getCategory(s) !== 'T Agents' && getCategory(s) !== 'CT Agents' && !!colorMatchIds?.has(s.id))) && (page !== 'favorites' || favorites.includes(s.id))
    })
    if (sort === 'Name A–Z') result.sort((a,b) => a.name.localeCompare(b.name))
    else if (sort === 'Name Z–A') result.sort((a,b) => b.name.localeCompare(a.name))
    else if (sort === 'Rarity') result.sort((a,b) => { const ar = rarityOrder.indexOf(getDisplayRarity(a)), br = rarityOrder.indexOf(getDisplayRarity(b)); return (ar < 0 ? 999 : ar) - (br < 0 ? 999 : br) })
    return result
  }, [search, category, selectedColor, colorMatchIds, sort, favorites, page])
  function toggleFavorite(id: number) { setFavorites(old => old.includes(id) ? old.filter(x => x !== id) : [...old, id]) }
  // Single place that changes the color filter. Handles both the filter
  // value and the scan-state reset, so the effect above can stay clean.
  function setColorFilter(next: string) {
    setSelectedColor(next)
    if (next) {
      setColorMatchIds(new Set())
      setColorScanBusy(true)
    } else {
      setColorMatchIds(null)
      setColorScanBusy(false)
    }
  }
  function navigate(next: Page) { setPage(next); setSearch(''); setCategory('All Skins'); setColorFilter('') }
  const pageTitle = page === 'catalogue' ? 'Skins Catalogue' : page === 'favorites' ? 'Your Favorites' : 'Loadout Builder'
  return <div className={`n1ssan-layout ${sidebarCollapsed ? 'sidebar-is-collapsed' : ''}`}>
    <aside className="sidebar">
      <a className="sidebar-brand" href="#catalogue" aria-label="n1ssan home" onClick={e => { e.preventDefault(); navigate('catalogue') }}><span className="brand-mark">n.</span>{!sidebarCollapsed && <span className="sidebar-brand-name">n1ssan</span>}</a>
      <button type="button" className="sidebar-collapse" onClick={() => setSidebarCollapsed(v => !v)} aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}><span>{sidebarCollapsed ? '»' : '«'}</span>{!sidebarCollapsed && <span>Collapse menu</span>}</button>
      <div className="sidebar-section-label">{!sidebarCollapsed && 'WORKSPACE'}</div>
      <nav className="sidebar-nav" aria-label="Main navigation">
        <button type="button" className={`sidebar-nav-item ${page === 'catalogue' ? 'active' : ''}`} onClick={() => navigate('catalogue')} title="Skins Catalogue" aria-current={page === 'catalogue' ? 'page' : undefined}><span className="sidebar-nav-icon">▦</span>{!sidebarCollapsed && <span>Skins Catalogue</span>}</button>
        <button type="button" className={`sidebar-nav-item ${page === 'favorites' ? 'active' : ''}`} onClick={() => navigate('favorites')} title="Favorites" aria-current={page === 'favorites' ? 'page' : undefined}><span className="sidebar-nav-icon">♥</span>{!sidebarCollapsed && <><span className="sidebar-nav-label">Favorites</span><span className="sidebar-nav-count">{favorites.length}</span></>}{sidebarCollapsed && favorites.length > 0 && <span className="sidebar-collapsed-dot" />}</button>
        <button type="button" className={`sidebar-nav-item ${page === 'loadout' ? 'active' : ''}`} onClick={() => navigate('loadout')} title="Loadout" aria-current={page === 'loadout' ? 'page' : undefined}><span className="sidebar-nav-icon">⌁</span>{!sidebarCollapsed && <span>Loadout</span>}</button>
      </nav>
      <div className="sidebar-bottom"><div className="sidebar-bottom-mark">N</div>{!sidebarCollapsed && <div className="sidebar-bottom-copy"><strong>n1ssan</strong><span>PERSONAL SKIN ARCHIVE</span></div>}</div>
    </aside>
    <div className="n1ssan-main">
      <header className="site-header"><div className="header-page-context"><span className="header-context-dot" /><span>{pageTitle.toUpperCase()}</span></div><div className="header-caption">COUNTER-STRIKE SKIN ARCHIVE</div><div className="header-total"><span>{skins.length.toLocaleString()}</span><span>ITEMS</span></div></header>
      <main className="main-content">
        {page === 'loadout' ? <div className="page-content loadout-page"><div className="page-intro"><div className="eyebrow"><span className="status-dot" />PERSONAL ARMORY</div><h1>Build your <span>loadout.</span></h1><p>Set up your Terrorist and Counter-Terrorist weapon finishes. Your choices are saved in this browser.</p></div><LoadoutBuilder skins={skins} /></div> : <div className="page-content">
          <section className="hero"><div className="eyebrow"><span className="status-dot" />{page === 'favorites' ? 'YOUR PERSONAL PICKS' : 'PERSONAL SKIN CATALOGUE'}</div><h1>{page === 'favorites' ? <>Your <span>favorites.</span></> : <>Find your <span>finish.</span></>}</h1><p>{page === 'favorites' ? 'The weapon finishes you have saved for later. Keep your personal picks all in one place.' : 'A personal archive of Counter-Strike weapon finishes. Browse, discover, and keep track of your favorites.'}</p><div className="hero-stats"><div><strong>{skins.length.toLocaleString()}</strong><span>ITEMS IN ARCHIVE</span></div><div><strong>{favorites.length.toString().padStart(2,'0')}</strong><span>YOUR FAVORITES</span></div></div></section>
          <section className="catalogue" id="catalogue"><div className="catalogue-heading"><div><div className="eyebrow">{page === 'favorites' ? 'SAVED COLLECTION' : 'THE COLLECTION'}</div><h2>{page === 'favorites' ? 'Favorite Items' : 'Skin Catalogue'}</h2></div><span className="result-count">{filteredSkins.length.toLocaleString()} RESULTS</span></div>
            <div className="toolbar"><label className="search-box"><span aria-hidden="true">⌕</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search weapons or finishes..." aria-label="Search skins" />{search && <button type="button" className="clear-search" onClick={() => setSearch('')} aria-label="Clear search">×</button>}</label><label className="sort-box"><span>SORT</span><select value={sort} onChange={e => setSort(e.target.value)}><option>Featured</option><option>Name A–Z</option><option>Name Z–A</option><option>Rarity</option></select></label></div>
            <div className="catalogue-color-filter"><div className="catalogue-color-heading"><span>FILTER BY COLOR</span><small>{selectedColor ? (colorScanBusy ? 'Analyzing item images…' : `Image-based matches for ${selectedColor}`) : 'Find finishes by color'}</small></div><div className="catalogue-color-swatches"><button type="button" className={`catalogue-color-chip ${!selectedColor ? 'active' : ''}`} onClick={() => setColorFilter('')}>All colors</button>{COLOR_OPTIONS.map(c => <button key={c.name} type="button" className={`catalogue-color-swatch ${selectedColor === c.name.toLowerCase() ? 'active' : ''}`} onClick={() => setColorFilter(selectedColor === c.name.toLowerCase() ? '' : c.name.toLowerCase())} aria-pressed={selectedColor === c.name.toLowerCase()} title={c.name}><span style={{ background: c.hex }} />{c.name}</button>)}<label className={`catalogue-custom-color ${selectedColor.startsWith('#') ? 'active' : ''}`} title="Pick any color"><input type="color" value={selectedColor.startsWith('#') ? selectedColor : '#e34b4b'} onChange={e => setColorFilter(e.target.value.toLowerCase())} aria-label="Pick a custom color"/><span>Custom color</span></label></div></div>
            <nav className="category-list" aria-label="Skin categories">{categories.map(item => <button key={item} type="button" className={`category-button ${category === item ? 'active' : ''}`} onClick={() => setCategory(item)}>{item}</button>)}</nav>
            {page === 'favorites' && <div className="filter-notice">{favorites.length} saved {favorites.length === 1 ? 'item' : 'items'}<button type="button" onClick={() => navigate('catalogue')}>Browse all items ↗</button></div>}
            {selectedColor && colorScanBusy ? <div className="empty-state color-scan-state"><span>◌</span><h3>Analyzing skin images</h3><p>Checking actual image pixels for color matches. The first scan may take a little while; results are cached in this browser.</p></div> : filteredSkins.length ? <div className="skin-grid">{filteredSkins.map((skin,index) => { const favorite = favorites.includes(skin.id); return <article className="skin-card" key={skin.id}><div className={`skin-art rarity-art rarity-art-${getRarityKey(skin)}`} role="button" tabIndex={0} onClick={() => setSelected(skin)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(skin) } }} aria-label={`View ${skin.weapon} | ${skin.name}`}><span className="art-index">{String(index+1).padStart(2,'0')}</span><span className="art-glow" />{skin.image ? <img className="skin-image" src={skin.image} alt={`${skin.weapon} | ${skin.name}`} loading="lazy" /> : <span className="weapon-silhouette">{skin.art}</span>}<span className="art-finish">{skin.name.toUpperCase()}</span><button type="button" className={`favorite-button ${favorite ? 'favorited' : ''}`} onClick={e => { e.stopPropagation(); toggleFavorite(skin.id) }} aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'} title={favorite ? 'Remove favorite' : 'Add favorite'}>{favorite ? '♥' : '♡'}</button><span className="view-hint">VIEW DETAILS ↗</span></div><div className="skin-info"><div className="skin-weapon">{skin.weapon}</div><h3>{skin.name}</h3><div className="skin-meta"><span className={`rarity-dot rarity-${getRarityKey(skin)}`} /><span>{getDisplayRarity(skin)}</span><span className="meta-separator">/</span><span>{skin.type}</span></div></div></article> })}</div> : <div className="empty-state"><span>⌕</span><h3>{page === 'favorites' && favorites.length === 0 ? 'No favorites yet' : 'No items found'}</h3><p>{page === 'favorites' && favorites.length === 0 ? 'Browse the catalogue and tap the heart on items you like.' : 'Try another search, color, or category.'}</p><button type="button" onClick={() => { setSearch(''); setCategory('All Skins'); setColorFilter(''); if (page === 'favorites' && favorites.length === 0) navigate('catalogue') }}>{page === 'favorites' && favorites.length === 0 ? 'Explore catalogue' : 'Clear filters'}</button></div>}
          </section></div>}
      </main>
      <footer className="site-footer"><a className="brand footer-brand" href="#catalogue" onClick={e => { e.preventDefault(); navigate('catalogue') }}><span className="brand-mark">n.</span><span>n1ssan</span></a><span>PERSONAL COUNTER-STRIKE SKIN ARCHIVE</span><span>BUILT FOR THE LOVE OF THE GAME.</span></footer>
    </div>
    {selected && <div className="modal-backdrop" onClick={() => setSelected(null)} role="presentation"><section className="detail-modal" role="dialog" aria-modal="true" aria-label={`${selected.weapon} | ${selected.name}`} onClick={e => e.stopPropagation()}><button type="button" className="modal-close" onClick={() => setSelected(null)} aria-label="Close details">×</button><div className={`detail-art rarity-art rarity-art-${getRarityKey(selected)}`}><span className="art-glow" />{selected.image ? <img className="detail-image" src={selected.image} alt={`${selected.weapon} | ${selected.name}`} /> : <span className="weapon-silhouette detail-silhouette">{selected.art}</span>}</div><div className="detail-content"><div className="eyebrow">ITEM DETAILS</div><div className="detail-weapon">{selected.weapon}</div><h2>{selected.name}</h2><div className="detail-rarity"><span className={`rarity-dot rarity-${getRarityKey(selected)}`} />{getDisplayRarity(selected)}</div><p>{selected.description || 'An item from the Counter-Strike collection.'}</p><div className="detail-facts"><div><span>ITEM</span><strong>{selected.weapon}</strong></div><div><span>TYPE</span><strong>{selected.type}</strong></div><div><span>RARITY</span><strong>{getDisplayRarity(selected)}</strong></div></div><button type="button" className={`detail-favorite ${favorites.includes(selected.id) ? 'active' : ''}`} onClick={() => toggleFavorite(selected.id)}>{favorites.includes(selected.id) ? '♥  Remove from favorites' : '♡  Add to favorites'}</button></div></section></div>}
    {showBackToTop && page !== 'loadout' && <button type="button" className="back-to-top" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="Back to top" title="Back to top">↑</button>}
  </div>
}
export default App
