import { useEffect, useMemo, useState } from 'react'
import './LoadoutBuilder.css'
import { findImageColorMatches } from './skinColorDetection'
import { readArmoryDocument } from './armory/bridge-client'
import { readArmoryEquipment, writeArmoryEquipment } from './armory/equipment-client'
import { buildProfileEquipmentAssignments, replaceProfileEquipmentAssignments, resolveProfileEquipmentSelections } from './armory/loadout-adapter'

type Skin = {
  id: number; weapon: string; name: string; type: string; rarity: string
  color: string; art: string; description: string; image?: string
  minFloat?: number | null; maxFloat?: number | null
}
type Team = 'T' | 'CT'
type SavedLoadouts = Record<Team, Record<string, number | null>>
type SkinSettings = { seed: number; float: number }
type SavedSkinSettings = Record<Team, Record<string, SkinSettings>>
type EquipmentSlot = 'agent' | 'knife' | 'gloves' | 'zeus'
type TeamEquipment = Record<EquipmentSlot, number | null>
type SavedEquipment = Record<Team, TeamEquipment>
type LoadoutBuilderProps = { skins: Skin[] }
type WeaponColumn = { title: string; subtitle: string; weapons: string[] }
type LoadoutProfile = { id: string; name: string; loadouts: SavedLoadouts; skinSettings: SavedSkinSettings; equipment: SavedEquipment }
type DialogState = { mode: 'create' | 'duplicate' | 'rename' | 'delete' | 'clear'; value: string } | null

const STORAGE_KEY = 'n1ssan-loadouts-v1'
const SETTINGS_STORAGE_KEY = 'n1ssan-skin-settings-v1'
const EQUIPMENT_STORAGE_KEY = 'n1ssan-equipment-v1'
const PROFILES_STORAGE_KEY = 'n1ssan-loadout-profiles-v1'
const ACTIVE_PROFILE_STORAGE_KEY = 'n1ssan-active-loadout-profile-v1'
const COLOR_OPTIONS = [
  { name: 'Red', hex: '#e34b4b' }, { name: 'Orange', hex: '#ee8b36' }, { name: 'Yellow', hex: '#e6c94b' },
  { name: 'Green', hex: '#49b96b' }, { name: 'Cyan', hex: '#45c6d4' }, { name: 'Blue', hex: '#4d82e8' },
  { name: 'Purple', hex: '#a16be0' }, { name: 'Pink', hex: '#e879b6' }, { name: 'Brown', hex: '#9b6c4c' },
  { name: 'White', hex: '#e8e8e8' }, { name: 'Gray', hex: '#8c9298' }, { name: 'Black', hex: '#252729' },
]
const emptyLoadouts: SavedLoadouts = { T: {}, CT: {} }
const emptySettings: SavedSkinSettings = { T: {}, CT: {} }
const emptyTeamEquipment: TeamEquipment = { agent: null, knife: null, gloves: null, zeus: null }
const emptyEquipment: SavedEquipment = { T: { ...emptyTeamEquipment }, CT: { ...emptyTeamEquipment } }

