import { useEffect, useMemo, useState } from 'react'
import skinData from '../skins.json'
import './obsidian.css'

type Skin = { id: number; weapon: string; name: string; type: string; rarity: string; color: string; art: string; description: string; image?: string; minFloat?: number | null; maxFloat?: number | null }
type StickerAttachment = { id: string; name: string; slot: number; wear: string }
type CharmAttachment = { id: string; name: string; pattern: string }
type InventoryItem = { instanceId: string; definitionId: number; float: string; seed: string; stattrak: boolean; customName: string; stickers: StickerAttachment[]; charm: CharmAttachment | null }
type InventoryProfile = { id: string; name: string; items: InventoryItem[]; updatedAt: string }
const catalogue = skinData as Skin[]
const makeId = () => `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
const normalizeItem = (item: InventoryItem): InventoryItem => ({ ...item, stickers: Array.isArray(item.stickers) ? item.stickers : [], charm: item.charm ?? null })
const profileId = () => `profile-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
const getCategory = (skin: Skin) => {
  const type = (skin.type || '').toLowerCase(), weapon = (skin.weapon || '').toLowerCase()
  if (type.includes('glove') || weapon.includes('glove')) return 'Gloves'
  if (type.includes('knife') || weapon.includes('knife')) return 'Knives'
  if (type.includes('agent')) return 'Agents'
  if (type.includes('sniper') || ['awp', 'ssg 08', 'g3sg1', 'scar-20'].includes(weapon)) return 'Snipers'
  if (type.includes('pistol') || ['glock-18','usp-s','p2000','p250','tec-9','five-seven','cz75-auto','desert eagle','r8 revolver','dual berettas'].includes(weapon)) return 'Pistols'
  if (type.includes('smg') || type.includes('machine gun') || type.includes('shotgun') || ['mac-10','mp7','mp5-sd','mp9','ump-45','p90','pp-bizon','nova','xm1014','mag-7','sawed-off','m249','negev'].includes(weapon)) return 'Mid-Tier'
  if (type.includes('rifle') || ['ak-47','m4a4','m4a1-s','famas','galil ar','aug','sg 553'].includes(weapon)) return 'Rifles'
  return 'Other'
}
const rarityClass = (value: string) => value.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '')
const isAgent = (skin: Skin) => getCategory(skin) === 'Agents'
const rarityRank = (value: string) => ({ 'Consumer Grade':1,'Base Grade':1,'Industrial Grade':2,'High Grade':2,'Mil-Spec Grade':3,'Remarkable':3,'Restricted':4,'Exotic':4,'Classified':5,'Extraordinary':5,'Covert':6,'Master':6,'Contraband':7 } as Record<string,number>)[value] ?? 0
const initialItems = (): InventoryItem[] => {
  const picks = [
    catalogue.find(s => s.weapon.toLowerCase() === 'ak-47'),
    catalogue.find(s => s.weapon.toLowerCase() === 'awp'),
    catalogue.find(s => s.weapon.toLowerCase() === 'glock-18'),
    catalogue.find(s => s.weapon.toLowerCase() === 'm4a1-s'),
    catalogue.find(s => getCategory(s) === 'Knives'),
    catalogue.find(s => getCategory(s) === 'Gloves'),
  ].filter((s): s is Skin => !!s)
  return picks.map((s, i) => ({ instanceId: `demo-${i + 1}`, definitionId: s.id, float: ['0.01842','0.07135','0.12408','0.03211','0.00621','0.08417'][i], seed: ['413','28','721','156','492','318'][i], stattrak: i === 0, customName: '', stickers: [], charm: null }))
}
const seedItems = initialItems()
const initialProfiles: InventoryProfile[] = [{ id: 'profile-main', name: 'Main inventory', items: seedItems, updatedAt: 'Just now' }, { id: 'profile-clean', name: 'Clean setup', items: seedItems.slice(0, 4).map((item, i) => ({ ...item, instanceId: `clean-${i}`, stattrak: false })), updatedAt: 'Preview' }]
const STORAGE_KEY = 'n1ssan-obsidian-preview-v1'
const loadProfiles = (): InventoryProfile[] => {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (!saved) return initialProfiles
    const parsed: unknown = JSON.parse(saved)
    return Array.isArray(parsed) && parsed.length ? (parsed as InventoryProfile[]).map(profile => ({ ...profile, items: Array.isArray(profile.items) ? profile.items.map(normalizeItem) : [] })) : initialProfiles
  } catch { return initialProfiles }
}

