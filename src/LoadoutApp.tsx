import { useEffect, useMemo, useState } from 'react'
import './legacy/Loadout.Legacy.css'
import './obsidian/obsidian.css'
import './loadout-redesign.css'
import rickshawImage from '../assets/images/Rickshaw-clay.jpg'
import n1ssanLogo from '../assets/icons/n1ssan-icon-white.png'
import LineSidebar from './obsidian/LineSidebar'
import { ShimmerButton } from './obsidian/ShimmerButton'
import ObsidianDropdown from './obsidian/ObsidianDropdown'

export type Skin = {
  id: number | string; weapon: string; name: string; type: string; rarity: string
  color: string; art: string; description: string; image?: string
  minFloat?: number | null; maxFloat?: number | null
}
type SkinId = number | string
type Team = 'T' | 'CT'
type SavedLoadouts = Record<Team, Record<string, SkinId | null>>
type SkinSettings = { seed: number; float: number }
type SavedSkinSettings = Record<Team, Record<string, SkinSettings>>
type EquipmentSlot = 'agent' | 'knife' | 'gloves' | 'zeus'
type TeamEquipment = Record<EquipmentSlot, SkinId | null>
type SavedEquipment = Record<Team, TeamEquipment>
type LoadoutBuilderProps = { skins: Skin[] }
type WeaponColumn = { title: string; weapons: string[] }
type SavedWeaponSlots = Record<Team, Record<string, (string | null)[]>>
type LoadoutProfile = { id: string; name: string; loadouts: SavedLoadouts; skinSettings: SavedSkinSettings; equipment: SavedEquipment; weaponSlots?: SavedWeaponSlots }
type DialogState = { mode: 'create' | 'duplicate' | 'rename' | 'delete' | 'clear'; value: string } | null

const STORAGE_KEY = 'n1ssan-loadouts-v1'
const BRIDGE_URL = 'http://127.0.0.1:3210'
const SETTINGS_STORAGE_KEY = 'n1ssan-skin-settings-v1'
const EQUIPMENT_STORAGE_KEY = 'n1ssan-equipment-v1'
const PROFILES_STORAGE_KEY = 'n1ssan-loadout-profiles-v1'
const ACTIVE_PROFILE_STORAGE_KEY = 'n1ssan-active-loadout-profile-v1'
const emptyLoadouts: SavedLoadouts = { T: {}, CT: {} }
const emptySettings: SavedSkinSettings = { T: {}, CT: {} }
const emptyTeamEquipment: TeamEquipment = { agent: null, knife: null, gloves: null, zeus: null }
const emptyEquipment: SavedEquipment = { T: { ...emptyTeamEquipment }, CT: { ...emptyTeamEquipment } }

