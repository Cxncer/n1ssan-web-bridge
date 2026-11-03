import { useEffect, useMemo, useRef, useState } from 'react'
import {
  fromArmoryDocument,
  toArmoryDocument,
  type ObsidianInventoryItem,
  type ObsidianInventoryProfile,
} from '../armory/obsidian-adapter'
import { migrateLegacyInventory } from '../armory/migrate-legacy'
import skinData from '../skins.json'
import knifeData from './knife-skins.json'
import './obsidian.css'

type ItemKind = 'skin' | 'sticker' | 'charm'
type Skin = { id: number | string; weapon: string; name: string; type: string; rarity: string; color: string; art: string; description: string; image?: string; minFloat?: number | null; maxFloat?: number | null; kind?: ItemKind; phase?: string; patternId?: string; paintIndex?: string; legacyOnly?: boolean }
type InventoryItem = ObsidianInventoryItem
type InventoryProfile = ObsidianInventoryProfile
const catalogue = skinData as Skin[]
const makeId = () => `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
const normalizeItem = (item: InventoryItem): InventoryItem => ({ ...item, kind: item.kind ?? 'skin', quantity: Math.max(1, Number(item.quantity) || 1), float: item.float ?? '', seed: item.seed ?? '', stattrak: item.stattrak ?? false, stattrakKills: item.stattrakKills ?? 0, customName: item.customName ?? '' })
const normalizeItems = (items: InventoryItem[]) => { const normalized = items.map(normalizeItem), merged: InventoryItem[] = []; for (const item of normalized) { if (item.kind === 'skin') { merged.push(item); continue } const existing = merged.find(x => x.kind === item.kind && String(x.definitionId) === String(item.definitionId)); if (existing) existing.quantity = (existing.quantity ?? 1) + (item.quantity ?? 1); else merged.push(item) } return merged }
const profileId = () => `profile-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
const getCategory = (skin: Skin) => {
  const type = (skin.type || '').toLowerCase(), weapon = (skin.weapon || '').toLowerCase()
  if (type.includes('sticker')) return 'Stickers'
  if (type.includes('charm') || type.includes('keychain')) return 'Charms'
  if (type.includes('glove') || weapon.includes('glove')) return 'Gloves'
  if (type.includes('knife') || type.includes('kniv') || type.includes('melee') || weapon.includes('knife') || weapon.includes('karambit') || weapon.includes('bayonet') || weapon.includes('dagger')) return 'Knives'
  if (type.includes('agent')) return 'Agents'
  if (type.includes('sniper') || ['awp', 'ssg 08', 'g3sg1', 'scar-20'].includes(weapon)) return 'Snipers'
  if (type.includes('pistol') || ['glock-18','usp-s','p2000','p250','tec-9','five-seven','cz75-auto','desert eagle','r8 revolver','dual berettas'].includes(weapon)) return 'Pistols'
  if (type.includes('smg') || type.includes('machine gun') || type.includes('shotgun') || ['mac-10','mp7','mp5-sd','mp9','ump-45','p90','pp-bizon','nova','xm1014','mag-7','sawed-off','m249','negev'].includes(weapon)) return 'Mid-Tier'
  if (type.includes('rifle') || ['ak-47','m4a4','m4a1-s','famas','galil ar','aug','sg 553'].includes(weapon)) return 'Rifles'
  return 'Other'
}
const knifeCatalogue = knifeData as Skin[]
const legacyKnifeCatalogue = catalogue.filter(s => getCategory(s) === 'Knives').map(s => ({ ...s, legacyOnly: true }))
const skinCatalogue = [...catalogue.filter(s => getCategory(s) !== 'Knives'), ...knifeCatalogue]
const rarityClass = (value: string) => value.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '')
const isAgent = (skin: Skin) => getCategory(skin) === 'Agents'
const rarityRank = (value: string) => ({ 'Consumer Grade':1,'Base Grade':1,'Industrial Grade':2,'High Grade':2,'Mil-Spec Grade':3,'Remarkable':3,'Restricted':4,'Exotic':4,'Classified':5,'Extraordinary':5,'Covert':6,'Master':6,'Contraband':7 } as Record<string,number>)[value] ?? 0
const STORAGE_KEY = 'n1ssan-obsidian-preview-v1'