const TEAM_WEAPONS: Record<Team, WeaponColumn[]> = {
  T: [
    { title: 'PISTOLS', subtitle: 'SIDEARMS', weapons: ['Glock-18', 'Dual Berettas', 'P250', 'Tec-9', 'CZ75-Auto', 'Desert Eagle', 'R8 Revolver'] },
    { title: 'MID-TIER', subtitle: 'SMGs · SHOTGUNS · MACHINE GUNS', weapons: ['MAC-10', 'MP7', 'MP5-SD', 'UMP-45', 'P90', 'PP-Bizon', 'Nova', 'XM1014', 'Sawed-Off', 'M249', 'Negev'] },
    { title: 'RIFLES', subtitle: 'ASSAULT RIFLES', weapons: ['Galil AR', 'AK-47', 'SG 553'] },
    { title: 'SNIPERS', subtitle: 'PRECISION', weapons: ['SSG 08', 'AWP', 'G3SG1'] },
  ],
  CT: [
    { title: 'PISTOLS', subtitle: 'SIDEARMS', weapons: ['USP-S', 'P2000', 'Dual Berettas', 'P250', 'Five-SeveN', 'CZ75-Auto', 'Desert Eagle', 'R8 Revolver'] },
    { title: 'MID-TIER', subtitle: 'SMGs · SHOTGUNS · MACHINE GUNS', weapons: ['MP9', 'MP7', 'MP5-SD', 'UMP-45', 'P90', 'PP-Bizon', 'Nova', 'XM1014', 'MAG-7', 'M249', 'Negev'] },
    { title: 'RIFLES', subtitle: 'ASSAULT RIFLES', weapons: ['FAMAS', 'M4A4', 'M4A1-S', 'AUG'] },
    { title: 'SNIPERS', subtitle: 'PRECISION', weapons: ['SSG 08', 'AWP', 'SCAR-20'] },
  ],
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
function settingsKey(w: string, id: number) { return `${w}:${id}` }
function equipmentCategory(s: Skin): EquipmentSlot | null {
  const t = (s.type || '').toLowerCase(), w = (s.weapon || '').toLowerCase()
  if (t.includes('agent')) return 'agent'
  if (t.includes('glove') || w.includes('glove')) return 'gloves'
  if (w.includes('zeus') || w.includes('x27') || t.includes('zeus')) return 'zeus'
  if (t.includes('knife') || w.includes('knife')) return 'knife'
  return null
}
function agentForTeam(s: Skin, team: Team) {
  const t = (s.type || '').toLowerCase()
  return team === 'T' ? t === 't agents' : t === 'ct agents'
}
export default function LoadoutBuilder({ skins }: LoadoutBuilderProps) {
  const [profiles, setProfiles] = useState<LoadoutProfile[]>(loadProfiles)
  const [activeProfileId, setActiveProfileId] = useState(() => {
    const id = localStorage.getItem(ACTIVE_PROFILE_STORAGE_KEY)
    return profiles.some(p => p.id === id) ? id! : profiles[0].id
  })
  const initial = profiles.find(p => p.id === activeProfileId) ?? profiles[0]
  const [team, setTeam] = useState<Team>('T')
  const [pickerSearch, setPickerSearch] = useState('')
  const [pickerColor, setPickerColor] = useState('')
  const [equipmentSearch, setEquipmentSearch] = useState('')
  const [equipmentColor, setEquipmentColor] = useState('')
  const [equipmentSort, setEquipmentSort] = useState<'rarity' | 'az' | 'popular'>('popular')
  const [pickerColorMatchIds, setPickerColorMatchIds] = useState<Set<number> | null>(null)
  const [equipmentColorMatchIds, setEquipmentColorMatchIds] = useState<Set<number> | null>(null)
  const [pickerColorBusy, setPickerColorBusy] = useState(false)
  const [equipmentColorBusy, setEquipmentColorBusy] = useState(false)
  const [skinSort, setSkinSort] = useState<'rarity' | 'az' | 'popular'>('popular')
  const [activeWeapon, setActiveWeapon] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activeEquipment, setActiveEquipment] = useState<EquipmentSlot | null>(null)
  const [loadouts, setLoadouts] = useState<SavedLoadouts>(() => clone(initial.loadouts))
  const [skinSettings, setSkinSettings] = useState<SavedSkinSettings>(() => clone(initial.skinSettings))
  const [equipment, setEquipment] = useState<SavedEquipment>(() => clone(initial.equipment))
  const [floatDraft, setFloatDraft] = useState('0.000000')
  const [seedDraft, setSeedDraft] = useState('0')
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [bridgeStatus, setBridgeStatus] = useState('Not synced')
  const [bridgeSaving, setBridgeSaving] = useState(false)

  // --- Color scan: weapon picker ---
  useEffect(() => {
    if (!pickerColor || !activeWeapon) return
    let cancelled = false
    const eligible = skins.filter(s => s.weapon.toLowerCase() === activeWeapon.toLowerCase() && !!s.image)
    findImageColorMatches(eligible, pickerColor, s => s.image || '').then(ids => {
      if (!cancelled) { setPickerColorMatchIds(ids); setPickerColorBusy(false) }
    })
    return () => { cancelled = true }
  }, [skins, activeWeapon, pickerColor])
  // --- Color scan: equipment picker ---
  useEffect(() => {
    if (!equipmentColor || !activeEquipment || activeEquipment === 'agent') return
    let cancelled = false
    const eligible = skins.filter(s => equipmentCategory(s) === activeEquipment && !!s.image)
    findImageColorMatches(eligible, equipmentColor, s => s.image || '').then(ids => {
      if (!cancelled) { setEquipmentColorMatchIds(ids); setEquipmentColorBusy(false) }
    })
    return () => { cancelled = true }
  }, [skins, activeEquipment, equipmentColor])

  const activeProfile = profiles.find(p => p.id === activeProfileId) ?? profiles[0]
  const columns = TEAM_WEAPONS[team]
  const currentLoadout = loadouts[team]
  const currentEquipment = equipment[team]
  const equippedCountT = useMemo(
    () => TEAM_WEAPONS.T.flatMap(column => column.weapons).filter(weapon => loadouts.T[weapon] != null).length + Object.values(equipment.T).filter(id => id != null).length,
    [loadouts.T, equipment.T],
  )
  const equippedCountCT = useMemo(
    () => TEAM_WEAPONS.CT.flatMap(column => column.weapons).filter(weapon => loadouts.CT[weapon] != null).length + Object.values(equipment.CT).filter(id => id != null).length,
    [loadouts.CT, equipment.CT],
  )

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
        setPickerOpen(false); setSettingsOpen(false); setActiveEquipment(null)
        setProfileMenuOpen(false); setDialog(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Sync the active profile in `profiles` whenever a loadout field changes.
  // Called by the mutation helpers below. Not an effect, so it never fires
  // on every keystroke.
  function syncActiveProfile(next: { loadouts: SavedLoadouts; skinSettings: SavedSkinSettings; equipment: SavedEquipment }) {
    setBridgeStatus('Local changes not synced')
    setProfiles(prev => prev.map(p => p.id === activeProfileId ? {
      ...p, loadouts: clone(next.loadouts), skinSettings: clone(next.skinSettings), equipment: clone(next.equipment),
    } : p))
  }

  function setPickerColorFilter(next: string) {
    setPickerColor(next)
    if (next) {
      setPickerColorMatchIds(new Set())
      setPickerColorBusy(true)
    } else {
      setPickerColorMatchIds(null)
      setPickerColorBusy(false)
    }
  }
  function setEquipmentColorFilter(next: string) {
    setEquipmentColor(next)
    if (next && activeEquipment && activeEquipment !== 'agent') {
      setEquipmentColorMatchIds(new Set())
      setEquipmentColorBusy(true)
    } else {
      setEquipmentColorMatchIds(null)
      setEquipmentColorBusy(false)
    }
  }

  function resetTransient() {
    setTeam('T'); setPickerSearch(''); setPickerColor(''); setEquipmentSearch(''); setEquipmentColor(''); setSkinSort('popular')
    setActiveWeapon(null); setPickerOpen(false); setSettingsOpen(false); setActiveEquipment(null)
  }
  function switchProfile(id: string) {
    if (id === activeProfileId) return
    const next = profiles.find(p => p.id === id)
    if (!next) return
    const outgoing = { ...activeProfile, loadouts: clone(loadouts), skinSettings: clone(skinSettings), equipment: clone(equipment) }
    setProfiles(prev => prev.map(p => p.id === outgoing.id ? outgoing : p))
    setActiveProfileId(next.id)
    setLoadouts(clone(next.loadouts)); setSkinSettings(clone(next.skinSettings)); setEquipment(clone(next.equipment))
    resetTransient()
  }
  function openDialog(mode: NonNullable<DialogState>['mode']) {
    setProfileMenuOpen(false)
    const value = mode === 'rename' ? activeProfile.name : mode === 'duplicate' ? `${activeProfile.name} Copy` : ''
    setDialog({ mode, value })
  }
  function submitDialog() {
    if (!dialog) return
    if (dialog.mode === 'delete') {
      if (profiles.length <= 1) { setDialog(null); return }
      const remaining = profiles.filter(p => p.id !== activeProfileId)
      const next = remaining[0]
      const outgoing = { ...activeProfile, loadouts: clone(loadouts), skinSettings: clone(skinSettings), equipment: clone(equipment) }
      setProfiles(remaining.map(p => p.id === outgoing.id ? outgoing : p))
      setActiveProfileId(next.id); setLoadouts(clone(next.loadouts)); setSkinSettings(clone(next.skinSettings)); setEquipment(clone(next.equipment))
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
        }
        const outgoing = { ...activeProfile, loadouts: clone(loadouts), skinSettings: clone(skinSettings), equipment: clone(equipment) }
        setProfiles(prev => [...prev.map(p => p.id === outgoing.id ? outgoing : p), next])
        setActiveProfileId(next.id); setLoadouts(clone(next.loadouts)); setSkinSettings(clone(next.skinSettings)); setEquipment(clone(next.equipment))
        resetTransient()
      }
    }
    setDialog(null)
  }
  function selectedSkin(weapon: string) { return skins.find(s => s.id === currentLoadout[weapon]) }
  function selectedItem(slot: EquipmentSlot) { return skins.find(s => s.id === currentEquipment[slot]) }
  function placeholder(weapon: string) { const s = skins.find(x => x.weapon.toLowerCase() === weapon.toLowerCase()); return s ? imageOf(s) : '' }
  const weaponSkins = useMemo(() => {
    if (!activeWeapon) return []
    const q = pickerSearch.trim().toLowerCase()
    const matches = skins.filter(s => s.weapon.toLowerCase() === activeWeapon.toLowerCase() && (!q || `${s.name} ${s.rarity} ${s.type} ${s.description || ''} ${s.color || ''}`.toLowerCase().includes(q)) && (!pickerColor || !!pickerColorMatchIds?.has(s.id)))
    const rarityRank = (rarity: string) => ({ 'Covert': 7, 'Extraordinary': 7, 'Classified': 6, 'Exotic': 6, 'Restricted': 5, 'Remarkable': 5, 'Mil-Spec Grade': 4, 'High Grade': 4, 'Industrial Grade': 3, 'Distinguished': 3, 'Consumer Grade': 2, 'Base Grade': 1 } as Record<string, number>)[rarity] ?? 0
    const popularNames = ['dragon lore','howl','fade','asiimov','redline','medusa','fire serpent','wild lotus','printstream','the empress','neo-noir','kill confirmed','desert eagle | blaze','doppler','marble fade','case hardened','lore','tiger tooth','vulcan','hyper beast','cyrex','nightwish','head shot','asiimov']
    return matches.sort((a, b) => {
      if (skinSort === 'az') return a.name.localeCompare(b.name)
      if (skinSort === 'rarity') return rarityRank(b.rarity) - rarityRank(a.rarity) || a.name.localeCompare(b.name)
      const score = (s: Skin) => { const n = `${s.weapon} | ${s.name}`.toLowerCase(); const i = popularNames.findIndex(term => n.includes(term)); return i < 0 ? 999 : i }
      return score(a) - score(b) || rarityRank(b.rarity) - rarityRank(a.rarity) || a.name.localeCompare(b.name)
    })
  }, [skins, activeWeapon, pickerSearch, pickerColor, pickerColorMatchIds, skinSort])
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
      return (!q || `${s.weapon} ${s.name} ${s.type} ${s.rarity} ${s.description || ''} ${s.color || ''}`.toLowerCase().includes(q)) && (!equipmentColor || (activeEquipment !== 'agent' && !!equipmentColorMatchIds?.has(s.id)))
    })
    return matches.sort((a, b) => {
      if (equipmentSort === 'az') return a.name.localeCompare(b.name) || a.weapon.localeCompare(b.weapon)
      if (equipmentSort === 'rarity') return rarityRank(b.rarity) - rarityRank(a.rarity) || a.name.localeCompare(b.name)
      const score = (item: Skin) => {
        const name = `${item.weapon} | ${item.name}`.toLowerCase()
        const index = popularNames.findIndex(term => name.includes(term))
        return index < 0 ? 999 : index
      }
      return score(a) - score(b) || rarityRank(b.rarity) - rarityRank(a.rarity) || a.name.localeCompare(b.name)
    })
  }, [skins, activeEquipment, team, equipmentSearch, equipmentColor, equipmentColorMatchIds, equipmentSort])

  function equipSkin(weapon: string, id: number | null) {
    const nextLoadouts = { ...loadouts, [team]: { ...loadouts[team], [weapon]: id } }
    let nextSkinSettings = skinSettings
    if (id !== null) {
      const s = skins.find(x => x.id === id), key = settingsKey(weapon, id)
      nextSkinSettings = { ...skinSettings, [team]: { ...skinSettings[team], [key]: skinSettings[team][key] ?? defaults(s) } }
      setSkinSettings(nextSkinSettings)
    }
    setLoadouts(nextLoadouts)
    syncActiveProfile({ loadouts: nextLoadouts, skinSettings: nextSkinSettings, equipment })
    setPickerOpen(false); setPickerSearch('')
  }
  function equipItem(slot: EquipmentSlot, id: number | null) {
    const nextEquipment = { ...equipment, [team]: { ...equipment[team], [slot]: id } }
    setEquipment(nextEquipment)
    syncActiveProfile({ loadouts, skinSettings, equipment: nextEquipment })
    setActiveEquipment(null); setEquipmentSearch('')
  }
  function openPicker(weapon: string) { setActiveWeapon(weapon); setPickerSearch(''); setPickerColorFilter(''); setSkinSort('popular'); setPickerOpen(true); setSettingsOpen(false); setActiveEquipment(null) }
  function openEquipmentPicker(slot: EquipmentSlot) { setEquipmentSearch(''); setEquipmentColorFilter(''); setEquipmentSort('popular'); setActiveEquipment(slot); setPickerOpen(false); setSettingsOpen(false) }
  function openSettings(weapon: string) {
    const s = selectedSkin(weapon)
    if (!s) { openPicker(weapon); return }
    const current = skinSettings[team][settingsKey(weapon, s.id)] ?? defaults(s)
    setActiveWeapon(weapon); setFloatDraft(current.float.toFixed(6)); setSeedDraft(String(current.seed))
    setSettingsOpen(true); setPickerOpen(false); setActiveEquipment(null)
  }
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
  function matches() { return true }

  async function loadFromArmory() {
    if (bridgeSaving) return
    setBridgeSaving(true)
    setBridgeStatus('Loading from Armory…')
    try {
      const armory = await readArmoryDocument()
      const current = await readArmoryEquipment(armory)
      if (current.validationErrors.length) {
        throw new Error('Armory equipment needs attention before loading: ' + current.validationErrors.join('; '))
      }
      const restored = resolveProfileEquipmentSelections(current.data, activeProfile.id, skins, armory)
      setLoadouts(restored.loadouts)
      setEquipment(restored.equipment)
      syncActiveProfile({ loadouts: restored.loadouts, skinSettings, equipment: restored.equipment })
      setBridgeStatus('Loaded from Armory')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Bridge error'
      console.error('n1ssan Armory load failed:', error)
      setBridgeStatus('Load failed · ' + message)
      alert(message)
    } finally {
      setBridgeSaving(false)
    }
  }
  async function sendToBridge() {
    if (bridgeSaving) return
    setBridgeSaving(true)
    setBridgeStatus('Connecting to Armory…')
    try {
      const armory = await readArmoryDocument()
      const current = await readArmoryEquipment(armory)
      if (current.validationErrors.length) {
        throw new Error('Armory equipment needs attention before syncing: ' + current.validationErrors.join('; '))
      }
      const profileAssignments = buildProfileEquipmentAssignments({
        loadoutProfileId: activeProfile.id,
        loadouts,
        equipment,
      }, skins, armory)
      const next = replaceProfileEquipmentAssignments(current.data, activeProfile.id, profileAssignments)
      const saved = await writeArmoryEquipment(next, armory)
      const savedCount = saved.assignments.filter(item => item.loadoutProfileId === activeProfile.id).length
      setBridgeStatus('Synced · ' + savedCount + ' assignments')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Bridge error'
      console.error('n1ssan Armory sync failed:', error)
      setBridgeStatus('Sync failed · ' + message)
      alert(message)
    } finally {
      setBridgeSaving(false)
    }
  }

  const activeSkin = activeWeapon ? selectedSkin(activeWeapon) : undefined
  const activeSettingsKey = activeWeapon && activeSkin ? settingsKey(activeWeapon, activeSkin.id) : ''
  const activeSettings = activeSkin ? skinSettings[team][activeSettingsKey] ?? defaults(activeSkin) : null
  const activeLimits = limits(activeSkin)
  const activeEquipmentTitle = activeEquipment ? EQUIPMENT_INFO[activeEquipment].title : ''

  return <section className="lb-section" data-team={team}>
    <div className="lb-heading">
      <div><p className="lb-eyebrow">YOUR PERSONAL ARMORY</p><h2>Loadout Builder</h2><p className="lb-subtitle">Build your dream inventory, one skin at a time.</p></div>
      <div className="lb-progress" aria-label={`Skins equipped: Terrorists ${equippedCountT}, Counter-Terrorists ${equippedCountCT}`}>
        <div className="lb-progress-counts">
          <div className="lb-progress-team lb-progress-team-t"><strong>{equippedCountT}</strong><small>T</small></div>
          <span className="lb-progress-divider" aria-hidden="true">/</span>
          <div className="lb-progress-team lb-progress-team-ct"><strong>{equippedCountCT}</strong><small>CT</small></div>
        </div>
        <small className="lb-progress-label">SKINS EQUIPPED</small>
      </div>
    </div>

    <div className="lb-loadout-controls-row">
    <div className="lb-profiles">
      <div className="lb-profile-select-wrap">
        <label>YOUR LOADOUTS</label>
        <button type="button" className={`lb-profile-trigger ${profileMenuOpen ? 'is-open' : ''}`} aria-expanded={profileMenuOpen} onClick={() => setProfileMenuOpen(v => !v)}>
          <span className="lb-profile-avatar">N</span>
          <span className="lb-profile-trigger-copy"><strong>{activeProfile.name}</strong><small>{profiles.length} saved profile{profiles.length === 1 ? '' : 's'}</small></span>
          <span className="lb-profile-chevron">{profileMenuOpen ? '⌃' : '⌄'}</span>
        </button>
        {profileMenuOpen && <>
          <button type="button" className="lb-menu-dismiss" aria-label="Close profile menu" onClick={() => setProfileMenuOpen(false)} />
          <div className="lb-profile-menu">
            <div className="lb-profile-menu-heading"><span>SWITCH PROFILE</span><span>{profiles.length}</span></div>
            <div className="lb-profile-options">{profiles.map(p => {
              const count =
                Object.values(p.loadouts).reduce((n, t) => n + Object.values(t).filter(id => id != null).length, 0) +
                Object.values(p.equipment).reduce((n, teamEquipment) => n + Object.values(teamEquipment).filter(id => id != null).length, 0)
              return <button type="button" key={p.id} className={`lb-profile-option ${p.id === activeProfileId ? 'active' : ''}`} onClick={() => { switchProfile(p.id); setProfileMenuOpen(false) }}>
                <span className="lb-profile-option-icon">{p.id === activeProfileId ? '✓' : '▤'}</span>
                <span className="lb-profile-option-copy"><strong>{p.name}</strong><small>{count} skins equipped</small></span>
                {p.id === activeProfileId && <span className="lb-profile-current">ACTIVE</span>}
              </button>
            })}</div>
            <div className="lb-profile-menu-footer"><button type="button" onClick={() => openDialog('create')}>＋ Create new profile</button></div>
          </div>
        </>}
      </div>
      <div className="lb-profile-actions">
        <button type="button" onClick={() => openDialog('duplicate')}>Duplicate</button>
        <button type="button" onClick={() => openDialog('rename')}>Rename</button>
        <button type="button" className="lb-profile-delete" disabled={profiles.length <= 1} onClick={() => openDialog('delete')}>Delete</button>
      </div>
    </div>

    <div className="lb-team-save-row">
      <div className="lb-team-switch">
        {(['T', 'CT'] as Team[]).map(t => <button key={t} type="button" className={`lb-team-button team-${t.toLowerCase()} ${team === t ? 'active' : ''}`} onClick={() => { setTeam(t); setPickerSearch(''); setEquipmentSearch('') }}>
          <img className="lb-team-symbol" src={TEAM_IMAGES[t]} alt="" />
          <span><strong>{t === 'T' ? 'TERRORIST' : 'COUNTER-TERRORIST'}</strong><small>{t === 'T' ? 'Attacker loadout' : 'Defender loadout'}</small></span>
        </button>)}
      </div>
      <div className="lb-team-save-actions"><span className="lb-profile-status" title={bridgeStatus}><span className="lb-profile-status-dot" />{bridgeStatus}</span><button className="lb-clear-button" type="button" onClick={() => openDialog('clear')}>Clear loadout</button><button className="lb-clear-button lb-bridge-button" type="button" onClick={loadFromArmory} disabled={bridgeSaving}>Load from Armory</button><button className="lb-clear-button lb-bridge-button" type="button" onClick={sendToBridge} disabled={bridgeSaving}>{bridgeSaving ? 'Syncing…' : 'Sync to Armory'}</button></div>
    </div>
    </div>

    <div className={`lb-board lb-board-${team.toLowerCase()}`}>
      <section className="lb-equipment-column">
        <header className="lb-column-heading"><div className="lb-column-title-row"><span className="lb-column-mark">◇</span><h3>EQUIPMENT</h3></div><p>AGENT · KNIFE · GLOVES · ZEUS</p></header>
        <div className="lb-equipment-cards">{(['agent', 'knife', 'gloves', 'zeus'] as EquipmentSlot[]).map(slot => {
          const info = EQUIPMENT_INFO[slot], item = selectedItem(slot), img = item ? imageOf(item) : ''
          const label = slot === 'agent' ? `${team} Agent` : info.title
          return <div className="lb-equipment-card-wrap" key={slot}>
            <button type="button" className={`lb-weapon-card lb-equipment-card ${item ? 'is-equipped' : ''}`} onClick={() => openEquipmentPicker(slot)} aria-label={`Choose ${label}`}>
              <div className="lb-card-top"><span>{label}</span><span className="lb-slot-icon">{item ? '✓' : '+'}</span></div>
              <div className="lb-weapon-image lb-equipment-art">{img ? <img src={img} alt={item?.name || label} className="lb-equipped-image" loading="lazy" /> : <span className="lb-placeholder-label">{info.icon}</span>}<span className="lb-card-hover-action">{item ? 'CHANGE ITEM' : 'CHOOSE ITEM'}</span></div>
              <div className="lb-card-bottom lb-equipment-card-bottom">{item ? <><strong>{item.name}</strong><small>{item.weapon}</small></> : <><strong>No item equipped</strong><small>{info.subtitle}</small></>}</div>
            </button>
            {item && <button type="button" className="lb-card-remove" title={`Remove ${label}`} aria-label={`Remove ${label}`} onClick={() => equipItem(slot, null)}><span aria-hidden="true">×</span></button>}
          </div>
        })}</div>
      </section>
      {columns.map(col => {
        const visible = col.weapons.filter(matches)
        if (!visible.length) return null
        return <section className="lb-column" key={col.title}>
          <header className="lb-column-heading"><div className="lb-column-title-row"><span className="lb-column-mark">{col.title === 'PISTOLS' ? '⌁' : col.title === 'MID-TIER' ? '⌖' : col.title === 'RIFLES' ? '⌁' : '⌕'}</span><h3>{col.title}</h3></div><p>{col.subtitle}</p></header>
          <div className="lb-column-cards">{visible.map(weapon => {
            const s = selectedSkin(weapon), img = s ? imageOf(s) : placeholder(weapon)
            const st = s ? skinSettings[team][settingsKey(weapon, s.id)] ?? defaults(s) : null
            return <div key={weapon} className={`lb-weapon-card-wrap ${s ? 'is-equipped' : ''}`}>
              <button type="button" className={`lb-weapon-card ${s ? 'is-equipped' : ''}`} onClick={() => openPicker(weapon)} aria-label={`Choose a skin for ${weapon}`}>
                <div className="lb-card-top"><span>{weapon}</span><span className="lb-slot-icon">{s ? '✓' : '+'}</span></div>
                <div className="lb-weapon-image">{img ? <img src={img} alt={s ? s.name : `${weapon} placeholder`} className={s ? 'lb-equipped-image' : 'lb-placeholder-image'} /> : <span className="lb-placeholder-label">NO IMAGE YET</span>}<span className="lb-card-hover-action">{s ? 'CHANGE SKIN' : 'CHOOSE SKIN'}</span></div>
                <div className="lb-card-bottom">{s ? <><strong>{s.name}</strong><small>{s.rarity}</small></> : <><strong>No skin equipped</strong><small>{img ? 'Default preview' : 'Image unavailable'}</small></>}</div>
              </button>
              {s && st && <div className="lb-card-meta-row"><button type="button" className="lb-inspect-button" onClick={() => openSettings(weapon)}><span>FLOAT / SEED · EDIT</span><strong>{st.float.toFixed(6)}</strong><small>{wear(st.float)} · Seed {st.seed}</small></button><button type="button" className="lb-card-remove" title={`Remove ${weapon} skin`} aria-label={`Remove ${weapon} skin`} onClick={() => equipSkin(weapon, null)}><span aria-hidden="true">×</span></button></div>}
            </div>
          })}</div>
        </section>
      })}
    </div>
        <p className="lb-save-note">Profile: <strong>{activeProfile.name}</strong>. T and CT selections, equipment, float values, and seeds are saved locally; owned-item assignments sync to the canonical Armory.</p>

    {pickerOpen && activeWeapon && <div className="lb-modal-backdrop" onClick={() => setPickerOpen(false)}><div className="lb-modal" role="dialog" aria-modal="true" aria-label={`Choose a skin for ${activeWeapon}`} onClick={e => e.stopPropagation()}>
      <div className="lb-modal-header"><div><p className="lb-eyebrow">SKIN PICKER</p><h3>{activeWeapon}</h3><p className="lb-modal-subtitle">{weaponSkins.length} matching {weaponSkins.length === 1 ? 'skin' : 'skins'} · Search and sort finishes</p></div><button className="lb-close-button" type="button" onClick={() => { setPickerOpen(false); setPickerSearch('') }} aria-label="Close skin picker">×</button></div>
      <div className="lb-picker-controls"><input className="lb-search" type="search" placeholder={`Search ${activeWeapon} skins by name...`} value={pickerSearch} onChange={e => setPickerSearch(e.target.value)} aria-label={`Search ${activeWeapon} skins`} /><label className="lb-sort-control"><span>Sort by</span><select value={skinSort} onChange={e => setSkinSort(e.target.value as 'rarity' | 'az' | 'popular')}><option value="rarity">Rarity</option><option value="az">A–Z</option><option value="popular">Popular</option></select></label></div>
      <div className="lb-color-filter"><span className="lb-color-filter-label">FILTER BY COLOR</span><div className="lb-color-swatches"><button type="button" className={`lb-color-chip ${!pickerColor ? 'active' : ''}`} onClick={() => setPickerColorFilter('')}>All colors</button>{COLOR_OPTIONS.map(c => <button key={c.name} type="button" title={c.name} aria-label={`Filter ${activeWeapon} skins by ${c.name}`} aria-pressed={pickerColor === c.name.toLowerCase()} className={`lb-color-swatch ${pickerColor === c.name.toLowerCase() ? 'active' : ''}`} onClick={() => setPickerColorFilter(pickerColor === c.name.toLowerCase() ? '' : c.name.toLowerCase())}><span style={{ background: c.hex }} />{c.name}</button>)}<label className={`lb-custom-color ${pickerColor.startsWith('#') ? 'active' : ''}`} title="Pick any color"><input type="color" value={pickerColor.startsWith('#') ? pickerColor : '#e34b4b'} onChange={e => setPickerColorFilter(e.target.value.toLowerCase())} aria-label={`Pick a custom color for ${activeWeapon}`} /><span>Custom</span></label></div></div>
      {pickerColor && pickerColorBusy && <div className="lb-empty"><p>Analyzing skin images for color matches…</p></div>}
      <div className="lb-picker-grid">{weaponSkins.map(s => <button key={s.id} type="button" className={`lb-picker-card ${currentLoadout[activeWeapon] === s.id ? 'selected' : ''}`} onClick={() => equipSkin(activeWeapon, s.id)}><div className="lb-picker-image"><img src={imageOf(s)} alt={s.name} /></div><strong>{s.name}</strong><small className="lb-rarity-label" style={{ color: rarityColor(s.rarity), backgroundColor: `${rarityColor(s.rarity)}18`, borderColor: `${rarityColor(s.rarity)}70` }}>{s.rarity}</small></button>)}</div>
      {!weaponSkins.length && <div className="lb-empty"><p>{pickerSearch || pickerColor ? 'No skins match those search and color filters.' : 'No skins for this weapon are in your catalogue yet.'}</p></div>}
      {currentLoadout[activeWeapon] != null && <button className="lb-unequip-button" type="button" onClick={() => equipSkin(activeWeapon, null)}>Unequip skin</button>}
    </div></div>}

    {activeEquipment && <div className="lb-modal-backdrop" onClick={() => setActiveEquipment(null)}><div className="lb-modal" role="dialog" aria-modal="true" aria-label={`Choose ${activeEquipmentTitle}`} onClick={e => e.stopPropagation()}>
      <div className="lb-modal-header"><div><p className="lb-eyebrow">{team === 'T' ? 'TERRORIST LOADOUT' : 'COUNTER-TERRORIST LOADOUT'}</p><h3>Choose {activeEquipmentTitle}</h3><p className="lb-modal-subtitle">{equipmentChoices.length} available {activeEquipmentTitle.toLowerCase()}{equipmentChoices.length === 1 ? '' : 's'}{activeEquipment === 'agent' ? ` for ${team}` : ''}</p></div><button className="lb-close-button" type="button" onClick={() => setActiveEquipment(null)} aria-label="Close equipment picker">×</button></div>
      <input className="lb-search lb-equipment-search" type="search" placeholder={`Search ${activeEquipmentTitle.toLowerCase()}...`} value={equipmentSearch} onChange={e => setEquipmentSearch(e.target.value)} aria-label={`Search ${activeEquipmentTitle}`} />
      <div className="lb-picker-controls lb-equipment-picker-controls"><label className="lb-sort-control"><span>Sort by</span><select value={equipmentSort} onChange={e => setEquipmentSort(e.target.value as 'rarity' | 'az' | 'popular')}><option value="rarity">Rarity</option><option value="az">A–Z</option><option value="popular">Popular</option></select></label></div>
      {activeEquipment !== 'agent' && <div className="lb-color-filter lb-equipment-color-filter"><span className="lb-color-filter-label">FILTER BY COLOR</span><div className="lb-color-swatches"><button type="button" className={`lb-color-chip ${!equipmentColor ? 'active' : ''}`} onClick={() => setEquipmentColorFilter('')}>All colors</button>{COLOR_OPTIONS.map(c => <button key={c.name} type="button" title={c.name} aria-label={`Filter ${activeEquipmentTitle} by ${c.name}`} aria-pressed={equipmentColor === c.name.toLowerCase()} className={`lb-color-swatch ${equipmentColor === c.name.toLowerCase() ? 'active' : ''}`} onClick={() => setEquipmentColorFilter(equipmentColor === c.name.toLowerCase() ? '' : c.name.toLowerCase())}><span style={{ background: c.hex }} />{c.name}</button>)}<label className={`lb-custom-color ${equipmentColor.startsWith('#') ? 'active' : ''}`} title="Pick any color"><input type="color" value={equipmentColor.startsWith('#') ? equipmentColor : '#e34b4b'} onChange={e => setEquipmentColorFilter(e.target.value.toLowerCase())} aria-label={`Pick a custom color for ${activeEquipmentTitle}`} /><span>Custom</span></label></div></div>}
      {equipmentColor && equipmentColorBusy && <div className="lb-empty"><p>Analyzing item images for color matches…</p></div>}
      <div className="lb-picker-grid">{equipmentChoices.map(item => <button key={item.id} type="button" className={`lb-picker-card ${currentEquipment[activeEquipment] === item.id ? 'selected' : ''}`} onClick={() => equipItem(activeEquipment, item.id)}><div className="lb-picker-image">{imageOf(item) ? <img src={imageOf(item)} alt={item.name} loading="lazy" /> : <span>{item.weapon}</span>}</div><strong>{item.name}</strong><small>{item.weapon}</small><small className="lb-rarity-label" style={{ color: rarityColor(item.rarity), backgroundColor: `${rarityColor(item.rarity)}18`, borderColor: `${rarityColor(item.rarity)}70` }}>{item.rarity}</small></button>)}</div>
      {!equipmentChoices.length && <div className="lb-empty"><h3>No matching items</h3><p>Try another search or check the generated catalogue's item categories.</p></div>}
      {currentEquipment[activeEquipment] !== null && <button className="lb-unequip-button" type="button" onClick={() => equipItem(activeEquipment, null)}>Unequip {activeEquipmentTitle.toLowerCase()}</button>}
    </div></div>}

    {settingsOpen && activeWeapon && activeSkin && activeSettings && <div className="lb-modal-backdrop" onClick={() => setSettingsOpen(false)}><div className="lb-modal lb-settings-modal" role="dialog" aria-modal="true" aria-label={`Skin settings for ${activeWeapon}`} onClick={e => e.stopPropagation()}>
      <div className="lb-modal-header"><div><p className="lb-eyebrow">ITEM INSPECT SETTINGS</p><h3>{activeWeapon} | {activeSkin.name}</h3><p className="lb-modal-subtitle">These are saved preview values. The skin image stays static.</p></div><button className="lb-close-button" type="button" onClick={() => setSettingsOpen(false)} aria-label="Close skin settings">×</button></div>
      <div className="lb-settings-summary"><img src={imageOf(activeSkin)} alt={activeSkin.name} /><div><strong>{wear(Number(floatDraft) || activeSettings.float)}</strong><span>Pattern seed {Math.max(0, Math.min(1000, Math.round(Number(seedDraft) || 0)))}</span></div></div>
      <div className="lb-setting-field"><div className="lb-setting-label"><label htmlFor="lb-float">Float value</label><strong>{Number(floatDraft || 0).toFixed(6)}</strong></div><input id="lb-float" className="lb-float-slider" type="range" min={activeLimits.min} max={activeLimits.max} step="0.000001" value={Math.min(activeLimits.max, Math.max(activeLimits.min, Number(floatDraft) || activeLimits.min))} onChange={e => setFloatDraft(e.target.value)} /><div className="lb-range-labels"><span>Min {activeLimits.min.toFixed(6)}</span><span>Max {activeLimits.max.toFixed(6)}</span></div><input className="lb-number-input" aria-label="Exact float value" type="number" min={activeLimits.min} max={activeLimits.max} step="0.000001" value={floatDraft} onChange={e => setFloatDraft(e.target.value)} /><small className="lb-field-help">Float limits are specific to each finish when available. Missing limits fall back to 0.000000–1.000000.</small></div>
      <div className="lb-setting-field"><div className="lb-setting-label"><label htmlFor="lb-seed">Pattern seed</label><strong>{Math.max(0, Math.min(1000, Math.round(Number(seedDraft) || 0)))}</strong></div><input id="lb-seed" className="lb-number-input" type="number" min="0" max="1000" step="1" value={seedDraft} onChange={e => setSeedDraft(e.target.value)} /><input className="lb-seed-slider" aria-label="Pattern seed slider" type="range" min="0" max="1000" step="1" value={Math.max(0, Math.min(1000, Math.round(Number(seedDraft) || 0)))} onChange={e => setSeedDraft(e.target.value)} /><div className="lb-range-labels"><span>Seed 0</span><span>Seed 1000</span></div><small className="lb-field-help">Seed is stored for this skin, but does not change its static image.</small></div>
      <div className="lb-settings-actions"><button type="button" className="lb-unequip-button" onClick={() => { const d = defaults(activeSkin); setFloatDraft(d.float.toFixed(6)); setSeedDraft('0') }}>Reset values</button><button type="button" className="lb-save-settings-button" onClick={saveSettings}>Save settings</button></div>
    </div></div>}

    {dialog && <div className="lb-modal-backdrop lb-dialog-backdrop" onClick={() => setDialog(null)}><form className="lb-modal lb-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="lb-dialog-title" onSubmit={e => { e.preventDefault(); submitDialog() }} onClick={e => e.stopPropagation()}>
      <div className="lb-modal-header"><div><p className="lb-eyebrow">{dialog.mode === 'clear' || dialog.mode === 'delete' ? 'CONFIRM ACTION' : 'PROFILE MANAGER'}</p><h3 id="lb-dialog-title">{dialog.mode === 'create' ? 'Create a profile' : dialog.mode === 'duplicate' ? 'Duplicate profile' : dialog.mode === 'rename' ? 'Rename profile' : dialog.mode === 'delete' ? 'Delete this profile?' : 'Clear this loadout?'}</h3></div><button className="lb-close-button" type="button" onClick={() => setDialog(null)} aria-label="Close dialog">×</button></div>
      {dialog.mode === 'create' || dialog.mode === 'duplicate' || dialog.mode === 'rename' ? <><label className="lb-dialog-label" htmlFor="lb-profile-name">PROFILE NAME</label><input id="lb-profile-name" className="lb-dialog-input" autoFocus maxLength={48} value={dialog.value} placeholder="Enter a profile name" onChange={e => setDialog({ ...dialog, value: e.target.value })} /><p className="lb-dialog-help">{dialog.mode === 'create' ? 'Start with an empty T and CT loadout.' : dialog.mode === 'duplicate' ? 'Copy the current T and CT loadouts, equipment, floats, and seeds.' : 'Your saved items will stay exactly as they are.'}</p></> : <p className="lb-dialog-message">{dialog.mode === 'delete' ? <>Delete <strong>{activeProfile.name}</strong>? Its saved T and CT loadouts will be deleted. This cannot be undone.</> : <>Clear the <strong>{team === 'T' ? 'Terrorist' : 'Counter-Terrorist'}</strong> loadout for <strong>{activeProfile.name}</strong>? This removes equipped weapon skins and equipment for this team only.</>}</p>}
      <div className="lb-dialog-actions"><button type="button" className="lb-dialog-cancel" onClick={() => setDialog(null)}>Cancel</button><button type="submit" className={`lb-dialog-confirm ${dialog.mode === 'delete' || dialog.mode === 'clear' ? 'danger' : ''}`} disabled={['create', 'duplicate', 'rename'].includes(dialog.mode) && !dialog.value.trim()}>{dialog.mode === 'create' ? 'Create profile' : dialog.mode === 'duplicate' ? 'Duplicate profile' : dialog.mode === 'rename' ? 'Save name' : dialog.mode === 'delete' ? 'Delete profile' : 'Clear loadout'}</button></div>
    </form></div>}
  </section>
}