const TEAM_WEAPONS: Record<Team, WeaponColumn[]> = {
  T: [
    { title: 'PISTOLS', weapons: ['Glock-18', 'Dual Berettas', 'P250', 'Tec-9', 'CZ75-Auto', 'Desert Eagle', 'R8 Revolver'] },
    { title: 'MID-TIER', weapons: ['MAC-10', 'MP7', 'MP5-SD', 'UMP-45', 'P90', 'PP-Bizon', 'Nova', 'XM1014', 'Sawed-Off', 'M249', 'Negev'] },
    { title: 'RIFLES', weapons: ['Galil AR', 'AK-47', 'SG 553', 'SSG 08', 'AWP', 'G3SG1'] },
  ],
  CT: [
    { title: 'PISTOLS', weapons: ['USP-S', 'P2000', 'Dual Berettas', 'P250', 'Five-SeveN', 'CZ75-Auto', 'Desert Eagle', 'R8 Revolver'] },
    { title: 'MID-TIER', weapons: ['MP9', 'MP7', 'MP5-SD', 'UMP-45', 'P90', 'PP-Bizon', 'Nova', 'XM1014', 'MAG-7', 'M249', 'Negev'] },
    { title: 'RIFLES', weapons: ['FAMAS', 'M4A4', 'M4A1-S', 'AUG', 'SSG 08', 'AWP', 'SCAR-20'] },
  ],
}
const PREFERRED_WEAPON_SLOTS: Record<Team, Record<string, string[]>> = {
  T: {
    PISTOLS: ['Glock-18','Dual Berettas','P250','Tec-9','Desert Eagle'],
    'MID-TIER': ['Nova','XM1014','UMP-45','P90','MAC-10'],
    RIFLES: ['Galil AR','AK-47','SSG 08','SG 553','AWP'],
  },
  CT: {
    PISTOLS: ['USP-S','Dual Berettas','P250','Five-SeveN','Desert Eagle'],
    'MID-TIER': ['Nova','XM1014','UMP-45','P90','MP9'],
    RIFLES: ['FAMAS','M4A1-S','SSG 08','AUG','AWP'],
  },
}
function defaultWeaponSlots(side: Team): Record<string, (string | null)[]> {
  return Object.fromEntries(TEAM_WEAPONS[side].map(column => {
    const preferred = PREFERRED_WEAPON_SLOTS[side][column.title] ?? []
    return [column.title, [...preferred.filter(weapon => column.weapons.includes(weapon)), ...column.weapons.filter(weapon => !preferred.includes(weapon))].slice(0, 5)]
  }))
}
function weaponSlotsForProfile(profile: LoadoutProfile): SavedWeaponSlots {
  const sideSlots = (side: Team) => Object.fromEntries(TEAM_WEAPONS[side].map(column => {
    const availableWeapons = column.weapons.filter((weapon): weapon is string => typeof weapon === 'string')
    const previouslyEquipped = availableWeapons.filter(weapon => profile.loadouts?.[side]?.[weapon] != null).slice(0, 5)
    const preferred = (defaultWeaponSlots(side)[column.title] ?? []).filter((weapon): weapon is string => typeof weapon === 'string')
    const remaining = preferred.filter(weapon => !previouslyEquipped.includes(weapon)).concat(availableWeapons.filter(weapon => !previouslyEquipped.includes(weapon) && !preferred.includes(weapon)))
    return [column.title, [...previouslyEquipped, ...remaining].slice(0, 5)]
  }))
  return { T: sideSlots('T'), CT: sideSlots('CT') }
}
const TEAM_IMAGES: Record<Team, string> = {
  T: 'https://steamcommunity-a.akamaihd.net/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIa-2lmxU-LR0dnuNm6E8Vl45Iv181z1fgn8oYby8iRe_OGnZ6psLM-FD3WZj7wuseM-GnG2lh4h5m2EmderdX7DaA9zW8N2QuBbtBG-mty2N-i0tADAy9USaSI87As/512fx384f',
  CT: 'https://steamcommunity-a.akamaihd.net/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIa-2lmxU-LR0dnuNm6E8Vl45Iv181z1fh7lk6nz6XRk-fO8YaVjNPndVz-Ul74hsbNoHi21kUly6mrQzNagcijBPQEnCsciTOdY4Rm6m4XvN_SiuVLIl2LQXw/512fx384f',
}
const EQUIPMENT_INFO: Record<EquipmentSlot, { title: string; subtitle: string; icon: string }> = {
  agent: { title: 'Agent', subtitle: 'Character model', icon: '♙' },
  knife: { title: 'Knife', subtitle: 'Melee weapon', icon: '⚔' },
  gloves: { title: 'Gloves', subtitle: 'Handwear finish', icon: '◇' },
  zeus: { title: 'Zeus x27', subtitle: 'Electroshock weapon', icon: 'ϟ' },
}
const emptyWeaponSlots: SavedWeaponSlots = { T: defaultWeaponSlots('T'), CT: defaultWeaponSlots('CT') }
function imageOf(s: Skin) { return s.image || s.art || '' }
function rarityColor(rarity: string) {
  const value = (rarity || '').toLowerCase()
  if (value.includes('contraband')) return '#df8b43'
  if (value.includes('extraordinary') || value.includes('exotic')) return '#e3b54f'
  if (value.includes('covert')) return '#e55353'
  if (value.includes('classified')) return '#d86bd9'
  if (value.includes('restricted') || value.includes('remarkable')) return '#9a67db'
  if (value.includes('mil-spec') || value.includes('mil spec')) return '#4d8bdb'
  if (value.includes('industrial') || value.includes('distinguished')) return '#8bb8e8'
  if (value.includes('consumer') || value.includes('high grade')) return '#b0b0b0'
  if (value.includes('base grade')) return '#9ca3af'
  return '#b0b0b0'
}
function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T }
function profileId() { return `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
function readJSON<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) as T : fallback } catch { return fallback }
}
function loadLegacyLoadouts(): SavedLoadouts {
  const p = readJSON<Partial<SavedLoadouts>>(STORAGE_KEY, {})
  return { T: p.T ?? {}, CT: p.CT ?? {} }
}
function loadLegacySettings(): SavedSkinSettings {
  const p = readJSON<Partial<SavedSkinSettings>>(SETTINGS_STORAGE_KEY, {})
  return { T: p.T ?? {}, CT: p.CT ?? {} }
}
function loadLegacyEquipment(): SavedEquipment {
  const p = readJSON<Partial<SavedEquipment>>(EQUIPMENT_STORAGE_KEY, {})
  const norm = (v?: Partial<TeamEquipment>): TeamEquipment => ({
    agent: typeof v?.agent === 'number' ? v.agent : null,
    knife: typeof v?.knife === 'number' ? v.knife : null,
    gloves: typeof v?.gloves === 'number' ? v.gloves : null,
    zeus: typeof v?.zeus === 'number' ? v.zeus : null,
  })
  return { T: norm(p.T), CT: norm(p.CT) }
}
function loadProfiles(): LoadoutProfile[] {
  const saved = readJSON<LoadoutProfile[]>(PROFILES_STORAGE_KEY, [])
  if (Array.isArray(saved) && saved.length) return saved
  const p: LoadoutProfile = {
    id: 'main-loadout', name: 'Main Loadout',
    loadouts: loadLegacyLoadouts(), skinSettings: loadLegacySettings(), equipment: loadLegacyEquipment(),
  }
  try {
    localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify([p]))
    localStorage.setItem(ACTIVE_PROFILE_STORAGE_KEY, p.id)
  } catch { /* continue in memory */ }
  return [p]
}
function wear(f: number) {
  if (f < .07) return 'Factory New'
  if (f < .15) return 'Minimal Wear'
  if (f < .38) return 'Field-Tested'
  if (f < .45) return 'Well-Worn'
  return 'Battle-Scarred'
}
function limits(s?: Skin) {
  const min = typeof s?.minFloat === 'number' && Number.isFinite(s.minFloat) ? Math.max(0, Math.min(1, s.minFloat)) : 0
  const max = typeof s?.maxFloat === 'number' && Number.isFinite(s.maxFloat) ? Math.max(min, Math.min(1, s.maxFloat)) : 1
  return { min, max }
}
function defaults(s?: Skin): SkinSettings {
  const l = limits(s)
  return { seed: 0, float: Number(((l.min + l.max) / 2).toFixed(6)) }
}
function settingsKey(w: string, id: SkinId) { return `${w}:${id}` }
function equipmentCategory(s: Skin): EquipmentSlot | null {
  const t = (s.type || '').toLowerCase(), w = (s.weapon || '').toLowerCase()
  if (t.includes('agent')) return 'agent'
  if (t.includes('glove') || w.includes('glove')) return 'gloves'
  if (w.includes('zeus') || w.includes('x27') || t.includes('zeus')) return 'zeus'
  if (t.includes('knife') || t.includes('kniv') || w.includes('knife')) return 'knife'
  return null
}
function agentForTeam(s: Skin, team: Team) {
  const t = (s.type || '').toLowerCase()
  return team === 'T' ? t === 't agents' : t === 'ct agents'
}
export default function LoadoutApp({ skins }: LoadoutBuilderProps) {
  useEffect(() => { document.title = 'Loadout - n1ssan' }, [])
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
      if (!context) { icon.href = n1ssanLogo; return }
      context.clearRect(0, 0, 64, 64)
      context.drawImage(logo, 9, 9, 46, 46)
      icon.href = canvas.toDataURL('image/png')
    }
    logo.onerror = () => { icon.href = n1ssanLogo }
    logo.src = n1ssanLogo
  }, [])
  const [profiles, setProfiles] = useState<LoadoutProfile[]>(loadProfiles)
  const [activeProfileId, setActiveProfileId] = useState(() => {
    const id = localStorage.getItem(ACTIVE_PROFILE_STORAGE_KEY)
    return profiles.some(p => p.id === id) ? id! : profiles[0].id
  })
  const initial = profiles.find(p => p.id === activeProfileId) ?? profiles[0]
  const [team, setTeam] = useState<Team>('T')
  const [pickerSearch, setPickerSearch] = useState('')
  const [equipmentSearch, setEquipmentSearch] = useState('')
  const [equipmentSort, setEquipmentSort] = useState<'rarity' | 'az' | 'popular'>('popular')
  const [skinSort, setSkinSort] = useState<'rarity' | 'az' | 'popular'>('popular')
  const [activeWeapon, setActiveWeapon] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activeEquipment, setActiveEquipment] = useState<EquipmentSlot | null>(null)
  const [loadouts, setLoadouts] = useState<SavedLoadouts>(() => clone(initial.loadouts))
  const [skinSettings, setSkinSettings] = useState<SavedSkinSettings>(() => clone(initial.skinSettings))
  const [equipment, setEquipment] = useState<SavedEquipment>(() => clone(initial.equipment))
  const [weaponSlots, setWeaponSlots] = useState<SavedWeaponSlots>(() => clone(initial.weaponSlots ?? weaponSlotsForProfile(initial)))
  const [page, setPage] = useState<'home' | 'loadout' | 'diagnostics'>('home')
  const [activeNavIndex, setActiveNavIndex] = useState(0)
  const [floatDraft, setFloatDraft] = useState('0.000000')
  const [seedDraft, setSeedDraft] = useState('0')
  const [dialog, setDialog] = useState<DialogState>(null)
  const [profileManagerOpen, setProfileManagerOpen] = useState(false)
  const [activeSlotContext, setActiveSlotContext] = useState<{ category: string; index: number } | null>(null)
  const [equipmentWeaponFilter, setEquipmentWeaponFilter] = useState('All')
  const [runtimeStatus, setRuntimeStatus] = useState<{ tone: 'idle' | 'ok' | 'error'; text: string }>({ tone: 'idle', text: '' })
  const [applying, setApplying] = useState(false)

  const activeProfile = profiles.find(p => p.id === activeProfileId) ?? profiles[0]
  const columns = TEAM_WEAPONS[team]
  const currentLoadout = loadouts[team]
  const currentEquipment = equipment[team]
  const equippedCountT = useMemo(() => TEAM_WEAPONS.T.reduce((n, column) => n + (weaponSlots.T[column.title] ?? []).filter(weapon => !!weapon && loadouts.T[weapon] != null).length, 0) + ['agent','knife','gloves'].filter(slot => equipment.T[slot as EquipmentSlot] != null).length, [loadouts.T, equipment.T, weaponSlots.T])
  const equippedCountCT = useMemo(() => TEAM_WEAPONS.CT.reduce((n, column) => n + (weaponSlots.CT[column.title] ?? []).filter(weapon => !!weapon && loadouts.CT[weapon] != null).length, 0) + ['agent','knife','gloves'].filter(slot => equipment.CT[slot as EquipmentSlot] != null).length, [loadouts.CT, equipment.CT, weaponSlots.CT])

  // Persist the active profile's data + the profiles list to localStorage.
  useEffect(() => {
    try {
      localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(profiles))
      localStorage.setItem(ACTIVE_PROFILE_STORAGE_KEY, activeProfileId)
    } catch { console.warn('n1ssan could not save profiles to browser storage.') }
  }, [profiles, activeProfileId])
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(loadouts))
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(skinSettings))
      localStorage.setItem(EQUIPMENT_STORAGE_KEY, JSON.stringify(equipment))
    } catch { console.warn('n1ssan could not save the active loadout.') }
  }, [loadouts, skinSettings, equipment])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPickerOpen(false); setSettingsOpen(false); setActiveEquipment(null); setProfileManagerOpen(false)
        setDialog(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Explicitly send the current Loadout profile to the game. Editing a loadout
  // never writes the runtime file by itself; the DLL adopts the last sent
  // profile once the player is outside an active match.
  async function applyLoadout() {
    if (applying) return

    setApplying(true)
    setRuntimeStatus({ tone: 'idle', text: 'Sending loadout to the game…' })

    try {
      const response = await fetch(`${BRIDGE_URL}/loadout/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileId: activeProfileId,
          name: activeProfile.name,
          loadouts: {
            T: Object.fromEntries(Object.entries(loadouts.T).filter(([weapon]) => TEAM_WEAPONS.T.some(column => (weaponSlots.T[column.title] ?? []).includes(weapon)))),
            CT: Object.fromEntries(Object.entries(loadouts.CT).filter(([weapon]) => TEAM_WEAPONS.CT.some(column => (weaponSlots.CT[column.title] ?? []).includes(weapon)))),
          },
          equipment: { T: { ...equipment.T, zeus: null }, CT: { ...equipment.CT, zeus: null } },
          skinSettings,
        }),
      })
      const body = await response.json().catch(() => null) as {
        error?: { message?: string }
        runtime?: { written?: boolean; targetCount?: number; skipped?: number; reason?: string }
      } | null

      if (!response.ok) throw new Error(body?.error?.message ?? `Bridge returned HTTP ${response.status}`)

      const runtime = body?.runtime
      setRuntimeStatus({
        tone: 'ok',
        text: runtime?.written
          ? `SENT · ${runtime.targetCount} item${runtime.targetCount === 1 ? '' : 's'} · applies outside an active match${runtime.skipped ? ` · ${runtime.skipped} skipped` : ''}`
          : `NOT SENT · ${runtime?.reason ?? 'no change'}`,
      })
    } catch (error) {
      setRuntimeStatus({
        tone: 'error',
        text: `SEND FAILED · ${error instanceof Error ? error.message : 'apply failed'}`,
      })
    } finally {
      setApplying(false)
    }
  }

  // Keep the active profile snapshot current whenever a loadout field changes.
  // Called by mutation helpers, not on every keystroke.
  function syncActiveProfile(next: { loadouts: SavedLoadouts; skinSettings: SavedSkinSettings; equipment: SavedEquipment; weaponSlots?: SavedWeaponSlots }) {
    setProfiles(prev => prev.map(p => p.id === activeProfileId ? {
      ...p, loadouts: clone(next.loadouts), skinSettings: clone(next.skinSettings), equipment: clone(next.equipment), weaponSlots: clone(next.weaponSlots ?? weaponSlots),
    } : p))
  }


  function resetTransient() {
    setTeam('T'); setPickerSearch(''); setEquipmentSearch(''); setEquipmentWeaponFilter('All'); setSkinSort('popular'); setEquipmentSort('popular')
    setActiveWeapon(null); setPickerOpen(false); setSettingsOpen(false); setActiveEquipment(null)
  }
  function switchProfile(id: string) {
    if (id === activeProfileId) return
    const next = profiles.find(p => p.id === id)
    if (!next) return
    const outgoing = { ...activeProfile, loadouts: clone(loadouts), skinSettings: clone(skinSettings), equipment: clone(equipment), weaponSlots: clone(weaponSlots) }
    setProfiles(prev => prev.map(p => p.id === outgoing.id ? outgoing : p))
    setActiveProfileId(next.id)
    setLoadouts(clone(next.loadouts)); setSkinSettings(clone(next.skinSettings)); setEquipment(clone(next.equipment)); setWeaponSlots(clone(next.weaponSlots ?? weaponSlotsForProfile(next)))
    resetTransient()
  }
  function openDialog(mode: NonNullable<DialogState>['mode']) {
    const value = mode === 'rename' ? activeProfile.name : mode === 'duplicate' ? `${activeProfile.name} Copy` : ''
    setDialog({ mode, value })
  }
  function submitDialog() {
    if (!dialog) return
    if (dialog.mode === 'delete') {
      if (profiles.length <= 1) { setDialog(null); return }
      const remaining = profiles.filter(p => p.id !== activeProfileId)
      const next = remaining[0]
      const outgoing = { ...activeProfile, loadouts: clone(loadouts), skinSettings: clone(skinSettings), equipment: clone(equipment), weaponSlots: clone(weaponSlots) }
      setProfiles(remaining.map(p => p.id === outgoing.id ? outgoing : p))
      setActiveProfileId(next.id); setLoadouts(clone(next.loadouts)); setSkinSettings(clone(next.skinSettings)); setEquipment(clone(next.equipment)); setWeaponSlots(clone(next.weaponSlots ?? emptyWeaponSlots))
      resetTransient()
    } else if (dialog.mode === 'clear') {
      const nextLoadouts = { ...loadouts, [team]: {} }
      const nextEquipment = { ...equipment, [team]: { ...emptyTeamEquipment } }
      setLoadouts(nextLoadouts)
      setEquipment(nextEquipment)
      syncActiveProfile({ loadouts: nextLoadouts, skinSettings, equipment: nextEquipment })
      setPickerSearch(''); setEquipmentSearch('')
    } else {
      const name = dialog.value.trim()
      if (!name) return
      if (dialog.mode === 'rename') {
        setProfiles(prev => prev.map(p => p.id === activeProfileId ? { ...p, name } : p))
      } else {
        const next: LoadoutProfile = {
          id: profileId(), name,
          loadouts: dialog.mode === 'duplicate' ? clone(loadouts) : clone(emptyLoadouts),
          skinSettings: dialog.mode === 'duplicate' ? clone(skinSettings) : clone(emptySettings),
          equipment: dialog.mode === 'duplicate' ? clone(equipment) : clone(emptyEquipment),
          weaponSlots: dialog.mode === 'duplicate' ? clone(weaponSlots) : clone(emptyWeaponSlots),
        }
        const outgoing = { ...activeProfile, loadouts: clone(loadouts), skinSettings: clone(skinSettings), equipment: clone(equipment), weaponSlots: clone(weaponSlots) }
        setProfiles(prev => [...prev.map(p => p.id === outgoing.id ? outgoing : p), next])
        setActiveProfileId(next.id); setLoadouts(clone(next.loadouts)); setSkinSettings(clone(next.skinSettings)); setEquipment(clone(next.equipment)); setWeaponSlots(clone(next.weaponSlots ?? emptyWeaponSlots))
        resetTransient()
      }
    }
    setDialog(null)
  }
  function assignSlotWeapon(category: string, slotIndex: number, nextWeapon: string) {
    const previousWeapon = weaponSlots[team][category]?.[slotIndex] ?? null
    if (previousWeapon === nextWeapon) return
    const occupied = (weaponSlots[team][category] ?? []).some((weapon, index) => index !== slotIndex && weapon === nextWeapon)
    if (occupied) return
    const nextSlots = { ...weaponSlots, [team]: { ...weaponSlots[team], [category]: (weaponSlots[team][category] ?? []).map((weapon, index) => index === slotIndex ? nextWeapon : weapon) } }
    const nextLoadouts = { ...loadouts, [team]: { ...loadouts[team] } }
    if (previousWeapon && !(nextSlots[team][category] ?? []).includes(previousWeapon)) delete nextLoadouts[team][previousWeapon]
    setWeaponSlots(nextSlots); setLoadouts(nextLoadouts)
    syncActiveProfile({ loadouts: nextLoadouts, skinSettings, equipment, weaponSlots: nextSlots })
  }
  function selectedSkin(weapon: string) { return skins.find(s => s.id === currentLoadout[weapon]) }
  function selectedItem(slot: EquipmentSlot) { return skins.find(s => s.id === currentEquipment[slot]) }
  function placeholder(weapon: string) { const s = skins.find(x => x.weapon.toLowerCase() === weapon.toLowerCase()); return s ? imageOf(s) : '' }
  const weaponSkins = useMemo(() => {
    if (!activeWeapon) return []
    const q = pickerSearch.trim().toLowerCase()
    const matches = skins.filter(s => s.weapon.toLowerCase() === activeWeapon.toLowerCase() && (!q || `${s.name} ${s.rarity} ${s.type} ${s.description || ''} ${s.color || ''}`.toLowerCase().includes(q)))
    const rarityRank = (rarity: string) => ({ 'Covert': 7, 'Extraordinary': 7, 'Classified': 6, 'Exotic': 6, 'Restricted': 5, 'Remarkable': 5, 'Mil-Spec Grade': 4, 'High Grade': 4, 'Industrial Grade': 3, 'Distinguished': 3, 'Consumer Grade': 2, 'Base Grade': 1 } as Record<string, number>)[rarity] ?? 0
    const popularNames = ['dragon lore','howl','fade','asiimov','redline','medusa','fire serpent','wild lotus','printstream','the empress','neo-noir','kill confirmed','desert eagle | blaze','doppler','marble fade','case hardened','lore','tiger tooth','vulcan','hyper beast','cyrex','nightwish','head shot','asiimov']
    return matches.sort((a, b) => {
      if (skinSort === 'az') return a.name.localeCompare(b.name)
      if (skinSort === 'rarity') return rarityRank(b.rarity) - rarityRank(a.rarity) || a.name.localeCompare(b.name)
      const score = (s: Skin) => { const n = `${s.weapon} | ${s.name}`.toLowerCase(); const i = popularNames.findIndex(term => n.includes(term)); return i < 0 ? 999 : i }
      return score(a) - score(b) || rarityRank(b.rarity) - rarityRank(a.rarity) || a.name.localeCompare(b.name)
    })
  }, [skins, activeWeapon, pickerSearch, skinSort])
  const equipmentChoices = useMemo(() => {
    if (!activeEquipment) return []
    const q = equipmentSearch.trim().toLowerCase()
    const rarityRank = (rarity: string) => ({
      'Contraband': 9, 'Extraordinary': 8, 'Covert': 7, 'Exotic': 7,
      'Classified': 6, 'Restricted': 5, 'Remarkable': 5,
      'Mil-Spec Grade': 4, 'Mil-Spec': 4, 'High Grade': 4,
      'Industrial Grade': 3, 'Distinguished': 3, 'Consumer Grade': 2, 'Base Grade': 1,
    } as Record<string, number>)[rarity] ?? 0
    const popularNames = ['dragon lore', 'howl', 'fade', 'asiimov', 'redline', 'medusa', 'fire serpent', 'wild lotus', 'printstream', 'the empress', 'neo-noir', 'kill confirmed', 'blaze', 'doppler', 'marble fade', 'case hardened', 'lore', 'tiger tooth', 'vulcan', 'hyper beast', 'cyrex', 'nightwish', 'head shot']
    const matches = skins.filter(s => {
      if (equipmentCategory(s) !== activeEquipment) return false
      if (activeEquipment === 'agent' && !agentForTeam(s, team)) return false
      return (!q || `${s.weapon} ${s.name} ${s.type} ${s.rarity} ${s.description || ''} ${s.color || ''}`.toLowerCase().includes(q))
    })
    const filtered = equipmentWeaponFilter === 'All' ? matches : matches.filter(item => item.weapon === equipmentWeaponFilter)
    return filtered.sort((a, b) => {
      if (equipmentSort === 'az') return a.name.localeCompare(b.name) || a.weapon.localeCompare(b.weapon)
      if (equipmentSort === 'rarity') return rarityRank(b.rarity) - rarityRank(a.rarity) || a.name.localeCompare(b.name)
      const score = (item: Skin) => {
        const name = `${item.weapon} | ${item.name}`.toLowerCase()
        const index = popularNames.findIndex(term => name.includes(term))
        return index < 0 ? 999 : index
      }
      return score(a) - score(b) || rarityRank(b.rarity) - rarityRank(a.rarity) || a.name.localeCompare(b.name)
    })
  }, [skins, activeEquipment, team, equipmentSearch, equipmentSort, equipmentWeaponFilter])

  function equipSkin(weapon: string, id: SkinId | null) {
    const nextLoadouts = { ...loadouts, [team]: { ...loadouts[team], [weapon]: id } }
    let nextSkinSettings = skinSettings
    if (id !== null) {
      const s = skins.find(x => x.id === id), key = settingsKey(weapon, id)
      nextSkinSettings = { ...skinSettings, [team]: { ...skinSettings[team], [key]: skinSettings[team][key] ?? defaults(s) } }
      setSkinSettings(nextSkinSettings)
    }
    setLoadouts(nextLoadouts)
    syncActiveProfile({ loadouts: nextLoadouts, skinSettings: nextSkinSettings, equipment })
    if (id !== null) {
      const chosen = skins.find(x => x.id === id)
      const configured = nextSkinSettings[team][settingsKey(weapon, id)] ?? defaults(chosen)
      setActiveWeapon(weapon)
      setFloatDraft(configured.float.toFixed(6))
      setSeedDraft(String(configured.seed))
      setPickerOpen(false)
      setSettingsOpen(true)
    } else {
      setPickerOpen(false)
      setActiveWeapon(null)
    }
    setPickerSearch('')
  }
  function equipItem(slot: EquipmentSlot, id: SkinId | null) {
    const nextEquipment = { ...equipment, [team]: { ...equipment[team], [slot]: id } }
    setEquipment(nextEquipment)
    syncActiveProfile({ loadouts, skinSettings, equipment: nextEquipment })
    setActiveEquipment(null); setEquipmentSearch('')
  }
  function openPicker(weapon: string, category?: string, index?: number) { setActiveWeapon(weapon); setActiveSlotContext(category && index !== undefined ? { category, index } : null); setPickerSearch(''); setSkinSort('popular'); setPickerOpen(true); setSettingsOpen(false); setActiveEquipment(null) }
  function openItemDetails(weapon: string) { const skin = selectedSkin(weapon); if (!skin) { openPicker(weapon); return } const value = skinSettings[team][settingsKey(weapon, skin.id)] ?? defaults(skin); setActiveWeapon(weapon); setFloatDraft(value.float.toFixed(6)); setSeedDraft(String(value.seed)); setSettingsOpen(true); setPickerOpen(false); setActiveEquipment(null) }
  function openEquipmentPicker(slot: EquipmentSlot) { setEquipmentSearch(''); setEquipmentSort('popular'); setEquipmentWeaponFilter('All'); setActiveEquipment(slot); setPickerOpen(false); setSettingsOpen(false) }
  function saveSettings() {
    if (!activeWeapon) return
    const s = selectedSkin(activeWeapon)
    if (!s) return
    const l = limits(s), f = Number(floatDraft), rawSeed = Number(seedDraft)
    if (!Number.isFinite(f) || !Number.isFinite(rawSeed)) return
    const value = Math.min(l.max, Math.max(l.min, f)), seed = Math.min(1000, Math.max(0, Math.round(rawSeed)))
    const key = settingsKey(activeWeapon, s.id)
    const nextSkinSettings = { ...skinSettings, [team]: { ...skinSettings[team], [key]: { float: Number(value.toFixed(6)), seed } } }
    setSkinSettings(nextSkinSettings)
    syncActiveProfile({ loadouts, skinSettings: nextSkinSettings, equipment })
    setSettingsOpen(false)
  }
  const activeSkin = activeWeapon ? selectedSkin(activeWeapon) : undefined
  const activeSettingsKey = activeWeapon && activeSkin ? settingsKey(activeWeapon, activeSkin.id) : ''
  const activeSettings = activeSkin ? skinSettings[team][activeSettingsKey] ?? defaults(activeSkin) : null
  const activeLimits = limits(activeSkin)
  const activeEquipmentTitle = activeEquipment ? EQUIPMENT_INFO[activeEquipment].title : ''
  const totalEquipped = equippedCountT + equippedCountCT
  const savedFloatSeedCount = Object.keys(skinSettings.T).length + Object.keys(skinSettings.CT).length

  const activeCount = team === 'T' ? equippedCountT : equippedCountCT
  return <div className="obsidian-shell obsidian-shell-redesign loadout-redesign">
    <aside className="ob-line-sidebar" aria-label="Loadout navigation">
      <a className="ob-line-brand" href="#home" onClick={event => { event.preventDefault(); setPage('home'); setActiveNavIndex(0) }} aria-label="n1ssan Home"><img src={n1ssanLogo} alt="n1ssan" /></a>
      <LineSidebar key={activeNavIndex} className="ob-line-nav" items={['Home','Loadout','Diagnostics']} accentColor="#4f8fe8" textColor="#a1a1aa" markerColor="#34445d" showIndex showMarker proximityRadius={100} maxShift={30} falloff="smooth" markerLength={60} markerGap={0} tickScale={0.5} scaleTick itemGap={20} fontSize={1.1} smoothing={100} defaultActive={activeNavIndex} onItemClick={index => { setActiveNavIndex(index); setPage(index === 0 ? 'home' : index === 1 ? 'loadout' : 'diagnostics') }} />
      <div className="ob-line-sidebar-foot"><span className="armory-status-dot" /><span>{runtimeStatus.tone === 'error' ? 'ATTENTION' : 'LOADOUT READY'}</span></div>
    </aside>
    <main className={`ob-main loadout-main ${page === 'home' ? 'home-mode' : ''}`} id={page}>
      {page === 'home' ? <section className="ob-cinematic-home loadout-cinematic-home">
        <div className="ob-cinematic-copy"><div className="ob-cinematic-kicker"><span /> COUNTER-STRIKE 2 · PERSONAL LOADOUT</div><h1>Every CS2 skin.<br/><span>In a click.</span></h1>
          <ShimmerButton shimmerColor="#75aaff" shimmerSize="0.08em" shimmerDuration="3s" borderRadius="9999px" background="#050508" onClick={() => { setPage('loadout'); setActiveNavIndex(1) }} className="ob-initiate-specular"><span>Initiate</span><span aria-hidden="true" className="ob-initiate-arrow">↗</span></ShimmerButton>
        </div>
        <div className="ob-rickshaw-stage" aria-hidden="true"><img src={rickshawImage} alt="" /></div><div className="ob-home-index">N1 / LOADOUT SYSTEM <span>—</span> 001</div>
      </section> : page === 'loadout' ? <>
        <div className="ob-breadcrumb"><span>WORKSPACE</span><b>/</b><strong>LOADOUT</strong></div>
        <section className="ob-heading loadout-heading"><div><h1>Your Loadout<span>.</span></h1><p>Build your five-slot CS2 weapon selection for each side.</p></div>
          <div className="ob-heading-actions"><div className="profile-select-label"><span>SELECTED LOADOUT PROFILE</span><ObsidianDropdown ariaLabel="Selected Loadout profile" className="profile-dropdown" value={activeProfileId} options={profiles.map(p => ({value:p.id,label:p.name}))} onChange={switchProfile}/></div>
            <button className="ob-button secondary" onClick={() => setProfileManagerOpen(true)}>Manage profiles <span>⌄</span></button><button className="ob-button shimmer-button" onClick={applyLoadout} disabled={applying}>{applying ? 'Applying…' : 'Apply to CS2'} <span>↗</span></button>
          </div>
        </section>
        <section className="loadout-control-strip"><div className="loadout-team-switch">{(['T','CT'] as Team[]).map(side => <button key={side} type="button" className={team === side ? 'active' : ''} onClick={() => { setTeam(side); setPickerSearch(''); setEquipmentSearch('') }}><img src={TEAM_IMAGES[side]} alt=""/><span><strong>{side === 'T' ? 'TERRORIST' : 'COUNTER-TERRORIST'}</strong><small>{side === 'T' ? 'Attacker side' : 'Defender side'}</small></span></button>)}</div>
          <div className="loadout-control-actions"><span className="loadout-equipped-count"><strong>{activeCount}</strong> / 18 equipped</span><button className="ob-button secondary" onClick={() => openDialog('clear')}>Clear {team} side</button></div>
        </section>
        <section className="loadout-four-column-grid">
          <article className="loadout-category-column equipment-column"><header><span>01</span><h2>Equipment</h2><small>3 SLOTS</small></header><div className="loadout-slot-list">{(['agent','knife','gloves'] as EquipmentSlot[]).map((slot,index) => { const item = selectedItem(slot), info = EQUIPMENT_INFO[slot]; return <button type="button" className={`loadout-slot-card ${item ? 'is-filled' : ''}`} key={slot} onClick={() => openEquipmentPicker(slot)}><span className="loadout-slot-index">0{index+1}</span><span className="loadout-slot-art">{item && imageOf(item) ? <img src={imageOf(item)} alt=""/> : <i>{info.icon}</i>}</span><span className="loadout-slot-copy"><strong>{slot === 'agent' ? `${team} Agent` : info.title}</strong><small>{item ? item.name : 'Select equipment'}</small></span><span className="loadout-slot-action">{item ? 'EDIT' : '+'}</span></button>})}</div></article>
          {columns.map((column,columnIndex) => <article className="loadout-category-column" key={column.title}><header><span>0{columnIndex+2}</span><h2>{column.title === 'MID-TIER' ? 'Mid-Tier' : column.title.charAt(0)+column.title.slice(1).toLowerCase()}</h2></header>
            <div className="loadout-slot-list">{Array.from({length:5},(_,slotIndex) => { const weapon = weaponSlots[team][column.title]?.[slotIndex] ?? null; const skin = weapon ? selectedSkin(weapon) : undefined; const image = skin ? imageOf(skin) : weapon ? placeholder(weapon) : ''; const st = skin && weapon ? skinSettings[team][settingsKey(weapon,skin.id)] ?? defaults(skin) : null;
              return <button type="button" className={\`loadout-slot-card weapon-slot \${skin ? 'is-filled' : ''}\`} key={\`\${column.title}-\${slotIndex}\`} onClick={() => weapon ? openItemDetails(weapon) : openPicker(column.weapons[slotIndex] ?? column.weapons[0],column.title,slotIndex)} aria-label={skin && weapon ? \`View details for \${weapon} \${skin.name}\` : \`Choose skin for slot \${slotIndex+1}\`}><span className="loadout-slot-index">0{slotIndex+1}</span><span className="loadout-slot-art">{image ? <img src={image} alt=""/> : <i>＋</i>}</span>
                <span className="loadout-slot-copy"><strong>{weapon ?? 'Choose weapon'}</strong><small>{skin ? skin.name : weapon ? 'No finish selected' : 'Choose a weapon'}</small>{st && <small className="loadout-slot-meta">FLOAT {st.float.toFixed(5)} · SEED {st.seed}</small>}</span></button></div>})}</div></article>)}
        </section><p className="loadout-save-note">Selections are saved locally by profile. Only the five assigned weapon positions per category are sent to CS2.</p>
      </> : <section className="loadout-diagnostics"><div className="ob-breadcrumb"><span>WORKSPACE</span><b>/</b><strong>DIAGNOSTICS</strong></div><h1>Diagnostics<span>.</span></h1><p>Read-only overview of your Loadout configuration and local profile data.</p><div className="loadout-diagnostic-grid"><article><small>SKIN CATALOGUE</small><strong>{skins.length.toLocaleString()}</strong></article><article><small>SAVED PROFILES</small><strong>{profiles.length}</strong></article><article><small>EQUIPPED ITEMS</small><strong>{totalEquipped}</strong></article><article><small>FLOAT / SEED RECORDS</small><strong>{savedFloatSeedCount}</strong></article></div><div className="loadout-diagnostic-panel"><strong>Bridge status</strong><span>{runtimeStatus.text || 'Not queried from this page.'}</span></div></section>}
          {profileManagerOpen && <div className="lb-modal-backdrop" onClick={() => setProfileManagerOpen(false)}><section className="lb-modal ob-dialog lb-confirm-modal loadout-profile-manager" role="dialog" aria-modal="true" aria-label="Manage Loadout profiles" onClick={e => e.stopPropagation()}><div className="lb-modal-header dialog-head"><div><p className="lb-eyebrow">PROFILE MANAGER</p><h3>Manage profiles.</h3></div><button className="lb-close-button" type="button" onClick={() => setProfileManagerOpen(false)} aria-label="Close profile manager">×</button></div><div className="loadout-profile-list">{profiles.map(profile => <div className={profile.id === activeProfileId ? 'loadout-profile-row current' : 'loadout-profile-row'} key={profile.id}><button type="button" className="loadout-profile-select" onClick={() => switchProfile(profile.id)}><span className="loadout-profile-radio">{profile.id === activeProfileId && <i/>}</span><span><strong>{profile.name}</strong><small>{Object.values(profile.loadouts).reduce((n,side) => n + Object.values(side).filter(id => id !== null).length,0)} weapon finishes · {profile.id === activeProfileId ? 'Active profile' : 'Saved profile'}</small></span></button>{profile.id === activeProfileId && <span className="loadout-profile-current">ACTIVE</span>}</div>)}</div><div className="loadout-profile-actions"><button className="ob-button shimmer-button" onClick={() => { setProfileManagerOpen(false); openDialog('create') }}>New profile ＋</button><button className="ob-button secondary" onClick={() => { setProfileManagerOpen(false); openDialog('duplicate') }}>Duplicate</button><button className="ob-button secondary" onClick={() => { setProfileManagerOpen(false); openDialog('rename') }}>Rename</button><button className="ob-button secondary" disabled={profiles.length <= 1} onClick={() => { setProfileManagerOpen(false); openDialog('delete') }}>Delete</button></div></section></div>}

    {pickerOpen && activeWeapon && <div className="lb-modal-backdrop" onClick={() => setPickerOpen(false)}><div className="lb-modal ob-dialog lb-skin-picker-modal" role="dialog" aria-modal="true" aria-label={`Choose a skin for ${activeWeapon}`} onClick={e => e.stopPropagation()}>
      <div className="lb-modal-header dialog-head"><div><p className="lb-eyebrow">SKIN PICKER</p><h3>{activeWeapon}</h3><p className="lb-modal-subtitle">{weaponSkins.length} matching {weaponSkins.length === 1 ? 'skin' : 'skins'} · Search and sort finishes</p></div><button className="lb-close-button" type="button" onClick={() => { setPickerOpen(false); setPickerSearch('') }} aria-label="Close skin picker">×</button></div>
      {activeSlotContext && <div className="loadout-picker-tabs" role="tablist" aria-label={`${activeSlotContext.category} weapons`}>{(columns.find(column => column.title === activeSlotContext.category)?.weapons ?? []).map(weapon => <button type="button" role="tab" aria-selected={weapon === activeWeapon} className={weapon === activeWeapon ? 'active' : ''} key={weapon} onClick={() => { assignSlotWeapon(activeSlotContext.category, activeSlotContext.index, weapon); setActiveWeapon(weapon); setPickerSearch('') }}>{weapon}</button>)}</div>}
      <div className="lb-picker-controls lb-skin-picker-controls"><input className="lb-search" type="search" placeholder={`Search ${activeWeapon} skins...`} value={pickerSearch} onChange={e => setPickerSearch(e.target.value)} aria-label={`Search ${activeWeapon} skins`} /><label className="lb-sort-control"><span>Sort by</span><select value={skinSort} onChange={e => setSkinSort(e.target.value as 'rarity' | 'az' | 'popular')}><option value="rarity">Rarity</option><option value="az">A–Z</option><option value="popular">Popular</option></select></label></div>
      <div className="lb-picker-grid">{weaponSkins.map(s => <button key={s.id} type="button" className={`lb-picker-card ${currentLoadout[activeWeapon] === s.id ? 'selected' : ''}`} onClick={() => equipSkin(activeWeapon, s.id)}><div className="lb-picker-image"><img src={imageOf(s)} alt={s.name} /></div><strong>{s.name}</strong><small className="lb-rarity-label" style={{ color: rarityColor(s.rarity), backgroundColor: `${rarityColor(s.rarity)}18`, borderColor: `${rarityColor(s.rarity)}70` }}>{s.rarity}</small></button>)}</div>
      {!weaponSkins.length && <div className="lb-empty"><p>{pickerSearch ? 'No skins match your search.' : 'No skins for this weapon are in your catalogue yet.'}</p></div>}
      {currentLoadout[activeWeapon] != null && <button className="lb-unequip-button" type="button" onClick={() => equipSkin(activeWeapon, null)}>Unequip skin</button>}
    </div></div>}

    {activeEquipment && <div className="lb-modal-backdrop" onClick={() => setActiveEquipment(null)}><div className="lb-modal ob-dialog" role="dialog" aria-modal="true" aria-label={`Choose ${activeEquipmentTitle}`} onClick={e => e.stopPropagation()}>
      <div className="lb-modal-header dialog-head"><div><p className="lb-eyebrow">{team === 'T' ? 'TERRORIST LOADOUT' : 'COUNTER-TERRORIST LOADOUT'}</p><h3>Choose {activeEquipmentTitle}</h3><p className="lb-modal-subtitle">{equipmentChoices.length} available {activeEquipmentTitle.toLowerCase()}{equipmentChoices.length === 1 ? '' : 's'}{activeEquipment === 'agent' ? ` for ${team}` : ''}</p></div><button className="lb-close-button" type="button" onClick={() => setActiveEquipment(null)} aria-label="Close equipment picker">×</button></div>
      <input className="lb-search lb-equipment-search" type="search" placeholder={`Search ${activeEquipmentTitle.toLowerCase()}...`} value={equipmentSearch} onChange={e => setEquipmentSearch(e.target.value)} aria-label={`Search ${activeEquipmentTitle}`} />
      <div className="lb-picker-controls lb-equipment-picker-controls"><label className="lb-sort-control"><span>Sort by</span><select value={equipmentSort} onChange={e => setEquipmentSort(e.target.value as 'rarity' | 'az' | 'popular')}><option value="rarity">Rarity</option><option value="az">A–Z</option><option value="popular">Popular</option></select></label></div>
      {activeEquipment !== 'agent' && <div className="loadout-picker-tabs equipment-tabs" role="tablist" aria-label={`${activeEquipmentTitle} filters`}><button type="button" role="tab" aria-selected={equipmentWeaponFilter === 'All'} className={equipmentWeaponFilter === 'All' ? 'active' : ''} onClick={() => setEquipmentWeaponFilter('All')}>All</button>{[...new Set(skins.filter(item => equipmentCategory(item) === activeEquipment).map(item => item.weapon))].sort().map(weapon => <button type="button" role="tab" aria-selected={equipmentWeaponFilter === weapon} className={equipmentWeaponFilter === weapon ? 'active' : ''} key={weapon} onClick={() => setEquipmentWeaponFilter(weapon)}>{weapon}</button>)}</div>}
      <div className="lb-picker-grid">{equipmentChoices.map(item => <button key={item.id} type="button" className={`lb-picker-card ${currentEquipment[activeEquipment] === item.id ? 'selected' : ''}`} onClick={() => equipItem(activeEquipment, item.id)}><div className="lb-picker-image">{imageOf(item) ? <img src={imageOf(item)} alt={item.name} loading="lazy" /> : <span>{item.weapon}</span>}</div><strong>{item.name}</strong><small>{item.weapon}</small><small className="lb-rarity-label" style={{ color: rarityColor(item.rarity), backgroundColor: `${rarityColor(item.rarity)}18`, borderColor: `${rarityColor(item.rarity)}70` }}>{item.rarity}</small></button>)}</div>
      {!equipmentChoices.length && <div className="lb-empty"><h3>No matching items</h3><p>Try another search or check the generated catalogue's item categories.</p></div>}
      {currentEquipment[activeEquipment] !== null && <button className="lb-unequip-button" type="button" onClick={() => equipItem(activeEquipment, null)}>Unequip {activeEquipmentTitle.toLowerCase()}</button>}
    </div></div>}

    {settingsOpen && activeWeapon && activeSkin && activeSettings && <div className="lb-modal-backdrop" onClick={() => setSettingsOpen(false)}><div className="lb-modal ob-dialog lb-settings-modal" role="dialog" aria-modal="true" aria-label={`Configure item for ${activeWeapon}`} onClick={e => e.stopPropagation()}>
      <div className="lb-modal-header dialog-head"><div><p className="lb-eyebrow">ITEM DETAILS</p><h3>{activeWeapon} | {activeSkin.name}</h3><p className="lb-modal-subtitle">Inspect this finish and adjust its paint values.</p></div><button className="lb-close-button" type="button" onClick={() => setSettingsOpen(false)} aria-label="Close skin settings">×</button></div>
      <div className="lb-settings-summary"><img src={imageOf(activeSkin)} alt={activeSkin.name} /><div><strong>{activeSkin.name}</strong><span>{activeSkin.weapon} · {activeSkin.rarity}</span><small>Wear: {wear(Number(floatDraft) || activeSettings.float)} · Pattern seed {Math.max(0, Math.min(1000, Math.round(Number(seedDraft) || 0)))}</small></div></div>
      <div className="lb-setting-field"><div className="lb-setting-label"><label htmlFor="lb-float">Float value</label><strong>{Number(floatDraft || 0).toFixed(6)}</strong></div><input id="lb-float" className="lb-float-slider" type="range" min={activeLimits.min} max={activeLimits.max} step="0.000001" value={Math.min(activeLimits.max, Math.max(activeLimits.min, Number(floatDraft) || activeLimits.min))} onChange={e => setFloatDraft(e.target.value)} /><div className="lb-range-labels"><span>Min {activeLimits.min.toFixed(6)}</span><span>Max {activeLimits.max.toFixed(6)}</span></div><input className="lb-number-input" aria-label="Exact float value" type="number" min={activeLimits.min} max={activeLimits.max} step="0.000001" value={floatDraft} onChange={e => setFloatDraft(e.target.value)} /><small className="lb-field-help">Float limits are specific to each finish when available. Missing limits fall back to 0.000000–1.000000.</small></div>
      <div className="lb-setting-field"><div className="lb-setting-label"><label htmlFor="lb-seed">Pattern seed</label><strong>{Math.max(0, Math.min(1000, Math.round(Number(seedDraft) || 0)))}</strong></div><input id="lb-seed" className="lb-number-input" type="number" min="0" max="1000" step="1" value={seedDraft} onChange={e => setSeedDraft(e.target.value)} /><input className="lb-seed-slider" aria-label="Pattern seed slider" type="range" min="0" max="1000" step="1" value={Math.max(0, Math.min(1000, Math.round(Number(seedDraft) || 0)))} onChange={e => setSeedDraft(e.target.value)} /><div className="lb-range-labels"><span>Seed 0</span><span>Seed 1000</span></div><small className="lb-field-help">Seed is stored for this skin, but does not change its static image.</small></div>
      <div className="lb-settings-actions"><button type="button" className="lb-unequip-button" onClick={() => { setSettingsOpen(false); openPicker(activeWeapon) }}>Change skin</button><button type="button" className="lb-save-settings-button" onClick={saveSettings}>Done</button></div>
    </div></div>}

    {dialog && <div className="lb-modal-backdrop lb-dialog-backdrop" onClick={() => setDialog(null)}><form className="lb-modal ob-dialog lb-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="lb-dialog-title" onSubmit={e => { e.preventDefault(); submitDialog() }} onClick={e => e.stopPropagation()}>
      <div className="lb-modal-header dialog-head"><div><p className="lb-eyebrow">{dialog.mode === 'clear' || dialog.mode === 'delete' ? 'CONFIRM ACTION' : 'PROFILE MANAGER'}</p><h3 id="lb-dialog-title">{dialog.mode === 'create' ? 'Create a profile' : dialog.mode === 'duplicate' ? 'Duplicate profile' : dialog.mode === 'rename' ? 'Rename profile' : dialog.mode === 'delete' ? 'Delete this profile?' : 'Clear this loadout?'}</h3></div><button className="lb-close-button" type="button" onClick={() => setDialog(null)} aria-label="Close dialog">×</button></div>
      {dialog.mode === 'create' || dialog.mode === 'duplicate' || dialog.mode === 'rename' ? <><label className="lb-dialog-label" htmlFor="lb-profile-name">PROFILE NAME</label><input id="lb-profile-name" className="lb-dialog-input" autoFocus maxLength={48} value={dialog.value} placeholder="Enter a profile name" onChange={e => setDialog({ ...dialog, value: e.target.value })} /><p className="lb-dialog-help">{dialog.mode === 'create' ? 'Start with an empty T and CT loadout.' : dialog.mode === 'duplicate' ? 'Copy the current T and CT loadouts, equipment, floats, and seeds.' : 'Your saved items will stay exactly as they are.'}</p></> : <p className="lb-dialog-message">{dialog.mode === 'delete' ? <>Delete <strong>{activeProfile.name}</strong>? Its saved T and CT loadouts will be deleted. This cannot be undone.</> : <>Clear the <strong>{team === 'T' ? 'Terrorist' : 'Counter-Terrorist'}</strong> loadout for <strong>{activeProfile.name}</strong>? This removes equipped weapon skins and equipment for this team only.</>}</p>}
      <div className="lb-dialog-actions"><button type="button" className="lb-dialog-cancel" onClick={() => setDialog(null)}>Cancel</button><button type="submit" className={`lb-dialog-confirm ${dialog.mode === 'delete' || dialog.mode === 'clear' ? 'danger' : ''}`} disabled={['create', 'duplicate', 'rename'].includes(dialog.mode) && !dialog.value.trim()}>{dialog.mode === 'create' ? 'Create profile' : dialog.mode === 'duplicate' ? 'Duplicate profile' : dialog.mode === 'rename' ? 'Save name' : dialog.mode === 'delete' ? 'Delete profile' : 'Clear loadout'}</button></div>
    </form></div>}
    </main>
  </div>
}