export default function ObsidianApp() {
  const [profiles, setProfiles] = useState<InventoryProfile[]>([])
  const [activeId, setActiveId] = useState('')
  const [items, setItems] = useState<InventoryItem[]>([])
  const [booting, setBooting] = useState(true)
  const [armoryError, setArmoryError] = useState('')
  const [armoryStatus, setArmoryStatus] = useState<'connecting' | 'connected'>('connecting')
  const revisionRef = useRef(0)
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const saveTimerRef = useRef<number | null>(null)
  const writeBlockedRef = useRef(false)
  const [category, setCategory] = useState('All items')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('Recently Added')
  const [dialog, setDialog] = useState<'add' | 'detail' | 'profiles' | 'diagnostics' | 'customize' | 'quantity' | null>(null)
  const [page, setPage] = useState<'home' | 'inventory'>('home')
  const [pendingSkin, setPendingSkin] = useState<Skin | null>(null)
  const [pendingQuantity, setPendingQuantity] = useState(1)
  const [pendingFloat, setPendingFloat] = useState('0.00000')
  const [pendingSeed, setPendingSeed] = useState('1')
  const [pendingStatTrak, setPendingStatTrak] = useState(false)
  const [pendingName, setPendingName] = useState('')
  const [selectedInstance, setSelectedInstance] = useState<string | null>(null)
  const [catalogueSearch, setCatalogueSearch] = useState('')
  const [profileName, setProfileName] = useState('')
  const [notice, setNotice] = useState('')
  const [specialItems, setSpecialItems] = useState<Skin[]>([])
  const [addCategory, setAddCategory] = useState<ItemKind>('skin')
  const [specialLoading, setSpecialLoading] = useState(false)
  const [specialError, setSpecialError] = useState('')

  const allCatalogue = useMemo(() => [...skinCatalogue, ...legacyKnifeCatalogue, ...specialItems], [specialItems])
  const owned = useMemo(() => items.map(item => ({ item, skin: allCatalogue.find(s => String(s.id) === String(item.definitionId) && (s.kind ?? 'skin') === (item.kind ?? 'skin')) })).filter((x): x is { item: InventoryItem; skin: Skin } => !!x.skin), [items, allCatalogue])
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const result = owned.filter(({ skin }) => (!q || `${skin.weapon} ${skin.name} ${skin.rarity}`.toLowerCase().includes(q)) && (category === 'All items' || getCategory(skin) === category))
    if (sort === 'Recently Added') result.reverse()
    if (sort === 'Name A–Z') result.sort((a,b) => a.skin.weapon.localeCompare(b.skin.weapon) || a.skin.name.localeCompare(b.skin.name))
    if (sort === 'Float: Lowest') result.sort((a,b) => Number(a.item.float) - Number(b.item.float))
    if (sort === 'Rarity: Highest') result.sort((a,b) => { const categoryRank = (skin: Skin) => getCategory(skin) === 'Knives' ? 3 : getCategory(skin) === 'Gloves' ? 2 : 1; return categoryRank(b.skin) - categoryRank(a.skin) || rarityRank(b.skin.rarity) - rarityRank(a.skin.rarity) || a.skin.name.localeCompare(b.skin.name) })
    return result
  }, [owned, search, category, sort])
  const selected = owned.find(x => x.item.instanceId === selectedInstance)
  const searching = search.trim().length > 0
  const counts = ['Rifles','Pistols','Knives','Gloves','Agents','Stickers','Charms'].map(label => ({ label, count: owned.filter(x => getCategory(x.skin) === label).reduce((n,x) => n + (x.item.quantity ?? 1), 0) }))
  const totalUnits = items.reduce((n,item) => n + (item.quantity ?? 1), 0)
  const applyArmoryDocument = (document: Parameters<typeof fromArmoryDocument>[0]) => {
    const view = fromArmoryDocument(document)
    const nextProfiles = view.profiles.map(profile => ({
      ...profile,
      items: normalizeItems(profile.items),
    }))
    const active = nextProfiles.find(profile => profile.id === view.activeId) ?? nextProfiles[0]
    revisionRef.current = document.revision
    setProfiles(nextProfiles)
    setActiveId(active.id)
    setItems(active.items.map(item => ({ ...item })))
  }

  const persistSnapshot = (nextProfiles: InventoryProfile[], nextActiveId: string) => {
    if (writeBlockedRef.current) return
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    const snapshot = nextProfiles.map(profile => ({
      ...profile,
      items: profile.items.map(item => ({ ...item })),
    }))

    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      saveQueueRef.current = saveQueueRef.current.then(async () => {
        if (writeBlockedRef.current) return
        const document = toArmoryDocument(snapshot, nextActiveId, revisionRef.current)
        const response = await fetch('http://127.0.0.1:3210/armory', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expectedRevision: revisionRef.current, data: document }),
        })
        if (response.status === 409) {
          writeBlockedRef.current = true
          throw new Error('Armory was changed by another session. Refresh Obsidian to load the latest inventory before continuing.')
        }
        if (!response.ok) {
          const payload = await response.json().catch(() => null)
          throw new Error(payload?.error?.message ?? `Armory save failed (HTTP ${response.status}).`)
        }
        const payload = await response.json()
        revisionRef.current = payload.data.revision
      }).catch(error => {
        writeBlockedRef.current = true
        setArmoryError(error instanceof Error ? error.message : 'Armory could not save your changes.')
      })
    }, 250)
  }

  const updateItems = (next: InventoryItem[]) => {
    const updatedAt = new Date().toISOString()
    const nextProfiles = profiles.map(profile => profile.id === activeId
      ? { ...profile, items: next, updatedAt }
      : profile)
    setItems(next)
    setProfiles(nextProfiles)
    persistSnapshot(nextProfiles, activeId)
  }
  const switchProfile = (id: string) => {
    const next = profiles.find(profile => profile.id === id)
    if (!next) return
    setActiveId(id)
    setItems(next.items.map(item => ({ ...item })))
    persistSnapshot(profiles, id)
    setNotice(`Loaded “${next.name}”`)
  }
  const saveProfile = () => {
    const name = profileName.trim()
    if (!name) return
    const now = new Date().toISOString()
    const next = {
      id: profileId(),
      name,
      items: items.map(item => ({ ...item, instanceId: makeId() })),
      createdAt: now,
      updatedAt: now,
    }
    const nextProfiles = [...profiles, next]
    setProfiles(nextProfiles)
    setActiveId(next.id)
    setItems(next.items)
    persistSnapshot(nextProfiles, next.id)
    setProfileName('')
    setNotice('Inventory snapshot saved')
  }
  const deleteProfile = (id: string) => {
    if (profiles.length < 2) { setNotice('Keep at least one inventory profile'); return }
    const nextProfiles = profiles.filter(profile => profile.id !== id)
    const nextActiveId = id === activeId ? nextProfiles[0].id : activeId
    setProfiles(nextProfiles)
    if (id === activeId) {
      setActiveId(nextActiveId)
      setItems(nextProfiles[0].items.map(item => ({ ...item })))
    }
    persistSnapshot(nextProfiles, nextActiveId)
  }
  const addSkin = (skin: Skin, quantity = 1, custom?: { float: string; seed: string; stattrak: boolean; customName: string }) => {
    const kind = skin.kind ?? 'skin'
    if (kind !== 'skin') { const existing = items.find(item => item.kind === kind && String(item.definitionId) === String(skin.id)); const next = existing ? items.map(item => item.instanceId === existing.instanceId ? { ...item, quantity: (item.quantity ?? 1) + quantity } : item) : [...items, { instanceId: makeId(), definitionId: skin.id, kind, quantity, float: '', seed: '', stattrak: false, customName: '' }]; updateItems(next) }
    else updateItems([...items, { instanceId: makeId(), definitionId: skin.id, kind, quantity: 1, float: custom?.float ?? '', seed: custom?.seed ?? '', stattrak: custom?.stattrak ?? false, customName: custom?.customName ?? '' }])
    setDialog(null); setPendingSkin(null); setNotice(`${skin.weapon} · ${skin.name}${kind === 'skin' ? '' : ` ×${quantity}`} added to inventory`)
  }
  const chooseCatalogueItem = (skin: Skin) => { const kind = skin.kind ?? 'skin'; if (kind !== 'skin') { setPendingSkin(skin); setPendingQuantity(1); setDialog('quantity'); return } if (isAgent(skin)) { addSkin(skin); return } setPendingSkin(skin); setPendingFloat(Number(skin.minFloat ?? 0).toFixed(5)); setPendingSeed('1'); setPendingStatTrak(false); setPendingName(''); setDialog('customize') }
  const removeInventoryItem = (item: InventoryItem) => { updateItems(items.filter(x => x.instanceId !== item.instanceId)); setNotice('Item removed from inventory') }
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
    let cancelled = false
    setSpecialLoading(true)
    Promise.all([
      fetch('https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/stickers.json').then(r => { if (!r.ok) throw new Error('Sticker catalogue unavailable'); return r.json() }),
      fetch('https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/keychains.json').then(r => { if (!r.ok) throw new Error('Charm catalogue unavailable'); return r.json() })
    ]).then(([stickers, charms]) => {
      if (cancelled) return
      const mapItems = (entries: any[], kind: 'sticker' | 'charm'): Skin[] => entries.map(entry => ({
        id: `${kind}:${entry.id}`, kind, weapon: kind === 'sticker' ? 'Sticker' : 'Charm',
        name: String(entry.name ?? '').replace(/^(Sticker|Charm)\\s*\\|\\s*/i, ''),
        type: kind === 'sticker' ? 'Stickers' : 'Charms', rarity: entry.rarity?.name ?? 'Unknown Grade',
        color: entry.rarity?.color ?? '#8c9b90', art: kind === 'sticker' ? 'ST' : 'CH',
        description: entry.description ?? '', image: entry.image
      }))
      setSpecialItems([...mapItems(stickers, 'sticker'), ...mapItems(charms, 'charm')])
      setSpecialError('')
    }).catch(() => { if (!cancelled) setSpecialError('Sticker and charm catalogues could not be reached. Check your connection and retry.') })
      .finally(() => { if (!cancelled) setSpecialLoading(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false

    const connect = async () => {
      try {
        const response = await fetch('http://127.0.0.1:3210/armory')
        if (!response.ok) throw new Error(`Bridge returned HTTP ${response.status}`)
        let document = (await response.json()).data

        const isPristine = document.revision === 0 &&
          document.profiles.length === 1 &&
          document.profiles[0].items.length === 0

        if (isPristine) {
          const legacy = window.localStorage.getItem(STORAGE_KEY)
          if (legacy) {
            try {
              const parsed: unknown = JSON.parse(legacy)
              if (Array.isArray(parsed) && parsed.length > 0) {
                const migrated = migrateLegacyInventory(
                  parsed,
                  window.localStorage.getItem(`${STORAGE_KEY}:active`),
                )
                const migrationResponse = await fetch('http://127.0.0.1:3210/armory', {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ expectedRevision: document.revision, data: migrated }),
                })
                if (migrationResponse.status === 409) {
                  const latest = await fetch('http://127.0.0.1:3210/armory')
                  if (!latest.ok) throw new Error('Could not reload Armory after a migration conflict.')
                  document = (await latest.json()).data
                } else {
                  if (!migrationResponse.ok) throw new Error('Existing Obsidian inventory could not be migrated.')
                  document = (await migrationResponse.json()).data
                  window.localStorage.setItem(`${STORAGE_KEY}:armory-migrated`, new Date().toISOString())
                }
              }
            } catch (migrationError) {
              if (migrationError instanceof SyntaxError) {
                console.warn('Legacy Obsidian inventory was not valid JSON; leaving it untouched.')
              } else {
                throw migrationError
              }
            }
          }
        }

        if (cancelled) return
        applyArmoryDocument(document)
        setArmoryStatus('connected')
        setBooting(false)
      } catch (error) {
        if (cancelled) return
        setArmoryError(error instanceof Error ? error.message : 'Could not connect to the n1ssan Bridge.')
        setBooting(false)
      }
    }

    void connect()
    return () => { cancelled = true }
  }, [])

  useEffect(() => () => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
  }, [])

  const candidates = useMemo(() => {
    const q = catalogueSearch.trim().toLowerCase()
    return allCatalogue.filter(s => !s.legacyOnly && (s.kind ?? 'skin') === addCategory && (!q || `${s.weapon} ${s.name} ${s.type} ${s.rarity}`.toLowerCase().includes(q))).slice(0, 100)
  }, [allCatalogue, catalogueSearch, addCategory])

  if (booting) return <div className="ob-boot-screen"><span className="ob-mark">n.</span><strong>CONNECTING TO ARMORY</strong><small>Establishing a local Bridge session…</small></div>
  if (armoryError) return <div className="ob-boot-screen ob-boot-error"><span className="ob-mark">n.</span><strong>ARMORY CONNECTION INTERRUPTED</strong><small>{armoryError}</small><button className="ob-button shimmer-button" onClick={() => window.location.reload()}>Retry connection</button></div>

  return <div className="obsidian-shell">
    <header className="ob-topbar">
      <a className="ob-brand" href="#home" onClick={e => { e.preventDefault(); setPage('home') }} aria-label="n1ssan Obsidian"><span className="ob-mark">n.</span><span>n1ssan</span><i /> <small>OBSIDIAN</small></a>
      <nav className="ob-nav"><button className={page === 'home' ? 'active' : ''} onClick={() => setPage('home')}>Home</button><button className={page === 'inventory' ? 'active' : ''} onClick={() => setPage('inventory')}>Inventory</button><button onClick={() => setDialog('diagnostics')}>Diagnostics <span className="nav-count">01</span></button></nav>
      <div className="ob-top-right"><span className="armory-status-dot" /><span className="armory-status-text">{armoryStatus === 'connected' ? 'ARMORY CONNECTED' : 'ARMORY CONNECTING'}</span><span className="cs2-status-dot" /><span className="cs2-status-text">CS2 NOT DETECTED</span></div>
    </header>

    <main className={`ob-main ${page === 'home' ? 'home-mode' : ''}`} id={page}>
      {page === 'home' ? <>
        <div className="ob-breadcrumb"><span>OBSIDIAN</span><b>/</b><strong>COMMAND CENTER</strong></div>
        <section className="home-hero"><div className="home-hero-copy"><div className="ob-kicker">YOUR COLLECTION, YOUR RULES</div><h1>Welcome to<br/><span>your armory.</span></h1><p>One place for every finish, charm and sticker in your collection. Build your inventory, save complete setups, and keep your CS2 collection in order.</p><div className="home-actions"><button className="ob-button shimmer-button" onClick={() => setPage('inventory')}>Open inventory <span>↗</span></button><button className="home-secondary" onClick={() => setDialog('profiles')}>Manage profiles</button></div></div><div className="home-hero-art"><div className="hero-orbit orbit-one"/><div className="hero-orbit orbit-two"/><div className="hero-emblem">n<span>.</span></div><div className="hero-coordinate">N1 / OBSIDIAN<br/>COLLECTION SYSTEM</div></div></section>
        <section className="home-metrics"><div><small>ITEMS IN INVENTORY</small><strong>{totalUnits.toString().padStart(2,'0')}</strong><span>Across all item types</span></div><div><small>SAVED PROFILES</small><strong>{profiles.length.toString().padStart(2,'0')}</strong><span>Complete snapshots</span></div><div><small>ACTIVE PROFILE</small><strong className="home-profile-name">{profiles.find(p => p.id === activeId)?.name ?? 'Main inventory'}</strong><span>Ready to edit</span></div></section>
        <section className="home-lower"><div className="home-panel"><div className="ob-kicker">QUICK ACCESS</div><h2>Pick up where<br/>you left off.</h2><button onClick={() => setPage('inventory')}>Go to inventory <span>↗</span></button></div><div className="home-panel home-panel-muted"><div className="ob-kicker">BUILT FOR COUNTER-STRIKE 2</div><h2>Import here.<br/><span>Equip in-game.</span></h2><p>Stickers and charms live in your inventory here. Apply them to your weapons directly inside CS2.</p></div></section>
      </> : <>
      <div className="ob-breadcrumb"><span>WORKSPACE</span><b>/</b><strong>INVENTORY</strong></div>
      <section className="ob-heading">
        <div><h1>Your Armory<span>.</span></h1><p>Every finish, in its place. Curate your collection and keep each version close.</p></div>
        <div className="ob-heading-actions"><label className="profile-select-label">ACTIVE INVENTORY PROFILE<select value={activeId} onChange={e => switchProfile(e.target.value)}>{profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><button className="ob-button shimmer-button" onClick={() => setDialog('profiles')}>Manage profiles <span>↗</span></button></div>
      </section>

      <section className="ob-overview">
        <div className="overview-total"><span className="metric-label">ITEMS IN INVENTORY</span><strong>{String(totalUnits).padStart(2,'0')}</strong><small>Across your collection</small></div>
        {counts.map(c => <div className="overview-stat" key={c.label}><strong className={`quantity quantity-${c.label.toLowerCase()}`}>{String(c.count).padStart(2,'0')}</strong><small>{c.label.toUpperCase()}</small></div>)}
        
      </section>

      <section className="ob-inventory-section">
        <div className="ob-section-head"><div><h2>Inventory <span>Overview</span></h2></div><div className="ob-section-meta"><span className="live-dot" /> {visible.length} ITEMS DISPLAYED</div></div>
        <div className="ob-toolbar"><label className="ob-search"><span>⌕</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search your inventory..." /><kbd>⌘ K</kbd></label><div className="ob-sort"><span>SORT BY</span><select value={sort} onChange={e => setSort(e.target.value)}><option>Recently Added</option><option>Name A–Z</option><option>Float: Lowest</option><option>Rarity: Highest</option></select></div><button className="ob-button shimmer-button add-item-button" onClick={() => { setCatalogueSearch(''); setAddCategory('skin'); setDialog('add') }}><span>＋</span> Add item</button></div>
        <div className="ob-filters">{['All items','Rifles','Pistols','Mid-Tier','Snipers','Knives','Gloves','Agents','Stickers','Charms'].map(c => <button key={c} className={category === c ? 'selected' : ''} onClick={() => setCategory(c)}>{c}<small>{c === 'All items' ? totalUnits : owned.filter(x => getCategory(x.skin) === c).reduce((n,x) => n + (x.item.quantity ?? 1), 0)}</small></button>)}</div>

        {visible.length ? <div className={`ob-item-grid ${searching ? 'search-active' : ''}`}>{visible.map(({ item, skin }) => <div role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedInstance(item.instanceId); setDialog('detail') } }} className={`ob-item-card rarity-card-${rarityClass(skin.rarity)} item-category-${getCategory(skin).toLowerCase()}`} key={item.instanceId} onClick={() => { setSelectedInstance(item.instanceId); setDialog('detail') }}><button className="item-remove-x" aria-label={`Remove ${skin.name}`} title="Remove item" onClick={e => { e.stopPropagation(); removeInventoryItem(item) }}>×</button>
          <div className={`ob-item-art rarity-${rarityClass(skin.rarity)}`}><span className="item-glow" />{skin.image ? <img src={skin.image} alt="" loading="lazy" /> : <span className="item-fallback">{skin.art}</span>}<span className="item-rarity">{skin.rarity}</span></div>
          <div className="ob-item-copy"><div className="ob-item-weapon">{skin.weapon}{(item.kind ?? 'skin') === 'skin' && getCategory(skin) !== 'Gloves' && item.stattrak && <span className="stattrak">ST™</span>}</div>{(item.kind ?? 'skin') === 'skin' && item.customName.trim() && <span className="item-display-name">{item.customName}</span>}<strong>{skin.name}</strong><div className="ob-item-foot">{(item.kind ?? 'skin') === 'skin' && !isAgent(skin) ? <><span>FLOAT <b>{item.float}</b></span><span>SEED <b>{item.seed}</b></span><span className="float-wear">{Number(item.float) <= 0.07 ? 'FN' : Number(item.float) <= 0.15 ? 'MW' : Number(item.float) <= 0.38 ? 'FT' : Number(item.float) <= 0.45 ? 'WW' : 'BS'}</span></> : (item.kind !== 'skin' && (item.quantity ?? 1) > 1) ? <span className="stack-count">×{item.quantity}</span> : null}</div></div><span className="item-open">↗</span>
        </div>)}</div> : <div className="ob-empty"><span>⌕</span><h3>Nothing in this view</h3><p>Try another filter or add an item from the catalogue.</p><button className="ob-button shimmer-button" onClick={() => { setCategory('All items'); setSearch('') }}>Clear filters</button></div>}
      </section>
      <footer className="ob-footer"><span>n1ssan <b>/</b> OBSIDIAN</span><span>{'INVENTORY WORKSPACE'} <i /> PREVIEW BUILD</span><span>COUNTER-STRIKE 2</span></footer>
      </>}
    </main>

    {notice && <div className="ob-notification-stack" role="status" aria-live="polite"><div className="ob-notification-icon">✓</div><div className="ob-notification-copy"><strong>Inventory updated</strong><span>{notice}</span></div><button aria-label="Dismiss notification" onClick={() => setNotice('')}>×</button><i className="ob-notification-timer" /></div>}

    {dialog && <div className="ob-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setDialog(null) }}>
      {dialog === 'add' && <section className="ob-dialog ob-add-dialog"><div className="dialog-head"><div><div className="ob-kicker">CATALOGUE</div><h2>Add to <span>inventory.</span></h2><p>Import items into your inventory. Stickers and charms are applied to weapons inside CS2.</p></div><button className="dialog-close" onClick={() => setDialog(null)}>×</button></div><div className="add-category-tabs">{([{id:'skin',label:'Weapon skins'},{id:'sticker',label:'Stickers'},{id:'charm',label:'Charms'}] as const).map(tab => <button key={tab.id} className={addCategory === tab.id ? 'active' : ''} onClick={() => { setAddCategory(tab.id); setCatalogueSearch('') }}>{tab.label}<small>{tab.id === 'skin' ? skinCatalogue.length : specialItems.filter(item => item.kind === tab.id).length}</small></button>)}</div><label className="ob-search dialog-search"><span>⌕</span><input autoFocus value={catalogueSearch} onChange={e => setCatalogueSearch(e.target.value)} placeholder={addCategory === 'skin' ? 'Search weapons, finishes...' : addCategory === 'sticker' ? 'Search stickers, teams, tournaments...' : 'Search charms...'} /></label><div className="ob-catalogue-list">{specialLoading && addCategory !== 'skin' ? <div className="catalogue-state">Loading {addCategory} catalogue…</div> : specialError && addCategory !== 'skin' && !specialItems.some(item => item.kind === addCategory) ? <div className="catalogue-state">{specialError}</div> : candidates.length ? candidates.map(s => <button key={s.id} onClick={() => chooseCatalogueItem(s)}><div className="catalogue-thumb">{s.image && <img src={s.image} alt="" loading="lazy" />}</div><span><strong>{s.weapon}</strong><small>{s.name} · {s.rarity}</small></span><b>＋</b></button>) : <div className="catalogue-state">No matching items found.</div>}</div><div className="dialog-foot">{addCategory === 'skin' ? 'Weapon skins are imported as individual inventory instances.' : 'Imported into inventory only · Apply to weapons directly inside CS2.'}</div></section>}
      {dialog === 'customize' && pendingSkin && <section className="ob-dialog ob-customize-dialog"><div className="dialog-head"><div><div className="ob-kicker">NEW INVENTORY INSTANCE</div><h2>Configure <span>item.</span></h2><p>Set the finish details before importing it into your armory.</p></div><button className="dialog-close" onClick={() => setDialog('add')}>×</button></div><div className="detail-preview"><div className="detail-preview-art">{pendingSkin.image && <img src={pendingSkin.image} alt=""/>}</div><div><small>{pendingSkin.weapon}</small><h3>{pendingSkin.name}</h3><span>{pendingSkin.rarity} · {getCategory(pendingSkin)}</span></div></div><div className="ob-fields customize-fields"><label className="field-wide float-field">FLOAT VALUE <div className="float-slider-wrap"><div className="float-slider-value"><span>{Number(pendingFloat).toFixed(5)}</span><b>{Number(pendingFloat) <= 0.07 ? 'FN' : Number(pendingFloat) <= 0.15 ? 'MW' : Number(pendingFloat) <= 0.38 ? 'FT' : Number(pendingFloat) <= 0.45 ? 'WW' : 'BS'}</b></div><input className="float-slider" type="range" min={pendingSkin.minFloat ?? 0} max={pendingSkin.maxFloat ?? 1} step="0.00001" value={Math.min(pendingSkin.maxFloat ?? 1, Math.max(pendingSkin.minFloat ?? 0, Number(pendingFloat) || 0))} style={{ background: `linear-gradient(90deg, ${Number(pendingFloat) <= 0.07 ? '#65a9e8' : Number(pendingFloat) <= 0.15 ? '#62b987' : Number(pendingFloat) <= 0.38 ? '#b6bd55' : Number(pendingFloat) <= 0.45 ? '#d99a48' : '#d65d5d'} 0%, ${Number(pendingFloat) <= 0.07 ? '#65a9e8' : Number(pendingFloat) <= 0.15 ? '#62b987' : Number(pendingFloat) <= 0.38 ? '#b6bd55' : Number(pendingFloat) <= 0.45 ? '#d99a48' : '#d65d5d'} ${((Number(pendingFloat) - (pendingSkin.minFloat ?? 0)) / ((pendingSkin.maxFloat ?? 1) - (pendingSkin.minFloat ?? 0) || 1)) * 100}%, #303030 ${((Number(pendingFloat) - (pendingSkin.minFloat ?? 0)) / ((pendingSkin.maxFloat ?? 1) - (pendingSkin.minFloat ?? 0) || 1)) * 100}%, #303030 100%)` }} onChange={e => setPendingFloat(Number(e.target.value).toFixed(5))}/><div className="slider-marks"><span>{(pendingSkin.minFloat ?? 0).toFixed(2)}</span><span>{((pendingSkin.minFloat ?? 0) + ((pendingSkin.maxFloat ?? 1) - (pendingSkin.minFloat ?? 0)) * 0.25).toFixed(2)}</span><span>{((pendingSkin.minFloat ?? 0) + ((pendingSkin.maxFloat ?? 1) - (pendingSkin.minFloat ?? 0)) * 0.5).toFixed(2)}</span><span>{((pendingSkin.minFloat ?? 0) + ((pendingSkin.maxFloat ?? 1) - (pendingSkin.minFloat ?? 0)) * 0.75).toFixed(2)}</span><span>{(pendingSkin.maxFloat ?? 1).toFixed(2)}</span></div></div><input className="custom-float-input" value={pendingFloat} onChange={e => setPendingFloat(e.target.value)} inputMode="decimal" placeholder="Custom float (0.00000–1.00000)"/></label><label>PAINT SEED<input value={pendingSeed} onChange={e => setPendingSeed(String(Math.min(1000, Number(e.target.value.replace(/[^0-9]/g,'')) || 0)))} inputMode="numeric" maxLength={4} placeholder="0–1000"/>{getCategory(pendingSkin) === 'Knives' && pendingSkin.name === 'Case Hardened' && <small className="seed-hint">Use a seed from 0–1000. Blue Gem is a Case Hardened pattern variant determined by the paint seed.</small>}</label>{getCategory(pendingSkin) !== 'Gloves' && <div className="field-label">STATTRAK™ <button type="button" className={`stattrak-toggle ${pendingStatTrak ? 'enabled' : ''}`} aria-pressed={pendingStatTrak} onClick={() => setPendingStatTrak(v => !v)}><span className="st-toggle-track"><i/></span></button></div>}<label className="field-wide">NAME TAG<input value={pendingName} onChange={e => setPendingName(e.target.value)} placeholder="Optional name tag..." maxLength={20}/></label></div><div className="dialog-actions"><button className="ob-button secondary" onClick={() => setDialog('add')}>Back to catalogue</button><button className="ob-button shimmer-button" onClick={() => { const min = pendingSkin.minFloat ?? 0, max = pendingSkin.maxFloat ?? 1, value = Number(pendingFloat); if (!Number.isFinite(value) || value < min || value > max) { setNotice(`Float must be between ${min.toFixed(5)} and ${max.toFixed(5)}`); return } addSkin(pendingSkin, 1, { float: value.toFixed(5), seed: pendingSeed, stattrak: getCategory(pendingSkin) !== 'Gloves' && pendingStatTrak, customName: pendingName.trim() }) }}>Add to inventory <span>＋</span></button></div></section>}
      {dialog === 'quantity' && pendingSkin && <section className="ob-dialog ob-quantity-dialog"><div className="dialog-head"><div><div className="ob-kicker">STACK QUANTITY</div><h2>Add <span>{pendingSkin.kind === 'charm' ? 'charm.' : 'stickers.'}</span></h2><p>How many copies would you like to import?</p></div><button className="dialog-close" onClick={() => setDialog('add')}>×</button></div><div className="quantity-item-preview"><div className="catalogue-thumb">{pendingSkin.image && <img src={pendingSkin.image} alt=""/>}</div><div><strong>{pendingSkin.name}</strong><small>{pendingSkin.rarity} · {pendingSkin.kind}</small></div></div><div className="quantity-control"><button onClick={() => setPendingQuantity(n => Math.max(1,n-1))} aria-label="Decrease quantity">−</button><input type="number" min="1" max="999" value={pendingQuantity} onChange={e => setPendingQuantity(Math.max(1,Math.min(999,Number(e.target.value)||1)))}/><button onClick={() => setPendingQuantity(n => Math.min(999,n+1))} aria-label="Increase quantity">＋</button></div><div className="dialog-actions"><button className="ob-button secondary" onClick={() => setDialog('add')}>Back</button><button className="ob-button shimmer-button" onClick={() => addSkin(pendingSkin,pendingQuantity)}>Add ×{pendingQuantity} to inventory</button></div></section>}
      {dialog === 'detail' && selected && <section className="ob-dialog ob-detail-dialog"><div className="dialog-head"><div><div className="ob-kicker">INVENTORY INSTANCE</div><h2>Item <span>details.</span></h2></div><button className="dialog-close" onClick={() => setDialog(null)}>×</button></div><div className="detail-preview"><div className="detail-preview-art">{selected.skin.image && <img src={selected.skin.image} alt="" />}</div><div><small>{selected.skin.weapon}</small><h3>{selected.skin.name}</h3><span>{selected.skin.rarity} · {getCategory(selected.skin)}</span></div></div><div className="ob-fields">{(selected.item.kind ?? 'skin') === 'skin' && !isAgent(selected.skin) && <><label>FLOAT VALUE<input value={selected.item.float} onChange={e => updateSelected({ float: e.target.value })} inputMode="decimal" /></label><label>PAINT SEED<input value={selected.item.seed} onChange={e => updateSelected({ seed: String(Math.min(1000, Number(e.target.value.replace(/[^0-9]/g,'')) || 0)) })} inputMode="numeric" maxLength={4} placeholder="0–1000" />{getCategory(selected.skin) === 'Knives' && selected.skin.name === 'Case Hardened' && <small className="seed-hint">Use a seed from 0–1000. Blue Gem is determined by the Case Hardened paint seed.</small>}</label></>}{(selected.item.kind ?? 'skin') === 'skin' && <label className="field-wide">CUSTOM NAME<input value={selected.item.customName} onChange={e => updateSelected({ customName: e.target.value })} placeholder="Name this item..." /></label>}{(selected.item.kind ?? 'skin') === 'skin' && !isAgent(selected.skin) && getCategory(selected.skin) !== 'Gloves' && <button type="button" className={`stattrak-toggle ${selected.item.stattrak ? 'enabled' : ''}`} aria-pressed={selected.item.stattrak} onClick={() => updateSelected({ stattrak: !selected.item.stattrak })}><span className="st-toggle-label">ST</span><span className="st-toggle-track"><i /></span></button>}</div>{(selected.item.kind ?? 'skin') !== 'skin' && <div className="imported-item-note">Imported quantity: <strong>×{selected.item.quantity ?? 1}</strong> · Apply this item directly inside CS2.</div>}<div className="dialog-actions"><button className="ob-button shimmer-button remove-item-button" onClick={removeSelected}>Remove item</button><button className="ob-button shimmer-button" onClick={() => setDialog(null)}>Done</button></div></section>}
      {dialog === 'profiles' && <section className="ob-dialog ob-profiles-dialog"><div className="dialog-head"><div><div className="ob-kicker">SAVED SNAPSHOTS</div><h2>Inventory <span>profiles.</span></h2><p>Each profile stores a complete inventory snapshot. Switching replaces the active inventory.</p></div><button className="dialog-close" onClick={() => setDialog(null)}>×</button></div><div className="profile-list">{profiles.map(p => <div className={p.id === activeId ? 'profile-row current' : 'profile-row'} key={p.id}><button className="profile-load" onClick={() => switchProfile(p.id)}><span className="profile-radio">{p.id === activeId && <i />}</span><span><strong>{p.name}</strong><small>{p.items.reduce((sum,item) => sum + (item.quantity ?? 1), 0)} items · Updated {new Date(p.updatedAt).toLocaleString()}</small></span></button><button className="profile-delete" title="Delete profile" onClick={() => deleteProfile(p.id)} disabled={profiles.length < 2}>×</button></div>)}</div><div className="new-profile"><label>NEW INVENTORY PROFILE<input value={profileName} onChange={e => setProfileName(e.target.value)} placeholder="e.g. Tournament setup" onKeyDown={e => { if (e.key === 'Enter') saveProfile() }} /></label><button className="ob-button shimmer-button" onClick={saveProfile} disabled={!profileName.trim()}>Save snapshot <span>＋</span></button></div><div className="dialog-foot">Unlimited local preview profiles · Switching restores the saved snapshot, not a merge</div></section>}
      {dialog === 'diagnostics' && <section className="ob-dialog ob-diagnostics-dialog"><div className="dialog-head"><div><div className="ob-kicker">SYSTEM HEALTH</div><h2>Diagnostics<span>.</span></h2><p>Runtime and compatibility checks for the CS2 integration.</p></div><button className="dialog-close" onClick={() => setDialog(null)}>×</button></div><div className="diagnostic-list"><div><span className="diagnostic-state pending" /><span><strong>CS2 process detection</strong><small>Not connected · preview cannot inspect local processes</small></span><b>WAITING</b></div><div><span className="diagnostic-state pending" /><span><strong>Bridge connection</strong><small>Armory inventory API is connected and persistent</small></span><b>ONLINE</b></div><div><span className="diagnostic-state pending" /><span><strong>Offsets &amp; signatures</strong><small>Version validation will report outdated definitions here</small></span><b>NOT CHECKED</b></div></div><div className="dialog-foot">Diagnostics UI preview · no process or signature checks are running yet</div></section>}
    </div>}
    <button className="ob-back-to-top" type="button" aria-label="Back to top" title="Back to top" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}><span>↑</span></button>
  </div>
}
