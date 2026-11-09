import { useEffect, useMemo, useRef, useState } from 'react'
import {
  fromArmoryDocument,
  toArmoryDocument,
  type ObsidianInventoryItem,
  type ObsidianInventoryProfile,
} from '../armory/obsidian-adapter'
import { migrateLegacyInventory } from '../armory/migrate-legacy'
import { ArmoryBridgeError, applyArmoryToGame, readArmoryDocument, writeArmoryDocument } from '../armory/bridge-client'
import { catalogueDefinitionId, toCatalogueDefinition } from '../armory/catalogue-identity'
import skinData from '../skins.json'
import knifeData from './knife-skins.json'
import './obsidian.css'
import rickshawImage from '../../assets/images/Rickshaw-clay.jpg'
import n1ssanLogo from '../../assets/icons/n1ssan-icon-white.png'
import LineSidebar from './LineSidebar'
import { ShimmerButton } from './ShimmerButton'
import ObsidianDropdown from './ObsidianDropdown'

type ItemKind = 'skin' | 'sticker' | 'charm'
type Skin = { id: number | string; weapon: string; name: string; type: string; rarity: string; color: string; art: string; description: string; image?: string; minFloat?: number | null; maxFloat?: number | null; kind?: ItemKind; phase?: string; patternId?: string; paintIndex?: string; paintKit?: number | string | null; gameDefinitionId?: number | null; stickerKitId?: number | null; keychainId?: number | null; legacyOnly?: boolean }
type InventoryItem = ObsidianInventoryItem
type InventoryProfile = ObsidianInventoryProfile
type BaseWeapon = { id: string; name: string; image?: string; category?: { name?: string }; def_index?: number }
const catalogue = skinData as Skin[]
const makeId = () => `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
const normalizeItem = (item: InventoryItem): InventoryItem => ({ ...item, kind: item.kind ?? 'skin', definitionId: catalogueDefinitionId(item.kind ?? 'skin', item.definitionId), quantity: Math.max(1, Number(item.quantity) || 1), float: item.float ?? '', seed: item.seed ?? '', stattrak: item.stattrak ?? false, stattrakKills: item.stattrakKills ?? 0, customName: item.customName ?? '' })
const normalizeItems = (items: InventoryItem[]) => { const normalized = items.map(normalizeItem), merged: InventoryItem[] = []; for (const item of normalized) { if (item.kind === 'skin') { merged.push(item); continue } const existing = merged.find(x => x.kind === item.kind && x.definitionId === item.definitionId); if (existing) existing.quantity = (existing.quantity ?? 1) + (item.quantity ?? 1); else merged.push(item) } return merged }
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
  useEffect(() => {
    const icon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]') ?? document.createElement('link')
    icon.rel = 'icon'
    icon.type = 'image/png'
    if (!icon.isConnected) document.head.appendChild(icon)

    const logo = new Image()
    logo.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = 64
      canvas.height = 64
      const context = canvas.getContext('2d')
      if (!context) {
        icon.href = n1ssanLogo
        return
      }
      context.clearRect(0, 0, 64, 64)
      context.drawImage(logo, 9, 9, 46, 46)
      icon.href = canvas.toDataURL('image/png')
    }
    logo.onerror = () => {
      icon.href = n1ssanLogo
    }
    logo.src = n1ssanLogo
  }, [])
  const [profiles, setProfiles] = useState<InventoryProfile[]>([])
  const [activeId, setActiveId] = useState('')
  const appliedIdRef = useRef('')
  const [items, setItems] = useState<InventoryItem[]>([])
  const [booting, setBooting] = useState(true)
  const [armoryError, setArmoryError] = useState('')
  const [armorySaveError, setArmorySaveError] = useState<{ message: string; conflict: boolean } | null>(null)
  const [armoryStatus, setArmoryStatus] = useState<'connecting' | 'connected'>('connecting')
  const [armoryApplying, setArmoryApplying] = useState(false)
  const revisionRef = useRef(0)
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const saveTimerRef = useRef<number | null>(null)
  const writeBlockedRef = useRef(false)
  const [category, setCategory] = useState('All items')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('Recently Added')
  const [dialog, setDialog] = useState<'add' | 'detail' | 'profiles' | 'diagnostics' | 'customize' | 'quantity' | null>(null)
  const [page, setPage] = useState<'home' | 'inventory'>('home')
  const [activeNavIndex, setActiveNavIndex] = useState(0)
  const [pendingSkin, setPendingSkin] = useState<Skin | null>(null)
  const [pendingQuantity, setPendingQuantity] = useState(1)
  const [pendingFloat, setPendingFloat] = useState('0.00000')
  const [pendingSeed, setPendingSeed] = useState('1')
  const [pendingStatTrak, setPendingStatTrak] = useState(false)
  const [pendingName, setPendingName] = useState('')
  const [selectedInstance, setSelectedInstance] = useState<string | null>(null)
  const [catalogueSearch, setCatalogueSearch] = useState('')
  const [profileName, setProfileName] = useState('')
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null)
  const [editingProfileName, setEditingProfileName] = useState('')
  const [notice, setNotice] = useState('')
  const [specialItems, setSpecialItems] = useState<Skin[]>([])
  const [baseWeapons, setBaseWeapons] = useState<BaseWeapon[]>([])
  const [baseWeaponsLoading, setBaseWeaponsLoading] = useState(true)
  const [skinPickerLevel, setSkinPickerLevel] = useState<'root' | 'models' | 'finishes'>('root')
  const [selectedSkinGroup, setSelectedSkinGroup] = useState<'weapons' | 'knives' | 'gloves'>('weapons')
  const [selectedSkinWeapon, setSelectedSkinWeapon] = useState('')
  const [addCategory, setAddCategory] = useState<ItemKind>('skin')
  const [specialLoading, setSpecialLoading] = useState(false)
  const [specialError, setSpecialError] = useState('')

  const allCatalogue = useMemo(() => [...skinCatalogue, ...legacyKnifeCatalogue, ...specialItems], [specialItems])
  const catalogueById = useMemo(() => new Map(allCatalogue.map(skin => [toCatalogueDefinition(skin).id, skin] as const)), [allCatalogue])
  const owned = useMemo(() => items.map(item => ({ item, skin: catalogueById.get(catalogueDefinitionId(item.kind ?? 'skin', item.definitionId)) })).filter((entry): entry is { item: InventoryItem; skin: Skin } => !!entry.skin), [items, catalogueById])
  const kitLabels = useMemo(() => {
    const labels = new Map<string, string>()
    for (const skin of specialItems) {
      if (skin.kind === 'sticker' && skin.stickerKitId) labels.set(`sticker:${skin.stickerKitId}`, skin.name)
      if (skin.kind === 'charm' && skin.keychainId) labels.set(`charm:${skin.keychainId}`, skin.name)
    }
    return labels
  }, [specialItems])
  const labelForKit = (kind: 'sticker' | 'charm', kitId: number) => kitLabels.get(`${kind}:${kitId}`) ?? `Kit ${kitId}`
  const imageForKit = (kind: 'sticker' | 'charm', kitId: number) => specialItems.find(skin =>
    kind === 'sticker'
      ? skin.kind === 'sticker' && skin.stickerKitId === kitId
      : skin.kind === 'charm' && skin.keychainId === kitId
  )?.image
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
    appliedIdRef.current = active.id
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
        const document = toArmoryDocument(snapshot, appliedIdRef.current || nextActiveId, revisionRef.current)
        const saved = await writeArmoryDocument(document, revisionRef.current)
        revisionRef.current = saved.revision
        setArmorySaveError(null)
      }).catch(error => {
        writeBlockedRef.current = true
        setArmorySaveError({
          message: error instanceof Error ? error.message : 'Armory could not save your changes.',
          conflict: error instanceof ArmoryBridgeError && error.status === 409,
        })
      })
    }, 250)
  }

  const flushArmorySave = async () => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null

      const snapshot = profiles.map(profile => ({
        ...profile,
        items: profile.items.map(item => ({ ...item })),
      }))

      saveQueueRef.current = saveQueueRef.current.then(async () => {
        if (writeBlockedRef.current) return
        const document = toArmoryDocument(snapshot, appliedIdRef.current || activeId, revisionRef.current)
        const saved = await writeArmoryDocument(document, revisionRef.current)
        revisionRef.current = saved.revision
        setArmorySaveError(null)
      }).catch(error => {
        writeBlockedRef.current = true
        setArmorySaveError({
          message: error instanceof Error ? error.message : 'Armory could not save your changes.',
          conflict: error instanceof ArmoryBridgeError && error.status === 409,
        })
      })
    }

    await saveQueueRef.current
    if (writeBlockedRef.current) {
      throw new Error('Armory changes could not be saved. Resolve the save warning before applying.')
    }
  }

  const applyArmory = async () => {
    if (armoryApplying || armorySaveError) return
    setArmoryApplying(true)
    try {
      // Flush the debounce queue first so the DLL receives the latest profile,
      // not the last snapshot that happened to finish saving.
      await flushArmorySave()
      // Commit the selected profile only when the user explicitly applies it.
      const selectedDocument = toArmoryDocument(profiles, activeId, revisionRef.current)
      const committed = await writeArmoryDocument(selectedDocument, revisionRef.current)
      revisionRef.current = committed.revision
      appliedIdRef.current = activeId
      const result = await applyArmoryToGame()
      const skipped = result.runtime.skipped
      setNotice(
        skipped > 0
          ? `Applied ${result.runtime.itemCount} Armory items to CS2; ${skipped} unsupported items were skipped.`
          : `Applied ${result.runtime.itemCount} Armory items to CS2.`,
      )
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Armory could not be applied to CS2.')
    } finally {
      setArmoryApplying(false)
    }
  }

  const updateItems = (next: InventoryItem[]) => {
    const updatedAt = new Date().toISOString()
    const timestampedItems = next.map(item => {
      const previous = items.find(existing => existing.instanceId === item.instanceId)
      const comparable = (value: InventoryItem) => JSON.stringify({
        ...value,
        createdAt: undefined,
        updatedAt: undefined,
      })
      const changed = !previous || comparable(previous) !== comparable(item)
      return {
        ...item,
        createdAt: item.createdAt ?? previous?.createdAt ?? updatedAt,
        updatedAt: changed ? updatedAt : item.updatedAt ?? previous?.updatedAt ?? updatedAt,
      }
    })
    const nextProfiles = profiles.map(profile => profile.id === activeId
      ? { ...profile, items: timestampedItems, updatedAt }
      : profile)
    setItems(timestampedItems)
    setProfiles(nextProfiles)
    persistSnapshot(nextProfiles, activeId)
  }
  const switchProfile = (id: string) => {
    const next = profiles.find(profile => profile.id === id)
    if (!next) return
    setActiveId(id)
    setItems(next.items.map(item => ({ ...item })))
    setNotice(`Selected “${next.name}” · click Apply to CS2 to import it`)
  }
  const saveProfile = () => {
    const name = profileName.trim()
    if (!name) return
    const now = new Date().toISOString()
    const next = {
      id: profileId(),
      name,
      items: items.map(item => ({ ...item, instanceId: makeId(), createdAt: now, updatedAt: now })),
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
  const beginRenameProfile = (profile: InventoryProfile) => {
    setEditingProfileId(profile.id)
    setEditingProfileName(profile.name)
  }
  const saveProfileRename = (id: string) => {
    const name = editingProfileName.trim()
    if (!name) return
    const nextProfiles = profiles.map(profile => profile.id === id
      ? { ...profile, name, updatedAt: new Date().toISOString() }
      : profile)
    setProfiles(nextProfiles)
    persistSnapshot(nextProfiles, activeId)
    setEditingProfileId(null)
    setEditingProfileName('')
    setNotice('Profile renamed')
  }
  const deleteProfile = (id: string) => {
    if (profiles.length < 2) { setNotice('Keep at least one inventory profile'); return }
    const nextProfiles = profiles.filter(profile => profile.id !== id)
    const nextActiveId = id === activeId ? nextProfiles[0].id : activeId
    if (id === appliedIdRef.current) appliedIdRef.current = nextProfiles[0].id
    setProfiles(nextProfiles)
    if (id === activeId) {
      setActiveId(nextActiveId)
      setItems(nextProfiles[0].items.map(item => ({ ...item })))
    }
    persistSnapshot(nextProfiles, nextActiveId)
  }
  const addSkin = (skin: Skin, quantity = 1, custom?: { float: string; seed: string; stattrak: boolean; customName: string }) => {
    const kind = skin.kind ?? 'skin'
    const definitionId = toCatalogueDefinition(skin).id
    if (kind !== 'skin') { const existing = items.find(item => item.kind === kind && item.definitionId === definitionId); const next = existing ? items.map(item => item.instanceId === existing.instanceId ? { ...item, quantity: (item.quantity ?? 1) + quantity } : item) : [...items, { instanceId: makeId(), definitionId, kind, quantity, float: '', seed: '', stattrak: false, customName: '' }]; updateItems(next) }
    else updateItems([...items, { instanceId: makeId(), definitionId, kind, quantity: 1, float: custom?.float ?? '', seed: custom?.seed ?? '', stattrak: custom?.stattrak ?? false, customName: custom?.customName ?? '' }])
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
    setBaseWeaponsLoading(true)
    fetch('https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/base_weapons.json')
      .then(response => { if (!response.ok) throw new Error('Base weapon catalogue unavailable'); return response.json() as Promise<BaseWeapon[]> })
      .then(entries => { if (!cancelled) setBaseWeapons(entries) })
      .catch(error => { if (!cancelled) console.warn('Base weapon previews could not be loaded:', error) })
      .finally(() => { if (!cancelled) setBaseWeaponsLoading(false) })
    return () => { cancelled = true }
  }, [])

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
        description: entry.description ?? '', image: entry.image,
        stickerKitId: kind === 'sticker' ? (/^\d+$/.test(String(entry.def_index ?? '')) ? Number(entry.def_index) : null) : null,
        keychainId: kind === 'charm' ? (/^\d+$/.test(String(entry.def_index ?? '')) ? Number(entry.def_index) : null) : null
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
        let document = await readArmoryDocument()

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
                try {
                  document = await writeArmoryDocument(migrated, document.revision)
                  window.localStorage.setItem(`${STORAGE_KEY}:armory-migrated`, new Date().toISOString())
                } catch (migrationError) {
                  if (migrationError instanceof ArmoryBridgeError && migrationError.status === 409) {
                    document = await readArmoryDocument()
                  } else {
                    throw migrationError
                  }
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

  const flushArmorySaveRef = useRef(flushArmorySave)
  flushArmorySaveRef.current = flushArmorySave

  useEffect(() => {
    const events = new EventSource('http://127.0.0.1:3210/armory/events')
    const onAttachmentsUpdated: EventListener = async (event: Event) => {
      try {
        await flushArmorySaveRef.current()
        const message = event as MessageEvent<string>
        const payload = JSON.parse(message.data) as { profileId?: string; merged?: number }
        const document = await readArmoryDocument()
        const profileId = typeof payload.profileId === 'string' ? payload.profileId : document.activeProfileId
        const incoming = fromArmoryDocument(document).profiles.find(profile => profile.id === profileId)
        if (!incoming) return
        const incomingById = new Map(incoming.items.map(item => [item.instanceId, item]))
        setProfiles(current => current.map(profile => profile.id !== profileId ? profile : {
          ...profile,
          items: profile.items.map(item => {
            const observed = incomingById.get(item.instanceId)
            return observed ? { ...item, attachments: observed.attachments, updatedAt: observed.updatedAt } : item
          }),
          updatedAt: incoming.updatedAt,
        }))
        if (activeId === profileId) {
          setItems(current => current.map(item => {
            const observed = incomingById.get(item.instanceId)
            return observed ? { ...item, attachments: observed.attachments, updatedAt: observed.updatedAt } : item
          }))
        }
        revisionRef.current = document.revision
        const count = Math.max(1, Number(payload.merged) || 1)
        setNotice(count + ' weapon attachment update' + (count === 1 ? '' : 's') + ' received from CS2')
      } catch (error) {
        console.warn('Live Armory attachment refresh deferred:', error)
      }
    }
    events.addEventListener('attachments-updated', onAttachmentsUpdated)
    return () => {
      events.removeEventListener('attachments-updated', onAttachmentsUpdated)
      events.close()
    }
  }, [activeId])

  useEffect(() => () => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
  }, [])

  const candidates = useMemo(() => {
    const q = catalogueSearch.trim().toLowerCase()
    return allCatalogue.filter(s => !s.legacyOnly && (s.kind ?? 'skin') === addCategory && (!q || `${s.weapon} ${s.name} ${s.type} ${s.rarity}`.toLowerCase().includes(q))).slice(0, 100)
  }, [allCatalogue, catalogueSearch, addCategory])

  const baseWeaponTiles = useMemo(() => {
    const supported = new Set(['Pistols', 'Rifles', 'SMGs', 'Heavy'])
    return baseWeapons
      .filter(weapon => supported.has(weapon.category?.name ?? ''))
      .filter(weapon => !catalogueSearch.trim() || weapon.name.toLowerCase().includes(catalogueSearch.trim().toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [baseWeapons, catalogueSearch])

  const knifeModelTiles = useMemo(() => {
    const models = new Map<string, Skin>()
    for (const skin of knifeCatalogue) if (!models.has(skin.weapon)) models.set(skin.weapon, skin)
    return [...models.values()]
      .filter(skin => !catalogueSearch.trim() || skin.weapon.toLowerCase().includes(catalogueSearch.trim().toLowerCase()))
      .sort((a, b) => a.weapon.localeCompare(b.weapon))
  }, [catalogueSearch])

  const gloveModelTiles = useMemo(() => {
    const models = new Map<string, Skin>()
    for (const skin of catalogue.filter(item => getCategory(item) === 'Gloves')) if (!models.has(skin.weapon)) models.set(skin.weapon, skin)
    return [...models.values()]
      .filter(skin => !catalogueSearch.trim() || skin.weapon.toLowerCase().includes(catalogueSearch.trim().toLowerCase()))
      .sort((a, b) => a.weapon.localeCompare(b.weapon))
  }, [catalogueSearch])

  const skinPickerCandidates = useMemo(() => {
    const source = selectedSkinGroup === 'knives'
      ? knifeCatalogue
      : selectedSkinGroup === 'gloves'
        ? catalogue.filter(skin => getCategory(skin) === 'Gloves')
        : skinCatalogue.filter(skin => getCategory(skin) !== 'Knives' && getCategory(skin) !== 'Gloves')
    const q = catalogueSearch.trim().toLowerCase()
    return source.filter(skin =>
      skin.weapon === selectedSkinWeapon &&
      (!q || `${skin.weapon} ${skin.name} ${skin.rarity}`.toLowerCase().includes(q))
    )
  }, [selectedSkinGroup, selectedSkinWeapon, catalogueSearch])

  if (booting) return <div className="ob-boot-screen"><span className="ob-mark">n.</span><strong>CONNECTING TO ARMORY</strong><small>Establishing a local Bridge session…</small></div>
  if (armoryError) return <div className="ob-boot-screen ob-boot-error"><span className="ob-mark">n.</span><strong>ARMORY CONNECTION INTERRUPTED</strong><small>{armoryError}</small><button className="ob-button shimmer-button" onClick={() => window.location.reload()}>Retry connection</button></div>

  return <div className="obsidian-shell obsidian-shell-redesign">
    <aside className="ob-line-sidebar" aria-label="Main navigation">
      <a className="ob-line-brand" href="#home" onClick={event => { event.preventDefault(); setPage('home'); setActiveNavIndex(0) }} aria-label="n1ssan Home">
        <img src={n1ssanLogo} alt="n1ssan" />
      </a>
      <LineSidebar
        key={activeNavIndex}
        className="ob-line-nav"
        items={['Home', 'Armory', 'Diagnostics']}
        accentColor="#a855f7"
        textColor="#a1a1aa"
        markerColor="#3f3f46"
        showIndex
        showMarker
        proximityRadius={100}
        maxShift={30}
        falloff="smooth"
        markerLength={60}
        markerGap={0}
        tickScale={0.5}
        scaleTick
        itemGap={20}
        fontSize={1.1}
        smoothing={100}
        defaultActive={activeNavIndex}
        onItemClick={index => {
          setActiveNavIndex(index)
          if (index === 0) setPage('home')
          if (index === 1) setPage('inventory')
          if (index === 2) setDialog('diagnostics')
        }}
      />
      <div className="ob-line-sidebar-foot"><span className="armory-status-dot" /><span>{armoryStatus === 'connected' && !armorySaveError ? 'CONNECTED' : armorySaveError ? 'SAVE BLOCKED' : 'CONNECTING'}</span></div>
    </aside>

    {armorySaveError && <div className="ob-armory-save-error" role="alert">
      <div><strong>{armorySaveError.conflict ? 'ARMORY REVISION CONFLICT' : 'ARMORY SAVE INTERRUPTED'}</strong><span>{armorySaveError.message}</span></div>
      {armorySaveError.conflict
        ? <button onClick={() => window.location.reload()}>Reload latest inventory</button>
        : <button onClick={() => { writeBlockedRef.current = false; setArmorySaveError(null); persistSnapshot(profiles, activeId) }}>Retry save</button>}
    </div>}

    <main className={`ob-main ${page === 'home' ? 'home-mode' : ''}`} id={page}>
      {page === 'home' ? <>
        <section
          className="ob-cinematic-home"
          onPointerMove={event => {
            if (event.pointerType !== 'mouse') return
            const bounds = event.currentTarget.getBoundingClientRect()
            const x = ((event.clientX - bounds.left) / bounds.width - 0.5) * 2
            const y = ((event.clientY - bounds.top) / bounds.height - 0.5) * 2
            const image = event.currentTarget.querySelector<HTMLImageElement>('.ob-rickshaw-stage img')
            image?.style.setProperty('--parallax-x', `${x * 16}px`)
            image?.style.setProperty('--parallax-y', `${y * 11}px`)
          }}
          onPointerLeave={event => {
            const image = event.currentTarget.querySelector<HTMLImageElement>('.ob-rickshaw-stage img')
            image?.style.setProperty('--parallax-x', '0px')
            image?.style.setProperty('--parallax-y', '0px')
          }}
        >
          <div className="ob-cinematic-copy">
            <div className="ob-cinematic-kicker"><span /> COUNTER-STRIKE 2 · PERSONAL ARMORY</div>
            <h1>Every CS2 skin.<br/><span>In a click.</span></h1>
            
            <ShimmerButton
              shimmerColor="#06b6d4"
              shimmerSize="0.08em"
              shimmerDuration="3s"
              borderRadius="9999px"
              background="#050508"
              onClick={() => { setPage('inventory'); setActiveNavIndex(1) }}
              className="ob-initiate-specular"
            >
              <span>Initiate</span><span aria-hidden="true" className="ob-initiate-arrow">↗</span>
            </ShimmerButton>
          </div>
          <div className="ob-rickshaw-stage" aria-hidden="true">
            <img src={rickshawImage} alt="" />
          </div>
          <div className="ob-home-index">N1 / ARMORY SYSTEM <span>—</span> 001</div>
        </section>
      </> : <>
      <div className="ob-breadcrumb"><span>WORKSPACE</span><b>/</b><strong>INVENTORY</strong></div>
      <section className="ob-heading">
        <div><h1>Your Armory<span>.</span></h1></div>
        <div className="ob-heading-actions"><div className="profile-select-label"><span>SELECTED INVENTORY PROFILE</span><ObsidianDropdown ariaLabel="Selected inventory profile" className="profile-dropdown" value={activeId} options={profiles.map(p => ({ value: p.id, label: p.name }))} onChange={switchProfile} /></div><button className="ob-button shimmer-button" onClick={() => setDialog('profiles')}>Manage profiles <span>↗</span></button><button className="ob-button shimmer-button" onClick={applyArmory} disabled={armoryApplying || !!armorySaveError || totalUnits === 0}>{armoryApplying ? 'Applying…' : 'Apply to CS2'} <span>↗</span></button></div>
      </section>

      <section className="ob-overview">
        <div className="overview-total"><span className="metric-label">ITEMS IN INVENTORY</span><strong>{String(totalUnits).padStart(2,'0')}</strong><small>Across your collection</small></div>
        {counts.map(c => <div className="overview-stat" key={c.label}><strong className={`quantity quantity-${c.label.toLowerCase()}`}>{String(c.count).padStart(2,'0')}</strong><small>{c.label.toUpperCase()}</small></div>)}
        
      </section>

      <section className="ob-inventory-section">
        <div className="ob-section-head"><div><h2>Inventory <span>Overview</span></h2></div><div className="ob-section-meta"><span className="live-dot" /> {visible.length} ITEMS DISPLAYED</div></div>
        <div className="ob-toolbar"><label className="ob-search"><span>⌕</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search your inventory..." /><kbd>⌘ K</kbd></label><div className="ob-sort"><span>SORT BY</span><ObsidianDropdown ariaLabel="Sort inventory" className="sort-dropdown" value={sort} options={[{ value: "Recently Added", label: "Recently Added" }, { value: "Name A–Z", label: "Name A–Z" }, { value: "Float: Lowest", label: "Float: Lowest" }, { value: "Rarity: Highest", label: "Rarity: Highest" }]} onChange={setSort} /></div><button className="ob-button shimmer-button add-item-button" onClick={() => { setCatalogueSearch(''); setAddCategory('skin'); setDialog('add') }}><span>＋</span> Add item</button></div>
        <div className="ob-filters">{['All items','Rifles','Pistols','Mid-Tier','Snipers','Knives','Gloves','Agents','Stickers','Charms'].map(c => <button key={c} className={category === c ? 'selected' : ''} onClick={() => setCategory(c)}>{c}<small>{c === 'All items' ? totalUnits : owned.filter(x => getCategory(x.skin) === c).reduce((n,x) => n + (x.item.quantity ?? 1), 0)}</small></button>)}</div>

        {visible.length ? <div className={`ob-item-grid ${searching ? 'search-active' : ''}`}>{visible.map(({ item, skin }) => <div role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedInstance(item.instanceId); setDialog('detail') } }} className={`ob-item-card rarity-card-${rarityClass(skin.rarity)} item-category-${getCategory(skin).toLowerCase()}`} key={item.instanceId} onClick={() => { setSelectedInstance(item.instanceId); setDialog('detail') }}><button className="item-remove-x" aria-label={`Remove ${skin.name}`} title="Remove item" onClick={e => { e.stopPropagation(); removeInventoryItem(item) }}>×</button>
          <div className={`ob-item-art rarity-${rarityClass(skin.rarity)}`}><span className="item-glow" />{skin.image ? <img src={skin.image} alt="" loading="lazy" /> : <span className="item-fallback">{skin.art}</span>}{(item.kind ?? 'skin') === 'skin' && item.customName.trim() && <span className="item-display-name item-display-name-overlay">{item.customName}</span>}<span className="item-rarity">{skin.rarity}</span>{((item.attachments?.stickers.length ?? 0) > 0 || item.attachments?.charm) && <div className="item-attachment-stack" aria-label="Attached stickers and charm">{(item.attachments?.stickers ?? []).slice(0, 5).map((sticker, index) => { const name = labelForKit('sticker', sticker.kitId); const image = imageForKit('sticker', sticker.kitId); return <span className="item-attachment-thumb sticker" key={`sticker-${sticker.slot}-${index}`} title={`Sticker: ${name}`}>{image ? <img src={image} alt={name} loading="lazy" /> : <i>ST</i>}</span> })}{item.attachments?.charm && (() => { const charm = item.attachments.charm; const name = labelForKit('charm', charm.kitId); const image = imageForKit('charm', charm.kitId); return <span className="item-attachment-thumb charm" title={`Charm: ${name}`}>{image ? <img src={image} alt={name} loading="lazy" /> : <i>CH</i>}</span> })()}</div>}</div>
          <div className="ob-item-copy"><div className="ob-item-weapon">{skin.weapon}{(item.kind ?? 'skin') === 'skin' && getCategory(skin) !== 'Gloves' && item.stattrak && <span className="stattrak">ST™</span>}</div><strong>{skin.name}</strong><div className="ob-item-foot">{(item.kind ?? 'skin') === 'skin' && !isAgent(skin) ? <><span>FLOAT <b>{item.float}</b></span><span>SEED <b>{item.seed}</b></span><span className="float-wear">{Number(item.float) <= 0.07 ? 'FN' : Number(item.float) <= 0.15 ? 'MW' : Number(item.float) <= 0.38 ? 'FT' : Number(item.float) <= 0.45 ? 'WW' : 'BS'}</span></> : (item.kind !== 'skin' && (item.quantity ?? 1) > 1) ? <span className="stack-count">×{item.quantity}</span> : null}</div></div><span className="item-open">↗</span>
        </div>)}</div> : <div className="ob-empty"><span>⌕</span><h3>Nothing in this view</h3><p>Try another filter or add an item from the catalogue.</p><button className="ob-button shimmer-button" onClick={() => { setCategory('All items'); setSearch('') }}>Clear filters</button></div>}
      </section>
      <footer className="ob-footer"><span>n1ssan <b>/</b> OBSIDIAN</span><span>{'INVENTORY WORKSPACE'} <i /> PREVIEW BUILD</span><span>COUNTER-STRIKE 2</span></footer>
      </>}
    </main>

    {notice && <div className="ob-notification-stack" role="status" aria-live="polite"><div className="ob-notification-icon">✓</div><div className="ob-notification-copy"><strong>Inventory updated</strong><span>{notice}</span></div><button aria-label="Dismiss notification" onClick={() => setNotice('')}>×</button><i className="ob-notification-timer" /></div>}

    {dialog && <div className="ob-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setDialog(null) }}>
      {dialog === 'add' && <section className="ob-dialog ob-add-dialog">
        <div className="dialog-head"><div><div className="ob-kicker">CATALOGUE</div><h2>Add to <span>inventory.</span></h2></div><button className="dialog-close" onClick={() => setDialog(null)}>×</button></div>
        <div className="add-category-tabs">{([{id:'skin',label:'Skins'},{id:'sticker',label:'Stickers'},{id:'charm',label:'Charms'}] as const).map(tab => <button key={tab.id} className={addCategory === tab.id ? 'active' : ''} onClick={() => { setAddCategory(tab.id); setCatalogueSearch(''); setSkinPickerLevel('root'); setSelectedSkinWeapon(''); setSelectedSkinGroup('weapons') }}>{tab.label}<small>{tab.id === 'skin' ? baseWeapons.filter(weapon => ['Pistols', 'Rifles', 'SMGs', 'Heavy'].includes(weapon.category?.name ?? '')).length + 2 : specialItems.filter(item => item.kind === tab.id).length}</small></button>)}</div>
        <label className="ob-search dialog-search"><span>⌕</span><input autoFocus value={catalogueSearch} onChange={e => setCatalogueSearch(e.target.value)} placeholder={addCategory !== 'skin' ? addCategory === 'sticker' ? 'Search stickers, teams, tournaments...' : 'Search charms...' : skinPickerLevel === 'root' ? 'Search weapons...' : skinPickerLevel === 'models' ? `Search ${selectedSkinGroup}...` : 'Search finishes...'} /></label>
        {addCategory === 'skin' ? <>
          {skinPickerLevel !== 'root' && <div className="catalogue-breadcrumb"><button onClick={() => { setCatalogueSearch(''); if (skinPickerLevel === 'finishes' && selectedSkinGroup !== 'weapons') setSkinPickerLevel('models'); else { setSkinPickerLevel('root'); setSelectedSkinWeapon(''); setSelectedSkinGroup('weapons') } }}>← Back</button><span>{skinPickerLevel === 'models' ? selectedSkinGroup === 'knives' ? 'Knives' : 'Gloves' : selectedSkinWeapon}</span></div>}
          {skinPickerLevel === 'root' && (baseWeaponsLoading ? <div className="catalogue-state">Loading default weapon previews…</div> : baseWeaponTiles.length || !catalogueSearch.trim() ? <div className="catalogue-weapon-grid">
            {baseWeaponTiles.map(weapon => <button key={weapon.id} className="catalogue-weapon-card" onClick={() => { setSelectedSkinGroup('weapons'); setSelectedSkinWeapon(weapon.name); setSkinPickerLevel('finishes'); setCatalogueSearch('') }}><div className="catalogue-weapon-art">{weapon.image && <img src={weapon.image} alt="" loading="lazy" />}</div><strong>{weapon.name}</strong><small>{weapon.category?.name}</small></button>)}
            <button className="catalogue-weapon-card catalogue-special-card" onClick={() => { setSelectedSkinGroup('knives'); setSkinPickerLevel('models'); setCatalogueSearch('') }}><div className="catalogue-weapon-art">{baseWeapons.find(weapon => weapon.name === 'Knife')?.image && <img src={baseWeapons.find(weapon => weapon.name === 'Knife')?.image} alt="" loading="lazy" />}</div><strong>Knives</strong><small>Choose a knife type</small></button>
            <button className="catalogue-weapon-card catalogue-special-card" onClick={() => { setSelectedSkinGroup('gloves'); setSkinPickerLevel('models'); setCatalogueSearch('') }}><div className="catalogue-weapon-art">{baseWeapons.find(weapon => weapon.name.toLowerCase().includes('gloves'))?.image && <img src={baseWeapons.find(weapon => weapon.name.toLowerCase().includes('gloves'))?.image} alt="" loading="lazy" />}</div><strong>Gloves</strong><small>Choose a glove type</small></button>
          </div> : <div className="catalogue-state">No matching weapons found.</div>)}
          {skinPickerLevel === 'models' && <div className="catalogue-weapon-grid">{(selectedSkinGroup === 'knives' ? knifeModelTiles : gloveModelTiles).map(model => <button key={model.weapon} className="catalogue-weapon-card" onClick={() => { setSelectedSkinWeapon(model.weapon); setSkinPickerLevel('finishes'); setCatalogueSearch('') }}><div className="catalogue-weapon-art">{model.image && <img src={model.image} alt="" loading="lazy" />}</div><strong>{model.weapon}</strong><small>{selectedSkinGroup === 'knives' ? 'Knife finishes' : 'Glove finishes'}</small></button>)}</div>}
          {skinPickerLevel === 'finishes' && <div className="ob-catalogue-list">{skinPickerCandidates.length ? skinPickerCandidates.map(skin => <button key={skin.id} onClick={() => chooseCatalogueItem(skin)}><div className="catalogue-thumb">{skin.image && <img src={skin.image} alt="" loading="lazy" />}</div><span><strong>{skin.weapon}</strong><small>{skin.name} · {skin.rarity}</small></span><b>＋</b></button>) : <div className="catalogue-state">No finishes found for {selectedSkinWeapon}.</div>}</div>}
        </> : <div className="ob-catalogue-list">{specialLoading ? <div className="catalogue-state">Loading {addCategory} catalogue…</div> : specialError && !specialItems.some(item => item.kind === addCategory) ? <div className="catalogue-state">{specialError}</div> : candidates.length ? candidates.map(skin => <button key={skin.id} onClick={() => chooseCatalogueItem(skin)}><div className="catalogue-thumb">{skin.image && <img src={skin.image} alt="" loading="lazy" />}</div><span><strong>{skin.weapon}</strong><small>{skin.name} · {skin.rarity}</small></span><b>＋</b></button>) : <div className="catalogue-state">No matching items found.</div>}</div>}
        <div className="dialog-foot">{addCategory === 'skin' ? 'Choose a weapon to browse its available finishes.' : 'Imported into inventory only · Attach from a weapon’s detail panel.'}</div>
      </section>}
      {dialog === 'customize' && pendingSkin && <section className="ob-dialog ob-customize-dialog"><div className="dialog-head"><div><div className="ob-kicker">NEW INVENTORY INSTANCE</div><h2>Configure <span>item.</span></h2><p>Set the finish details before importing it into your armory.</p></div><button className="dialog-close" onClick={() => setDialog('add')}>×</button></div><div className="detail-preview"><div className="detail-preview-art">{pendingSkin.image && <img src={pendingSkin.image} alt=""/>}</div><div><small>{pendingSkin.weapon}</small><h3>{pendingSkin.name}</h3><span>{pendingSkin.rarity} · {getCategory(pendingSkin)}</span></div></div><div className="ob-fields customize-fields"><label className="field-wide float-field">FLOAT VALUE <div className="float-slider-wrap"><div className="float-slider-value"><span>{Number(pendingFloat).toFixed(5)}</span><b>{Number(pendingFloat) <= 0.07 ? 'FN' : Number(pendingFloat) <= 0.15 ? 'MW' : Number(pendingFloat) <= 0.38 ? 'FT' : Number(pendingFloat) <= 0.45 ? 'WW' : 'BS'}</b></div><input className="float-slider" type="range" min={pendingSkin.minFloat ?? 0} max={pendingSkin.maxFloat ?? 1} step="0.00001" value={Math.min(pendingSkin.maxFloat ?? 1, Math.max(pendingSkin.minFloat ?? 0, Number(pendingFloat) || 0))} style={{ background: `linear-gradient(90deg, ${Number(pendingFloat) <= 0.07 ? '#65a9e8' : Number(pendingFloat) <= 0.15 ? '#62b987' : Number(pendingFloat) <= 0.38 ? '#b6bd55' : Number(pendingFloat) <= 0.45 ? '#d99a48' : '#d65d5d'} 0%, ${Number(pendingFloat) <= 0.07 ? '#65a9e8' : Number(pendingFloat) <= 0.15 ? '#62b987' : Number(pendingFloat) <= 0.38 ? '#b6bd55' : Number(pendingFloat) <= 0.45 ? '#d99a48' : '#d65d5d'} ${((Number(pendingFloat) - (pendingSkin.minFloat ?? 0)) / ((pendingSkin.maxFloat ?? 1) - (pendingSkin.minFloat ?? 0) || 1)) * 100}%, #303030 ${((Number(pendingFloat) - (pendingSkin.minFloat ?? 0)) / ((pendingSkin.maxFloat ?? 1) - (pendingSkin.minFloat ?? 0) || 1)) * 100}%, #303030 100%)` }} onChange={e => setPendingFloat(Number(e.target.value).toFixed(5))}/><div className="slider-marks"><span>{(pendingSkin.minFloat ?? 0).toFixed(2)}</span><span>{((pendingSkin.minFloat ?? 0) + ((pendingSkin.maxFloat ?? 1) - (pendingSkin.minFloat ?? 0)) * 0.25).toFixed(2)}</span><span>{((pendingSkin.minFloat ?? 0) + ((pendingSkin.maxFloat ?? 1) - (pendingSkin.minFloat ?? 0)) * 0.5).toFixed(2)}</span><span>{((pendingSkin.minFloat ?? 0) + ((pendingSkin.maxFloat ?? 1) - (pendingSkin.minFloat ?? 0)) * 0.75).toFixed(2)}</span><span>{(pendingSkin.maxFloat ?? 1).toFixed(2)}</span></div></div><input className="custom-float-input" value={pendingFloat} onChange={e => setPendingFloat(e.target.value)} inputMode="decimal" placeholder="Custom float (0.00000–1.00000)"/></label><label>PAINT SEED<input value={pendingSeed} onChange={e => setPendingSeed(String(Math.min(1000, Number(e.target.value.replace(/[^0-9]/g,'')) || 0)))} inputMode="numeric" maxLength={4} placeholder="0–1000"/>{getCategory(pendingSkin) === 'Knives' && pendingSkin.name === 'Case Hardened' && <small className="seed-hint">Use a seed from 0–1000. Blue Gem is a Case Hardened pattern variant determined by the paint seed.</small>}</label>{getCategory(pendingSkin) !== 'Gloves' && <div className="field-label">STATTRAK™ <button type="button" className={`stattrak-toggle ${pendingStatTrak ? 'enabled' : ''}`} aria-pressed={pendingStatTrak} onClick={() => setPendingStatTrak(v => !v)}><span className="st-toggle-track"><i/></span></button></div>}<label className="field-wide">NAME TAG<input value={pendingName} onChange={e => setPendingName(e.target.value)} placeholder="Optional name tag..." maxLength={20}/></label></div><div className="dialog-actions"><button className="ob-button secondary" onClick={() => setDialog('add')}>Back to catalogue</button><button className="ob-button shimmer-button" onClick={() => { const min = pendingSkin.minFloat ?? 0, max = pendingSkin.maxFloat ?? 1, value = Number(pendingFloat); if (!Number.isFinite(value) || value < min || value > max) { setNotice(`Float must be between ${min.toFixed(5)} and ${max.toFixed(5)}`); return } addSkin(pendingSkin, 1, { float: value.toFixed(5), seed: pendingSeed, stattrak: getCategory(pendingSkin) !== 'Gloves' && pendingStatTrak, customName: pendingName.trim() }) }}>Add to inventory <span>＋</span></button></div></section>}
      {dialog === 'quantity' && pendingSkin && <section className="ob-dialog ob-quantity-dialog"><div className="dialog-head"><div><div className="ob-kicker">STACK QUANTITY</div><h2>Add <span>{pendingSkin.kind === 'charm' ? 'charm.' : 'stickers.'}</span></h2><p>How many copies would you like to import?</p></div><button className="dialog-close" onClick={() => setDialog('add')}>×</button></div><div className="quantity-item-preview"><div className="catalogue-thumb">{pendingSkin.image && <img src={pendingSkin.image} alt=""/>}</div><div><strong>{pendingSkin.name}</strong><small>{pendingSkin.rarity} · {pendingSkin.kind}</small></div></div><div className="quantity-control"><button onClick={() => setPendingQuantity(n => Math.max(1,n-1))} aria-label="Decrease quantity">−</button><input type="number" min="1" max="999" value={pendingQuantity} onChange={e => setPendingQuantity(Math.max(1,Math.min(999,Number(e.target.value)||1)))}/><button onClick={() => setPendingQuantity(n => Math.min(999,n+1))} aria-label="Increase quantity">＋</button></div><div className="dialog-actions"><button className="ob-button secondary" onClick={() => setDialog('add')}>Back</button><button className="ob-button shimmer-button" onClick={() => addSkin(pendingSkin,pendingQuantity)}>Add ×{pendingQuantity} to inventory</button></div></section>}
      {dialog === 'detail' && selected && <section className="ob-dialog ob-detail-dialog"><div className="dialog-head"><div><h2>Item <span>details.</span></h2></div><button className="dialog-close" onClick={() => setDialog(null)}>×</button></div><div className="detail-preview"><div className="detail-preview-art">{selected.skin.image && <img src={selected.skin.image} alt="" />}</div><div><small>{selected.skin.weapon}</small><h3>{selected.skin.name}</h3><span className="detail-rarity-line"><b className={`detail-rarity rarity-${rarityClass(selected.skin.rarity)}`}>{selected.skin.rarity}</b><i>·</i>{getCategory(selected.skin)}</span></div></div><div className="ob-fields">{(selected.item.kind ?? 'skin') === 'skin' && !isAgent(selected.skin) && <><label>FLOAT VALUE<input value={selected.item.float} onChange={e => updateSelected({ float: e.target.value })} inputMode="decimal" /></label><label>PAINT SEED<input value={selected.item.seed} onChange={e => updateSelected({ seed: String(Math.min(1000, Number(e.target.value.replace(/[^0-9]/g,'')) || 0)) })} inputMode="numeric" maxLength={4} placeholder="0–1000" />{getCategory(selected.skin) === 'Knives' && selected.skin.name === 'Case Hardened' && <small className="seed-hint">Use a seed from 0–1000. Blue Gem is determined by the Case Hardened paint seed.</small>}</label></>}{(selected.item.kind ?? 'skin') === 'skin' && <label className="field-wide">CUSTOM NAME<input value={selected.item.customName} onChange={e => updateSelected({ customName: e.target.value })} placeholder="Name this item..." /></label>}{(selected.item.kind ?? 'skin') === 'skin' && !isAgent(selected.skin) && getCategory(selected.skin) !== 'Gloves' && <button type="button" className={`stattrak-toggle ${selected.item.stattrak ? 'enabled' : ''}`} aria-pressed={selected.item.stattrak} onClick={() => updateSelected({ stattrak: !selected.item.stattrak })}><span className="st-toggle-label">ST</span><span className="st-toggle-track"><i /></span></button>}</div>{selected.item.attachments && (selected.item.attachments.stickers.length > 0 || selected.item.attachments.charm) && <div className="attach-panel"><div className="attach-preview-row">{[...selected.item.attachments.stickers].sort((a, b) => a.slot - b.slot).map(sticker => { const name = labelForKit('sticker', sticker.kitId); const image = imageForKit('sticker', sticker.kitId); return <div className="attach-preview-item" key={sticker.slot} title={`Slot ${sticker.slot + 1}: ${name} · wear ${sticker.wear.toFixed(3)} · rotation ${sticker.rotation.toFixed(1)}° · offset ${sticker.offsetX.toFixed(2)}, ${sticker.offsetY.toFixed(2)}`}><div className="attach-preview-art">{image ? <img src={image} alt={name} loading="lazy" /> : <span>ST</span>}</div><small>{name}</small></div>})}{selected.item.attachments.charm && (() => { const charm = selected.item.attachments.charm; const name = labelForKit('charm', charm.kitId); const image = imageForKit('charm', charm.kitId); return <div className="attach-preview-item attach-preview-charm" title={`Charm: ${name} · seed ${charm.seed} · position ${charm.x.toFixed(2)}, ${charm.y.toFixed(2)}, ${charm.z.toFixed(2)}`}><div className="attach-preview-art">{image ? <img src={image} alt={name} loading="lazy" /> : <span>CH</span>}</div><small>{name}</small></div>})()}</div></div>}{(selected.item.kind ?? 'skin') !== 'skin' && <div className="imported-item-note">Imported quantity: <strong>×{selected.item.quantity ?? 1}</strong> · Attach it from a weapon’s detail panel.</div>}<div className="dialog-actions"><button className="ob-button shimmer-button remove-item-button" onClick={removeSelected}>Remove item</button><button className="ob-button shimmer-button" onClick={() => setDialog(null)}>Done</button></div></section>}
      {dialog === 'profiles' && <section className="ob-dialog ob-profiles-dialog"><div className="dialog-head"><div><h2>Manage <span>profiles.</span></h2></div><button className="dialog-close" onClick={() => setDialog(null)}>×</button></div><div className="profile-list">{profiles.map(p => <div className={p.id === activeId ? 'profile-row current' : 'profile-row'} key={p.id}>{editingProfileId === p.id ? <div className="profile-rename"><input autoFocus value={editingProfileName} aria-label={`Rename ${p.name}`} onChange={e => setEditingProfileName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveProfileRename(p.id); if (e.key === 'Escape') setEditingProfileId(null) }} /><button className="profile-action-save" onClick={() => saveProfileRename(p.id)} disabled={!editingProfileName.trim()}>Save</button><button className="profile-action-cancel" onClick={() => setEditingProfileId(null)}>Cancel</button></div> : <><button className="profile-load" onClick={() => switchProfile(p.id)}><span className="profile-radio">{p.id === activeId && <i />}</span><span><strong>{p.name}</strong><small>{p.items.reduce((sum,item) => sum + (item.quantity ?? 1), 0)} items · Updated {new Date(p.updatedAt).toLocaleString()}</small></span></button><button className="profile-rename-trigger" title={`Rename ${p.name}`} aria-label={`Rename ${p.name}`} onClick={() => beginRenameProfile(p)}>✎</button><button className="profile-delete" title="Delete profile" onClick={() => deleteProfile(p.id)} disabled={profiles.length < 2}>×</button></>}</div>)}</div><div className="new-profile"><label>NEW PROFILE<input value={profileName} onChange={e => setProfileName(e.target.value)} placeholder="e.g. Tournament setup" onKeyDown={e => { if (e.key === 'Enter') saveProfile() }} /></label><button className="ob-button shimmer-button" onClick={saveProfile} disabled={!profileName.trim()}>Create profile <span>＋</span></button></div></section>}
      {dialog === 'diagnostics' && <section className="ob-dialog ob-diagnostics-dialog"><div className="dialog-head"><div><div className="ob-kicker">SYSTEM HEALTH</div><h2>Diagnostics<span>.</span></h2><p>Runtime and compatibility checks for the CS2 integration.</p></div><button className="dialog-close" onClick={() => setDialog(null)}>×</button></div><div className="diagnostic-list"><div><span className="diagnostic-state pending" /><span><strong>CS2 process detection</strong><small>Not connected · preview cannot inspect local processes</small></span><b>WAITING</b></div><div><span className="diagnostic-state online" /><span><strong>Bridge connection</strong><small>Armory inventory API is connected and persistent</small></span><b>ONLINE</b></div><div><span className="diagnostic-state pending" /><span><strong>Offsets &amp; signatures</strong><small>Version validation will report outdated definitions here</small></span><b>NOT CHECKED</b></div></div><div className="dialog-foot">Diagnostics UI preview · no process or signature checks are running yet</div></section>}
    </div>}
  </div>
}