export default function ObsidianApp() {
  const [profiles, setProfiles] = useState(loadProfiles)
  const [activeId, setActiveId] = useState(() => window.localStorage.getItem(`${STORAGE_KEY}:active`) ?? profiles[0]?.id ?? initialProfiles[0].id)
  const [items, setItems] = useState(() => profiles[0]?.items.map(item => ({ ...item })) ?? seedItems)
  const [category, setCategory] = useState('All items')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('Recently Added')
  const [dialog, setDialog] = useState<'add' | 'detail' | 'profiles' | 'diagnostics' | null>(null)
  const [selectedInstance, setSelectedInstance] = useState<string | null>(null)
  const [catalogueSearch, setCatalogueSearch] = useState('')
  const [profileName, setProfileName] = useState('')
  const [notice, setNotice] = useState('')
  const [stickerName, setStickerName] = useState('')
  const [stickerWear, setStickerWear] = useState('0.00')
  const [stickerSlot, setStickerSlot] = useState('1')
  const [charmName, setCharmName] = useState('')
  const [charmPattern, setCharmPattern] = useState('')

  const owned = useMemo(() => items.map(item => ({ item, skin: catalogue.find(s => s.id === item.definitionId) })).filter((x): x is { item: InventoryItem; skin: Skin } => !!x.skin), [items])
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const result = owned.filter(({ item, skin }) => (!q || `${skin.weapon} ${skin.name} ${skin.rarity}`.toLowerCase().includes(q)) && (category === 'All items' || getCategory(skin) === category))
    if (sort === 'Name A–Z') result.sort((a,b) => a.skin.weapon.localeCompare(b.skin.weapon) || a.skin.name.localeCompare(b.skin.name))
    if (sort === 'Float: Lowest') result.sort((a,b) => Number(a.item.float) - Number(b.item.float))
    if (sort === 'Rarity: Highest') result.sort((a,b) => { const categoryRank = (skin: Skin) => getCategory(skin) === 'Knives' ? 3 : getCategory(skin) === 'Gloves' ? 2 : 1; return categoryRank(b.skin) - categoryRank(a.skin) || rarityRank(b.skin.rarity) - rarityRank(a.skin.rarity) || a.skin.name.localeCompare(b.skin.name) })
    return result
  }, [owned, search, category, sort])
  const selected = owned.find(x => x.item.instanceId === selectedInstance)
  const searching = search.trim().length > 0
  const counts = ['Rifles','Pistols','Knives','Gloves','Agents'].map(label => ({ label, count: owned.filter(x => getCategory(x.skin) === label).length }))
  const updateItems = (next: InventoryItem[]) => {
    setItems(next)
    setProfiles(old => old.map(p => p.id === activeId ? { ...p, items: next, updatedAt: 'Just now' } : p))
  }
  const switchProfile = (id: string) => {
    const next = profiles.find(p => p.id === id)
    if (!next) return
    setActiveId(id); setItems(next.items.map(item => ({ ...item }))); setNotice(`Loaded “${next.name}”`)
  }
  const saveProfile = () => {
    const name = profileName.trim()
    if (!name) return
    const next = { id: profileId(), name, items: items.map(item => ({ ...item, instanceId: makeId() })), updatedAt: 'Just now' }
    setProfiles(old => [...old, next]); setActiveId(next.id); setItems(next.items); setProfileName(''); setNotice('Inventory snapshot saved')
  }
  const deleteProfile = (id: string) => {
    if (profiles.length < 2) { setNotice('Keep at least one inventory profile'); return }
    const next = profiles.filter(p => p.id !== id)
    setProfiles(next)
    if (id === activeId) switchProfile(next[0].id)
  }
  const addSkin = (skin: Skin) => {
    const next = [...items, { instanceId: makeId(), definitionId: skin.id, float: isAgent(skin) ? '' : '0.00000', seed: isAgent(skin) ? '' : '1', stattrak: false, customName: '', stickers: [], charm: null }]
    updateItems(next); setDialog(null); setNotice(`${skin.weapon} · ${skin.name} added`)
  }
  const addSticker = () => {
    if (!selected || !stickerName.trim()) return
    const slot = Number(stickerSlot)
    if (selected.item.stickers.some(sticker => sticker.slot === slot)) { setNotice(`Sticker slot ${slot} is already occupied`); return }
    const next = [...selected.item.stickers, { id: makeId(), name: stickerName.trim(), slot, wear: stickerWear.trim() || '0.00' }].sort((a,b) => a.slot - b.slot)
    updateItems(items.map(item => item.instanceId === selected.item.instanceId ? { ...item, stickers: next } : item))
    setStickerName(''); setNotice(`Sticker added to slot ${slot}`)
  }
  const removeSticker = (id: string) => {
    if (!selected) return
    updateItems(items.map(item => item.instanceId === selected.item.instanceId ? { ...item, stickers: item.stickers.filter(sticker => sticker.id !== id) } : item))
  }
  const saveCharm = () => {
    if (!selected || !charmName.trim()) return
    updateItems(items.map(item => item.instanceId === selected.item.instanceId ? { ...item, charm: { id: makeId(), name: charmName.trim(), pattern: charmPattern.trim() } } : item))
    setCharmName(''); setCharmPattern(''); setNotice('Charm attached')
  }
  const removeCharm = () => {
    if (!selected) return
    updateItems(items.map(item => item.instanceId === selected.item.instanceId ? { ...item, charm: null } : item))
    setNotice('Charm removed')
  }
  const updateSelected = (patch: Partial<InventoryItem>) => {
    if (!selected) return
    updateItems(items.map(item => item.instanceId === selected.item.instanceId ? { ...item, ...patch } : item))
  }
  const removeSelected = () => {
    if (!selected) return
    updateItems(items.filter(item => item.instanceId !== selected.item.instanceId)); setSelectedInstance(null); setDialog(null); setNotice('Item removed from inventory')
  }
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 3000)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles))
    window.localStorage.setItem(`${STORAGE_KEY}:active`, activeId)
  }, [profiles, activeId])

  const candidates = useMemo(() => {
    const q = catalogueSearch.trim().toLowerCase()
    return catalogue.filter(s => (!q || `${s.weapon} ${s.name} ${s.type}`.toLowerCase().includes(q))).slice(0, 80)
  }, [catalogueSearch])

  return <div className="obsidian-shell">
    <header className="ob-topbar">
      <a className="ob-brand" href="#inventory" aria-label="n1ssan Obsidian"><span className="ob-mark">n.</span><span>n1ssan</span><i /> <small>OBSIDIAN</small></a>
      <nav className="ob-nav"><a className="active" href="#inventory">Inventory</a><button onClick={() => setDialog('diagnostics')}>Diagnostics <span className="nav-count">01</span></button></nav>
      <div className="ob-top-right"><span className="cs2-status-dot" /><span className="cs2-status-text">CS2 NOT DETECTED</span></div>
    </header>

    <main className="ob-main" id="inventory">
      <div className="ob-breadcrumb"><span>WORKSPACE</span><b>/</b><strong>INVENTORY</strong></div>
      <section className="ob-heading">
        <div><h1>Your Armory<span>.</span></h1><p>Every finish, in its place. Curate your collection and keep each version close.</p></div>
        <div className="ob-heading-actions"><label className="profile-select-label">ACTIVE INVENTORY PROFILE<select value={activeId} onChange={e => switchProfile(e.target.value)}>{profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><button className="ob-button shimmer-button" onClick={() => setDialog('profiles')}>Manage profiles <span>↗</span></button></div>
      </section>

      <section className="ob-overview">
        <div className="overview-total"><span className="metric-label">ITEMS IN INVENTORY</span><strong>{String(items.length).padStart(2,'0')}</strong><small>Across your collection</small></div>
        {counts.map((c, i) => <div className="overview-stat" key={c.label}><span className="metric-index">0{i + 1}</span><strong className={`quantity quantity-${c.label.toLowerCase()}`}>{String(c.count).padStart(2,'0')}</strong><small>{c.label.toUpperCase()}</small></div>)}
        <div className="overview-status"><span className="status-ring">✓</span><div><strong>All in order</strong><small>Preview data · stored locally</small></div></div>
      </section>

      <section className="ob-inventory-section">
        <div className="ob-section-head"><div><h2>Inventory <span>Overview</span></h2></div><div className="ob-section-meta"><span className="live-dot" /> {visible.length} ITEMS DISPLAYED</div></div>
        <div className="ob-toolbar"><label className="ob-search"><span>⌕</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search your inventory..." /><kbd>⌘ K</kbd></label><div className="ob-sort"><span>SORT BY</span><select value={sort} onChange={e => setSort(e.target.value)}><option>Recently Added</option><option>Name A–Z</option><option>Float: Lowest</option><option>Rarity: Highest</option></select></div><button className="ob-button shimmer-button add-item-button" onClick={() => { setCatalogueSearch(''); setDialog('add') }}><span>＋</span> Add item</button></div>
        <div className="ob-filters">{['All items','Rifles','Pistols','Mid-Tier','Snipers','Knives','Gloves','Agents'].map(c => <button key={c} className={category === c ? 'selected' : ''} onClick={() => setCategory(c)}>{c}<small>{c === 'All items' ? items.length : owned.filter(x => getCategory(x.skin) === c).length}</small></button>)}</div>

        {visible.length ? <div className={`ob-item-grid ${searching ? 'search-active' : ''}`}>{visible.map(({ item, skin }, index) => <button className={`ob-item-card rarity-card-${rarityClass(skin.rarity)} item-category-${getCategory(skin).toLowerCase()}`} key={item.instanceId} onClick={() => { setSelectedInstance(item.instanceId); setDialog('detail') }}>
          <div className={`ob-item-art rarity-${rarityClass(skin.rarity)}`}><span className="item-glow" />{skin.image ? <img src={skin.image} alt="" loading="lazy" /> : <span className="item-fallback">{skin.art}</span>}<span className="item-rarity">{skin.rarity}</span></div>
          <div className="ob-item-copy"><div className="ob-item-weapon">{skin.weapon}{item.stattrak && <span className="stattrak">ST™</span>}</div>{item.customName.trim() && <span className="item-display-name">{item.customName}</span>}<strong>{skin.name}</strong><div className="ob-item-foot">{!isAgent(skin) && <><span>FLOAT <b>{item.float}</b></span><span>SEED <b>{item.seed}</b></span></>}</div></div><span className="item-open">↗</span>
        </button>)}</div> : <div className="ob-empty"><span>⌕</span><h3>Nothing in this view</h3><p>Try another filter or add an item from the catalogue.</p><button className="ob-button shimmer-button" onClick={() => { setCategory('All items'); setSearch('') }}>Clear filters</button></div>}
      </section>
      <footer className="ob-footer"><span>n1ssan <b>/</b> OBSIDIAN</span><span>INVENTORY WORKSPACE <i /> PREVIEW BUILD</span><span>COUNTER-STRIKE 2</span></footer>
    </main>

    {notice && <div className="ob-notification-stack" role="status" aria-live="polite"><div className="ob-notification-icon">✓</div><div className="ob-notification-copy"><strong>Inventory updated</strong><span>{notice}</span></div><button aria-label="Dismiss notification" onClick={() => setNotice('')}>×</button><i className="ob-notification-timer" /></div>}

    {dialog && <div className="ob-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setDialog(null) }}>
      {dialog === 'add' && <section className="ob-dialog ob-add-dialog"><div className="dialog-head"><div><div className="ob-kicker">CATALOGUE</div><h2>Add to <span>inventory.</span></h2></div><button className="dialog-close" onClick={() => setDialog(null)}>×</button></div><label className="ob-search dialog-search"><span>⌕</span><input autoFocus value={catalogueSearch} onChange={e => setCatalogueSearch(e.target.value)} placeholder="Search weapons, finishes..." /></label><div className="ob-catalogue-list">{candidates.map(s => <button key={s.id} onClick={() => addSkin(s)}><div className="catalogue-thumb">{s.image && <img src={s.image} alt="" loading="lazy" />}</div><span><strong>{s.weapon}</strong><small>{s.name} · {s.rarity}</small></span><b>＋</b></button>)}</div><div className="dialog-foot">Showing up to 80 catalogue matches · Add creates a new inventory instance</div></section>}
      {dialog === 'detail' && selected && <section className="ob-dialog ob-detail-dialog"><div className="dialog-head"><div><div className="ob-kicker">INVENTORY INSTANCE</div><h2>Item <span>details.</span></h2></div><button className="dialog-close" onClick={() => setDialog(null)}>×</button></div><div className="detail-preview"><div className="detail-preview-art">{selected.skin.image && <img src={selected.skin.image} alt="" />}</div><div><small>{selected.skin.weapon}</small><h3>{selected.skin.name}</h3><span>{selected.skin.rarity} · {getCategory(selected.skin)}</span></div></div><div className="ob-fields">{!isAgent(selected.skin) && <><label>FLOAT VALUE<input value={selected.item.float} onChange={e => updateSelected({ float: e.target.value })} inputMode="decimal" /></label><label>PAINT SEED<input value={selected.item.seed} onChange={e => updateSelected({ seed: e.target.value })} inputMode="numeric" /></label></>}<label className="field-wide">CUSTOM NAME<input value={selected.item.customName} onChange={e => updateSelected({ customName: e.target.value })} placeholder="Name this item..." /></label>{!isAgent(selected.skin) && <button type="button" className={`stattrak-toggle ${selected.item.stattrak ? 'enabled' : ''}`} aria-pressed={selected.item.stattrak} onClick={() => updateSelected({ stattrak: !selected.item.stattrak })}><span className="st-toggle-label">ST</span><span className="st-toggle-track"><i /></span></button>}</div>{!isAgent(selected.skin) && !['Knives','Gloves'].includes(getCategory(selected.skin)) && <div className="attachment-editor"><section className="attachment-section"><div className="attachment-heading"><div><strong>Stickers</strong><small>{selected.item.stickers.length}/5 applied · instance-specific</small></div><span>{selected.item.stickers.length.toString().padStart(2,'0')} / 05</span></div><div className="sticker-slots">{[1,2,3,4,5].map(slot => { const sticker = selected.item.stickers.find(entry => entry.slot === slot); return <div className={sticker ? 'sticker-slot filled' : 'sticker-slot'} key={slot}><span className="slot-number">0{slot}</span>{sticker ? <><span className="slot-sticker-copy"><strong>{sticker.name}</strong><small>Wear {sticker.wear}</small></span><button type="button" aria-label={`Remove sticker from slot ${slot}`} onClick={() => removeSticker(sticker.id)}>×</button></> : <span className="slot-empty">Empty sticker slot</span>}</div> })}</div><div className="attachment-form"><input value={stickerName} onChange={e => setStickerName(e.target.value)} placeholder="Sticker name" aria-label="Sticker name" /><select value={stickerSlot} onChange={e => setStickerSlot(e.target.value)} aria-label="Sticker slot">{[1,2,3,4,5].map(slot => <option key={slot} value={slot} disabled={selected.item.stickers.some(sticker => sticker.slot === slot)}>Slot {slot}</option>)}</select><input value={stickerWear} onChange={e => setStickerWear(e.target.value)} placeholder="Wear" aria-label="Sticker wear" /><button type="button" onClick={addSticker} disabled={!stickerName.trim()}>＋ Add</button></div></section><section className="attachment-section charm-section"><div className="attachment-heading"><div><strong>Weapon charm</strong><small>One charm per inventory item</small></div><span>{selected.item.charm ? 'ATTACHED' : 'EMPTY'}</span></div>{selected.item.charm ? <div className="charm-current"><span className="charm-orb">✳</span><span><strong>{selected.item.charm.name}</strong><small>{selected.item.charm.pattern ? `Pattern ${selected.item.charm.pattern}` : 'No pattern specified'}</small></span><button type="button" onClick={removeCharm}>Remove</button></div> : <div className="attachment-form charm-form"><input value={charmName} onChange={e => setCharmName(e.target.value)} placeholder="Charm name" aria-label="Charm name" /><input value={charmPattern} onChange={e => setCharmPattern(e.target.value)} placeholder="Pattern / seed (optional)" aria-label="Charm pattern" /><button type="button" onClick={saveCharm} disabled={!charmName.trim()}>＋ Attach charm</button></div>}</section><p className="attachment-note">Manual preview entries for now. Catalogue artwork and live CS2 attachment data will follow.</p></div>}<div className="dialog-actions"><button className="ob-button shimmer-button remove-item-button" onClick={removeSelected}>Remove item</button><button className="ob-button shimmer-button" onClick={() => setDialog(null)}>Done</button></div></section>}
      {dialog === 'profiles' && <section className="ob-dialog ob-profiles-dialog"><div className="dialog-head"><div><div className="ob-kicker">SAVED SNAPSHOTS</div><h2>Inventory <span>profiles.</span></h2><p>Each profile stores a complete inventory snapshot. Switching replaces the active inventory.</p></div><button className="dialog-close" onClick={() => setDialog(null)}>×</button></div><div className="profile-list">{profiles.map(p => <div className={p.id === activeId ? 'profile-row current' : 'profile-row'} key={p.id}><button className="profile-load" onClick={() => switchProfile(p.id)}><span className="profile-radio">{p.id === activeId && <i />}</span><span><strong>{p.name}</strong><small>{p.items.length} items · {p.updatedAt}</small></span></button><button className="profile-delete" title="Delete profile" onClick={() => deleteProfile(p.id)} disabled={profiles.length < 2}>×</button></div>)}</div><div className="new-profile"><label>NEW INVENTORY PROFILE<input value={profileName} onChange={e => setProfileName(e.target.value)} placeholder="e.g. Tournament setup" onKeyDown={e => { if (e.key === 'Enter') saveProfile() }} /></label><button className="ob-button shimmer-button" onClick={saveProfile} disabled={!profileName.trim()}>Save snapshot <span>＋</span></button></div><div className="dialog-foot">Unlimited local preview profiles · Switching restores the saved snapshot, not a merge</div></section>}
      {dialog === 'diagnostics' && <section className="ob-dialog ob-diagnostics-dialog"><div className="dialog-head"><div><div className="ob-kicker">SYSTEM HEALTH</div><h2>Diagnostics<span>.</span></h2><p>Runtime and compatibility checks for the CS2 integration.</p></div><button className="dialog-close" onClick={() => setDialog(null)}>×</button></div><div className="diagnostic-list"><div><span className="diagnostic-state pending" /><span><strong>CS2 process detection</strong><small>Not connected · preview cannot inspect local processes</small></span><b>WAITING</b></div><div><span className="diagnostic-state pending" /><span><strong>Bridge connection</strong><small>Runtime integration has not been connected</small></span><b>PENDING</b></div><div><span className="diagnostic-state pending" /><span><strong>Offsets &amp; signatures</strong><small>Version validation will report outdated definitions here</small></span><b>NOT CHECKED</b></div></div><div className="dialog-foot">Diagnostics UI preview · no process or signature checks are running yet</div></section>}
    </div>}
    <button className="ob-back-to-top" type="button" aria-label="Back to top" title="Back to top" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}><span>↑</span></button>
  </div>
}
