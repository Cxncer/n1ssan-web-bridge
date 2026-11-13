import express from 'express'
import type { Request, Response, NextFunction } from 'express'
import { copyFile, readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { readdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { migrateLegacyConfigurations } from './config-migration.ts'
import {
  ArmoryRevisionConflictError,
  ArmoryStore,
  ArmoryValidationError,
} from './armory-store.ts'
import { createLocalIntegrationSnapshot } from '../src/integration/local-snapshot.ts'
import { ArmoryEquipmentStore, EquipmentRevisionConflictError, EquipmentValidationError } from './armory-equipment-store.ts'
import { AttachmentsSync } from './attachments-sync.ts'
import { createEmptyEquipmentDocument, validateArmoryEquipmentDocument } from '../src/armory/equipment.ts'
import { simulateLocalIntegration } from '../src/integration/simulator.ts'
import skinCatalogueData from '../src/skins.json' with { type: 'json' }
import knifeCatalogueData from '../src/armory/ui/knife-skins.json' with { type: 'json' }
import liveSchemaData from '../src/armory/n1ssan-cs2-schema.json' with { type: 'json' }
import { LoadoutProfilesStore, LoadoutValidationError, type StoredLoadoutProfile } from './loadout-profiles-store.ts'
import { buildEquipmentAssignments, type LoadoutCatalogueItem } from '../src/armory/loadout-adapter.ts'
import { buildArmoryCatalogue, projectArmoryInventory } from '../src/armory/armory-inventory.ts'
import {
  buildLoadoutRuntimeCatalogue,
  projectLoadoutRuntime,
  type LiveSchemaSnapshot,
  type LoadoutSelectionSnapshot,
} from '../src/armory/runtime-config.ts'
import type { CatalogueSourceRecord } from '../src/armory/catalogue-identity.ts'
import { buildDiagnostics, readInjectorOutcome, readLatestDllStatus } from './diagnostics.ts'

const app = express()

// Browsers throttle background timers to about one tick per minute, so a tab
// the user switched away from looks silent for up to 60s. A 30s expiry killed
// the Bridge mid-session and the next Armory save failed to connect.
const BROWSER_SESSION_TIMEOUT_MS = 150_000

const browserSessions = new Map<string, number>()

let browserSessionGraceUntil = 0

let hasSeenBrowserSession = false

let bridgeHttpServer: ReturnType<typeof app.listen> | undefined

let browserSessionSweep: NodeJS.Timeout | undefined

let attachmentSyncTimer: NodeJS.Timeout | undefined

let bridgeShutdownStarted = false
const armoryEventClients = new Set<Response>()

function publishArmoryEvent(event: string, payload: Record<string, unknown>): void {
  const frame = 'event: ' + event + '\ndata: ' + JSON.stringify(payload) + '\n\n'
  for (const client of armoryEventClients) {
    try { client.write(frame) } catch { armoryEventClients.delete(client) }
  }
}

// The launcher starts this process with piped stdout/stderr and exits on
// handoff, which closes both pipes. Without a listener the next log line raises
// EPIPE and Node terminates the Bridge while the browser still needs it - the
// cause of "Could not connect to the n1ssan Bridge while saving Armory".
for (const stream of [process.stdout, process.stderr]) {
  stream?.on('error', () => {})
}

const PORT = Number(process.env.N1SSAN_PORT ?? 3210)
const HOST = '127.0.0.1'
const MAX_ITEMS = 100
// All persistent user data has one canonical location. Environment overrides
// are intentionally not supported: Bridge, Launcher and DLL must agree.
const DATA_DIRECTORY = process.env.NODE_ENV === 'test' && process.env.N1SSAN_TEST_CONFIG_DIR
  ? path.resolve(process.env.N1SSAN_TEST_CONFIG_DIR)
  : path.join(
      process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'),
      'n1ssan',
      'configs',
    )
// The file the native runtime reads. It only ever holds the runtime projection.
const DATA_FILE = path.join(DATA_DIRECTORY, 'n1ssan-data.json')
// The obsolete /skins API keeps its own saved state. It must never share the
// runtime document: a legacy snapshot and a runtime projection have different
// schemas, and mixing them makes the DLL read items the game cannot create.
const LEGACY_STATE_FILE = path.join(DATA_DIRECTORY, 'n1ssan-legacy-loadout.json')
const ARMORY_FILE = path.join(DATA_DIRECTORY, 'armory-data.json')
const armoryStore = new ArmoryStore(ARMORY_FILE)
const EQUIPMENT_FILE = path.join(DATA_DIRECTORY, 'armory-equipment.json')
const equipmentStore = new ArmoryEquipmentStore(EQUIPMENT_FILE)
const ARMORY_INVENTORY_FILE = path.join(DATA_DIRECTORY, 'armory-inventory.json')
const MODE_FILE = path.join(DATA_DIRECTORY, 'runtime-mode.json')
const LOADOUT_FILE = path.join(DATA_DIRECTORY, 'loadout-profiles.json')
const loadoutStore = new LoadoutProfilesStore(LOADOUT_FILE)
const ATTACHMENTS_FILE = path.join(DATA_DIRECTORY, 'armory-detected-attachments.json')
const ATTACHMENTS_ACK_FILE = path.join(DATA_DIRECTORY, 'armory-attachments-ack.json')





// Shared skin metadata. Loadout resolves catalogue IDs directly; Armory
// inventory is a separate feature and is never consulted here.
const runtimeCatalogue = buildLoadoutRuntimeCatalogue([
  ...(skinCatalogueData as unknown as CatalogueSourceRecord[]),
  ...(knifeCatalogueData as unknown as CatalogueSourceRecord[]),
])
const liveSchema = liveSchemaData as unknown as LiveSchemaSnapshot
const armoryCatalogue = buildArmoryCatalogue([
  ...(skinCatalogueData as unknown as CatalogueSourceRecord[]),
  ...(knifeCatalogueData as unknown as CatalogueSourceRecord[]),
])

// Raw catalogue rows the equipment adapter resolves Loadout selections against.
const loadoutCatalogueRecords: LoadoutCatalogueItem[] = [
  ...(skinCatalogueData as unknown as LoadoutCatalogueItem[]),
  ...(knifeCatalogueData as unknown as LoadoutCatalogueItem[]),
]

type RuntimeWriteResult = {
  written: boolean
  targetCount: number
  skipped: number
  activeLoadoutProfileId: string | null
  path: string
  reason: string
}

/**
 * Resolves the active Loadout profile into the document n1ssan-dll.dll reads.
 * An empty projection deliberately leaves the previous file untouched: writing
 * an empty loadout would make the native runtime fail its preflight.
 */
async function writeRuntimeConfig(): Promise<RuntimeWriteResult> {
  const profile = loadoutStore.active()

  if (!profile) {
    return {
      written: false,
      targetCount: 0,
      skipped: 0,
      activeLoadoutProfileId: null,
      path: DATA_FILE,
      reason: 'no saved Loadout profile; previous runtime config kept',
    }
  }

  const projection = projectLoadoutRuntime(profile, runtimeCatalogue, liveSchema, profile.id)

  if (projection.document.skins.length === 0) {
    return {
      written: false,
      targetCount: 0,
      skipped: projection.skipped.length,
      activeLoadoutProfileId: profile.id,
      path: DATA_FILE,
      reason: 'no resolvable targets; previous runtime config kept',
    }
  }

  const temporaryPath = `${DATA_FILE}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(projection.document, null, 2)}\n`, 'utf8')
  await rename(temporaryPath, DATA_FILE)

  return {
    written: true,
    targetCount: projection.document.skins.length,
    skipped: projection.skipped.length,
    activeLoadoutProfileId: profile.id,
    path: DATA_FILE,
    reason: 'written',
  }
}

async function projectRuntimeOrReport(): Promise<RuntimeWriteResult | null> {
  try {
    return await writeRuntimeConfig()
  } catch (error) {
    console.error('Runtime config projection failed:', error)
    return null
  }
}

type InventoryWriteResult = {
  written: boolean
  itemCount: number
  skipped: number
  skippedItems: Array<{ instanceId: string; definitionId: string; reason: string }>
  path: string
  reason: string
}

/**
 * Writes the active Armory profile as an inventory document for the native
 * runtime. Separate from Loadout; an intentionally empty active profile clears its managed set.
 */
async function writeArmoryInventory(): Promise<InventoryWriteResult> {
  const armory = armoryStore.read()
  const projection = projectArmoryInventory(
    armory,
    armoryCatalogue,
    liveSchema.itemDefinitions ?? null,
  )

  // An empty profile is a valid clear operation. If source items existed but
  // none could be resolved, keep the last good projection instead of clearing it.
  if (projection.document.items.length === 0 && projection.skipped.length > 0) {
    return {
      written: false,
      itemCount: 0,
      skipped: projection.skipped.length,
      skippedItems: projection.skipped,
      path: ARMORY_INVENTORY_FILE,
      reason: 'items could not be resolved; previous inventory kept',
    }
  }

  const temporaryPath = `${ARMORY_INVENTORY_FILE}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(projection.document, null, 2)}\n`, 'utf8')
  await rename(temporaryPath, ARMORY_INVENTORY_FILE)

  return {
    written: true,
    itemCount: projection.document.items.length,
    skipped: projection.skipped.length,
    skippedItems: projection.skipped,
    path: ARMORY_INVENTORY_FILE,
    reason: 'written',
  }
}

async function projectInventoryOrReport(): Promise<InventoryWriteResult | null> {
  try {
    return await writeArmoryInventory()
  } catch (error) {
    console.error('Armory inventory projection failed:', error)
    return null
  }
}

type RuntimeMode = 'loadout' | 'armory'

/**
 * A mode selection is a per-session user action. `selectionId` is what the DLL
 * watches: it makes every Apply a fresh event, so a selection made in an
 * earlier session can never be re-applied just because the file still names it.
 */
async function writeRuntimeMode(mode: RuntimeMode | 'unknown'): Promise<void> {
  const temporaryPath = `${MODE_FILE}.tmp`
  const document = {
    mode,
    selectionId: mode === 'unknown' ? null : randomUUID(),
    updatedAt: new Date().toISOString(),
  }
  await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
  await rename(temporaryPath, MODE_FILE)
}

async function readRuntimeMode(): Promise<RuntimeMode | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(MODE_FILE, 'utf8'))

    if (parsed && typeof parsed === 'object' &&
        ((parsed as Record<string, unknown>).mode === 'loadout' ||
         (parsed as Record<string, unknown>).mode === 'armory')) {
      return (parsed as Record<string, unknown>).mode as RuntimeMode
    }
  } catch {
    // No mode selected yet.
  }

  return null
}

/**
 * Loadout and Armory are mutually exclusive runtime sources. The mode file
 * tells the DLL which single dataset to consume.
 */
async function projectActiveMode(mode: RuntimeMode | null): Promise<RuntimeWriteResult | InventoryWriteResult | null> {
  if (mode === 'armory')
  {
    // Assignments name instances in the inventory being projected, so they are
    // refreshed before the projection can be consumed.
    await syncEquipmentFromActiveLoadout()
    return projectInventoryOrReport()
  }

  return projectRuntimeOrReport()
}

type EquipmentSyncResult = {
  written: boolean
  assignments: number
  skipped: number
  reasons: string[]
}

type EquipmentSyncFailure = {
  written: false
  reason: string
}

/**
 * Mirrors a saved Loadout selection into the Armory equipment document the
 * native runtime reads. Selections that are not owned in the active Armory
 * inventory are reported and left out: one unowned weapon must not clear the
 * glove, knife or agent slots that are owned.
 *
 * Selections made directly in the Armory UI are preserved: the Loadout only
 * replaces the team+slot targets it actually resolves, so a slot picked inside
 * Armory is not wiped by an unrelated Loadout save.
 */
async function syncEquipmentAssignments(profile: StoredLoadoutProfile): Promise<EquipmentSyncResult> {
  const armory = armoryStore.read()
  const { assignments, skipped } = buildEquipmentAssignments(
    { loadoutProfileId: profile.id, loadouts: profile.loadouts, equipment: profile.equipment },
    loadoutCatalogueRecords,
    armory,
    { skipUnresolved: true },
  )

  // An inventory edit between two saves can orphan an assignment; persist only
  // instances the active profile still contains so validation succeeds instead
  // of rejecting the whole document.
  const active = armory.profiles.find(entry => entry.id === armory.activeProfileId)
  const owned = new Set(
    (active?.items ?? [])
      .filter(item => item.kind === 'skin' && item.quantity === 1)
      .map(item => item.id),
  )
  const valid = assignments.filter(assignment => owned.has(assignment.itemInstanceId))
  const targetKey = (assignment: { team: string; slot: string; target: string }) =>
    `${assignment.team}|${assignment.slot}|${assignment.target}`
  const covered = new Set(valid.map(targetKey))
  const usedInstances = new Set(valid.map(assignment => `${assignment.team}|${assignment.itemInstanceId}`))
  const current = equipmentStore.read(armory)
  const carried = (current.inventoryRevision === armory.revision && current.profileId === armory.activeProfileId
    ? current.assignments
    : [])
    .filter(assignment => owned.has(assignment.itemInstanceId))
    .filter(assignment => !covered.has(targetKey(assignment)))
    .filter(assignment => !usedInstances.has(`${assignment.team}|${assignment.itemInstanceId}`))
  const document = { ...createEmptyEquipmentDocument(armory), assignments: [...carried, ...valid] }
  const saved = await equipmentStore.replace(armory.revision, document, armory)

  return {
    written: true,
    assignments: saved.assignments.length,
    skipped: skipped.length,
    reasons: skipped.slice(0, 5),
  }
}

async function syncEquipmentFromActiveLoadout(): Promise<EquipmentSyncResult | EquipmentSyncFailure | null> {
  const profile = loadoutStore.active()

  if (!profile)
    return null

  try {
    return await syncEquipmentAssignments(profile)
  } catch (error) {
    console.error('Armory equipment sync failed:', error)
    return {
      written: false,
      reason: error instanceof Error ? error.message : 'Armory equipment could not be saved',
    }
  }
}

const allowedOrigins = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
])

type Team = 'T' | 'CT'
type EquipmentSlot = 'weapon' | 'agent' | 'knife' | 'gloves' | 'zeus'

type BridgeSkin = Record<string, unknown> & {
  id: number
  weapon: string
  name: string
  team: Team
  slot: EquipmentSlot
}

type LoadoutInfo = {
  id: number
  profile: string
  team: Team
  teams: Team[]
  receivedAt: string
  itemCount: number
}

type SavedState = {
  version: 1
  nextLoadoutId: number
  skins: BridgeSkin[]
  loadout: LoadoutInfo | null
}

let selectedSkins: BridgeSkin[] = []
let latestLoadout: LoadoutInfo | null = null
let nextLoadoutId = 1
let saveQueue = Promise.resolve()

// Owns the only write path from the native runtime into the Armory profile.
const STATTRAK_KILLS_FILE = ATTACHMENTS_FILE.replace(
  /armory-detected-attachments\.json$/,
  'armory-stattrak-kills.json',
)

const attachmentsSync = new AttachmentsSync({
  detectionPath: ATTACHMENTS_FILE,
  ackPath: ATTACHMENTS_ACK_FILE,
  killsPath: STATTRAK_KILLS_FILE,
  read: () => armoryStore.read(),
  replace: (expectedRevision, candidate) => armoryStore.replace(expectedRevision, candidate),
  onMerged: async () => {
    await projectInventoryOrReport()
  },
})

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pruneBrowserSessions(): void {
  const now = Date.now()
  let expired = false
  for (const [sessionId, lastSeen] of browserSessions) {
    if (now - lastSeen > BROWSER_SESSION_TIMEOUT_MS) {
      browserSessions.delete(sessionId)
      expired = true
    }
  }
  if (expired && browserSessions.size === 0) {
    browserSessionGraceUntil = Math.max(
      browserSessionGraceUntil,
      now + BROWSER_SESSION_TIMEOUT_MS,
    )
  }
}
function hasActiveBrowserSession(): boolean {
  pruneBrowserSessions()
  return browserSessions.size > 0 || Date.now() < browserSessionGraceUntil
}

const STATUS_DIRECTORY = path.join(
  process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'),
  'n1ssan',
  'status',
)

/**
 * True while an injected n1ssan-dll is alive in a game process. The DLL writes
 * one `cs2-<pid>.status` file per session, so the PID in the name is what
 * decides: a stale file from a closed game must not keep the Bridge alive.
 */
function hasLiveDllSession(): boolean {
  let entries: string[]

  try {
    entries = readdirSync(STATUS_DIRECTORY)
  } catch {
    return false // No status directory yet: nothing is injected.
  }

  for (const entry of entries) {
    const match = /^cs2-(\d+)\.status$/.exec(entry)
    if (!match) continue

    const pid = Number(match[1])
    if (!Number.isInteger(pid) || pid <= 0) continue

    try {
      process.kill(pid, 0) // Signal 0 only probes; nothing is delivered.
      return true
    } catch {
      // The game exited.
    }
  }

  return false
}
async function stopBridgeAfterBrowserSession(): Promise<void> {
  if (bridgeShutdownStarted || !hasSeenBrowserSession || hasActiveBrowserSession()) return

  // Saving Armory must keep working while the game is open even if the browser
  // tab went silent (background tabs stop heartbeating), so a running game with
  // an injected n1ssan-dll holds the Bridge up.
  if (hasLiveDllSession()) return

  bridgeShutdownStarted = true
  if (browserSessionSweep) clearInterval(browserSessionSweep)
  if (attachmentSyncTimer) clearInterval(attachmentSyncTimer)
  console.log('No N1SSAN browser sessions remain. Shutting down Bridge.')
  for (const client of armoryEventClients) {
    client.end()
  }
  armoryEventClients.clear()
  bridgeHttpServer?.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 5_000).unref()
}

function isTeam(value: unknown): value is Team {
  return value === 'T' || value === 'CT'
}

function isEquipmentSlot(value: unknown): value is EquipmentSlot {
  return (
    value === 'weapon' ||
    value === 'agent' ||
    value === 'knife' ||
    value === 'gloves' ||
    value === 'zeus'
  )
}

function validateSkin(value: unknown, index: number): string[] {
  const errors: string[] = []

  if (!isObject(value)) {
    return [`Item ${index}: expected an object`]
  }

  if (typeof value.id !== 'number' || !Number.isSafeInteger(value.id)) {
    errors.push(`Item ${index}: id must be a safe integer`)
  }

  if (typeof value.weapon !== 'string' || !value.weapon.trim()) {
    errors.push(`Item ${index}: weapon must be a non-empty string`)
  }

  if (typeof value.name !== 'string' || !value.name.trim()) {
    errors.push(`Item ${index}: name must be a non-empty string`)
  }

  if (!isTeam(value.team)) {
    errors.push(`Item ${index}: team must be T or CT`)
  }

  if (!isEquipmentSlot(value.slot)) {
    errors.push(`Item ${index}: invalid slot`)
  }

  if (value.slot === 'weapon') {
    if (typeof value.equippedFor !== 'string' || !value.equippedFor.trim()) {
      errors.push(`Item ${index}: weapon items need equippedFor`)
    }

    if (
      typeof value.float !== 'number' ||
      !Number.isFinite(value.float) ||
      value.float < 0 ||
      value.float > 1
    ) {
      errors.push(`Item ${index}: float must be between 0 and 1`)
    }

    if (
      typeof value.seed !== 'number' ||
      !Number.isSafeInteger(value.seed) ||
      value.seed < 0
    ) {
      errors.push(`Item ${index}: seed must be a non-negative integer`)
    }
  }

  return errors
}

async function saveState(state: SavedState): Promise<void> {
  const temporaryFile = `${LEGACY_STATE_FILE}.tmp`
  const backupFile = `${LEGACY_STATE_FILE}.bak`
  const contents = `${JSON.stringify(state, null, 2)}\n`

  await writeFile(temporaryFile, contents, 'utf8')

  try {
    await copyFile(LEGACY_STATE_FILE, backupFile)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }

  await rename(temporaryFile, LEGACY_STATE_FILE)
}

function queueSave(state: SavedState): Promise<void> {
  const operation = saveQueue.then(() => saveState(state))

  // Keep the queue usable after a failed write.
  saveQueue = operation.catch(() => undefined)

  return operation
}

async function readValidState(filePath: string): Promise<SavedState> {
  const contents = await readFile(filePath, 'utf8')
  const saved: unknown = JSON.parse(contents)

  if (
    !isObject(saved) ||
    saved.version !== 1 ||
    !Array.isArray(saved.skins) ||
    !(
      saved.loadout === null ||
      (
        isObject(saved.loadout) &&
        Number.isSafeInteger(saved.loadout.id) &&
        (saved.loadout.id as number) >= 1 &&
        typeof saved.loadout.profile === 'string' &&
        isTeam(saved.loadout.team) &&
        (
          saved.loadout.teams === undefined ||
          (
            Array.isArray(saved.loadout.teams) &&
            saved.loadout.teams.every(isTeam)
          )
        ) &&
        typeof saved.loadout.receivedAt === 'string' &&
        Number.isSafeInteger(saved.loadout.itemCount) &&
        (saved.loadout.itemCount as number) >= 0
      )
    ) ||
    !Number.isSafeInteger(saved.nextLoadoutId) ||
    (saved.nextLoadoutId as number) < 1
  ) {
    throw new Error(`Invalid saved-data structure in ${filePath}`)
  }

  const restoredErrors = saved.skins.flatMap((skin, index) =>
    validateSkin(skin, index + 1),
  )

  if (restoredErrors.length > 0) {
    throw new Error(
      `Saved skins failed validation in ${filePath}: ${restoredErrors.join('; ')}`,
    )
  }

  const skins = saved.skins as BridgeSkin[]
  const loadout = saved.loadout as LoadoutInfo | null

  if (loadout && loadout.itemCount !== skins.length) {
    throw new Error(
      `Saved loadout metadata does not match its items in ${filePath}`,
    )
  }

  const restoredTeams = [...new Set(skins.map(skin => skin.team))]

  return {
    version: 1,
    nextLoadoutId: saved.nextLoadoutId as number,
    skins,
    loadout: loadout
      ? {
          ...loadout,
          teams: restoredTeams,
        }
      : null,
  }
}

async function restoreState(): Promise<void> {
  const backupFile = `${LEGACY_STATE_FILE}.bak`

  try {
    const saved = await readValidState(LEGACY_STATE_FILE)

    selectedSkins = saved.skins
    latestLoadout = saved.loadout
    nextLoadoutId = saved.nextLoadoutId

    console.log(`Restored ${selectedSkins.length} item(s) from disk.`)
    return
  } catch (primaryError) {
    if ((primaryError as NodeJS.ErrnoException).code === 'ENOENT') {
      // A missing primary file is normal on first startup.
      try {
        await readFile(backupFile, 'utf8')
      } catch (backupError) {
        if ((backupError as NodeJS.ErrnoException).code === 'ENOENT') {
          console.log('No saved loadout yet. Starting with an empty Bridge.')
          return
        }

        throw new Error(
          `Primary save is missing and the backup cannot be read: ${String(backupError)}`,
          { cause: backupError },
        )
      }
    }

    console.error('The primary save could not be loaded:', primaryError)
  }

  let backup: SavedState

  try {
    backup = await readValidState(backupFile)
  } catch (backupError) {
    throw new Error(
      'Bridge recovery failed. Neither the primary save nor its backup is usable. ' +
      'Preserve both files and inspect them before restarting.\n' +
      `Backup error: ${String(backupError)}`,
      { cause: backupError },
    )
  }

  // Preserve an existing damaged primary file without modifying it.
  try {
    await readFile(LEGACY_STATE_FILE, 'utf8')

    const damagedCopy = `${LEGACY_STATE_FILE}.corrupt-${Date.now()}`
    await copyFile(LEGACY_STATE_FILE, damagedCopy)
    console.error(`Preserved the original primary save as: ${damagedCopy}`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(
        `A valid backup exists, but the primary file could not be preserved: ${String(error)}`,
        { cause: error },
      )
    }
  }

  // Restore using a temporary file. The backup remains untouched.
  const recoveryFile = `${LEGACY_STATE_FILE}.recovery.tmp`

  await writeFile(
    recoveryFile,
    `${JSON.stringify(backup, null, 2)}\n`,
    'utf8',
  )

  await rename(recoveryFile, LEGACY_STATE_FILE)

  selectedSkins = backup.skins
  latestLoadout = backup.loadout
  nextLoadoutId = backup.nextLoadoutId

  console.log(`Recovered ${selectedSkins.length} item(s) from the backup.`)
}

app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin

  if (origin && allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  }

  if (req.method === 'OPTIONS') {
    res.sendStatus(204)
    return
  }

  next()
})

app.use(express.json({ limit: '2mb' }))


app.get('/armory/events', (req: Request, res: Response) => {
  res.status(200)
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()
  res.write(': connected\n\n')
  armoryEventClients.add(res)
  req.on('close', () => armoryEventClients.delete(res))
})

app.get('/armory', (_req: Request, res: Response) => {
  res.json({ data: armoryStore.read() })
})

app.get('/armory/equipment', (_req: Request, res: Response) => {
  const armory = armoryStore.read()
  const data = equipmentStore.read(armory)
  const validationErrors = validateArmoryEquipmentDocument(data, armory)
  res.setHeader('Cache-Control', 'no-store')
  res.json({ data, validationErrors })
})

app.put('/armory/equipment', async (req: Request, res: Response) => {
  if (!isObject(req.body)) {
    res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid equipment request', details: ['Expected a JSON object'] } })
    return
  }
  const { expectedInventoryRevision, data } = req.body
  try {
    const saved = await equipmentStore.replace(
      typeof expectedInventoryRevision === 'number' ? expectedInventoryRevision : Number.NaN,
      data,
      armoryStore.read(),
    )
    res.status(200).json({ data: saved })
  } catch (error) {
    if (error instanceof EquipmentRevisionConflictError) {
      res.status(409).json({ error: { code: 'REVISION_CONFLICT', message: error.message, details: ['Reload Armory and equipment before retrying'] } })
      return
    }
    if (error instanceof EquipmentValidationError) {
      res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: error.message, details: error.details } })
      return
    }
    console.error('Failed to persist Armory equipment:', error)
    res.status(500).json({ error: { code: 'STORAGE_FAILURE', message: 'Armory equipment could not be saved' } })
  }
})


app.get('/loadout/profiles', (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json({ data: loadoutStore.read() })
})

app.post('/loadout/apply', async (req: Request, res: Response) => {
  if (!isObject(req.body)) {
    res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid Loadout apply request', details: ['Expected a JSON object'] } })
    return
  }

  const profileId = typeof req.body.profileId === 'string' ? req.body.profileId.trim() : ''
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : ''

  if (!profileId) {
    res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'profileId is required', details: [] } })
    return
  }

  try {
    // Loadout stores its own selection of catalogue IDs. Armory inventory is
    // a separate feature and is not consulted, so any catalogue skin may be
    // equipped without an ownership check.
    const saved = await loadoutStore.saveProfile({
      id: profileId,
      name: name || 'Loadout',
      loadouts: req.body.loadouts as LoadoutSelectionSnapshot['loadouts'],
      equipment: req.body.equipment as LoadoutSelectionSnapshot['equipment'],
      skinSettings: req.body.skinSettings as LoadoutSelectionSnapshot['skinSettings'],
    })

    const runtime = await projectRuntimeOrReport()

    // Armory mode reads its glove/knife/agent slots from the equipment document,
    // so the same save publishes the assignments the native runtime consumes.
    const equipment = await syncEquipmentFromActiveLoadout()

    // Apply is the user's explicit choice, so it is also what selects the
    // runtime source. Saving or importing a profile never does this on its own.
    // Only select Loadout when its document is actually on disk.
    const mode = runtime?.written ? 'loadout' : null
    if (mode) await writeRuntimeMode(mode)

    res.status(200).json({ data: saved, runtime, equipment, mode })
  } catch (error) {
    if (error instanceof LoadoutValidationError) {
      res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: error.message, details: error.details } })
      return
    }

    console.error('Failed to apply Loadout:', error)
    res.status(500).json({ error: { code: 'STORAGE_FAILURE', message: 'Loadout could not be applied' } })
  }
})


app.post('/armory/apply', async (_req: Request, res: Response) => {
  try {
    // Refresh the equipment assignments against the current inventory first:
    // they name instances of the profile about to be projected, so an inventory
    // edit must not leave the native runtime resolving removed items.
    const equipment = await syncEquipmentFromActiveLoadout()

    // Write the selected Armory profile before switching the DLL runtime mode,
    // so the native watcher never observes Armory mode with an old document.
    const runtime = await projectInventoryOrReport()

    if (!runtime) {
      res.status(500).json({
        error: { code: 'PROJECTION_FAILED', message: 'Armory inventory could not be projected', details: [] },
      })
      return
    }

    if (!runtime.written) {
      res.status(422).json({
        error: {
          code: 'EMPTY_ARMORY',
          message: 'The active Armory profile could not be projected safely.',
          details: runtime.skippedItems.length > 0
            ? runtime.skippedItems.map(item => `${item.definitionId}: ${item.reason}`)
            : ['Check that its items are supported and resolve against the current catalogue/schema.'],
        },
        runtime,
      })
      return
    }

    await writeRuntimeMode('armory')
    res.status(200).json({ mode: 'armory', runtime, equipment })
  } catch (error) {
    console.error('Failed to apply Armory inventory:', error)
    res.status(500).json({
      error: { code: 'STORAGE_FAILURE', message: 'Armory inventory could not be applied', details: [] },
    })
  }
})

app.post('/runtime-mode/reset', async (_req: Request, res: Response) => {
  try {
    await writeRuntimeMode('unknown')
    res.status(200).json({ mode: 'unknown' })
  } catch (error) {
    console.error('Failed to reset runtime mode:', error)
    res.status(500).json({
      error: { code: 'STORAGE_FAILURE', message: 'Runtime mode could not be reset', details: [] },
    })
  }
})

app.post('/runtime-mode', async (req: Request, res: Response) => {
  const mode = isObject(req.body) ? req.body.mode : null

  if (mode !== 'loadout' && mode !== 'armory') {
    res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: "mode must be 'loadout' or 'armory'", details: [] } })
    return
  }

  try {
    await writeRuntimeMode(mode)
    const runtime = await projectActiveMode(mode)
    res.status(200).json({ mode, runtime })
  } catch (error) {
    console.error('Failed to select runtime mode:', error)
    res.status(500).json({ error: { code: 'STORAGE_FAILURE', message: 'Runtime mode could not be saved' } })
  }
})

app.put('/armory', async (req: Request, res: Response) => {
  if (!isObject(req.body)) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Invalid Armory request body',
        details: ['Expected a JSON object'],
      },
    })
    return
  }

  const { expectedRevision, data } = req.body

  try {
    const saved = await armoryStore.replace(
      typeof expectedRevision === 'number' ? expectedRevision : Number.NaN,
      data,
    )

    res.status(200).json({ data: saved })
  } catch (error) {
    if (error instanceof ArmoryRevisionConflictError) {
      res.status(409).json({
        error: {
          code: 'REVISION_CONFLICT',
          message: error.message,
          details: ['Reload the latest Armory document before retrying'],
        },
      })
      return
    }

    if (error instanceof ArmoryValidationError) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: error.message,
          details: error.details,
        },
      })
      return
    }

    console.error('Failed to persist Armory document:', error)
    res.status(500).json({
      error: {
        code: 'STORAGE_FAILURE',
        message: 'Armory could not save the document',
      },
    })
  }
})


app.get('/integration/snapshot', (_req: Request, res: Response) => {
  const armory = armoryStore.read()
  const data = createLocalIntegrationSnapshot(
    armory,
    selectedSkins,
    latestLoadout,
    undefined,
    equipmentStore.read(armory),
  )

  res.setHeader('Cache-Control', 'no-store')
  res.json({ data })
})


app.get('/integration/simulator', (_req: Request, res: Response) => {
  const armory = armoryStore.read()
  const snapshot = createLocalIntegrationSnapshot(
    armory,
    selectedSkins,
    latestLoadout,
    undefined,
    equipmentStore.read(armory),
  )
  const data = simulateLocalIntegration(snapshot)
  res.setHeader('Cache-Control', 'no-store')
  res.json({ data })
})


app.post('/session/heartbeat', (req: Request, res: Response) => {
  const sessionId = isObject(req.body) ? req.body.sessionId : undefined
  if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9_-]{12,100}$/.test(sessionId)) {
    res.status(400).json({ error: 'Invalid browser session ID' })
    return
  }
  hasSeenBrowserSession = true
  browserSessions.set(sessionId, Date.now())
  browserSessionGraceUntil = 0
  res.setHeader('Cache-Control', 'no-store')
  res.status(204).end()
})
app.get('/session/active', (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json({ active: hasActiveBrowserSession(), sessions: browserSessions.size })
})

// Consolidated diagnostics: DLL status record + Bridge state + loader outcome,
// classified with the shared failure taxonomy (failure-taxonomy.md).
app.get('/diagnostics', async (_req: Request, res: Response) => {
  const status = readLatestDllStatus()
  const document = buildDiagnostics({
    dll: status?.record ?? null,
    injectorOutcome: readInjectorOutcome(),
    bridge: {
      online: true,
      runtimeMode: (await readRuntimeMode()) ?? 'unknown',
      armoryRevision: armoryStore.read().revision,
      itemCount: selectedSkins.length,
    },
  })
  res.setHeader('Cache-Control', 'no-store')
  res.json(document)
})

app.get('/health', async (_req: Request, res: Response) => {
  res.json({
    runtimeMode: await readRuntimeMode(),
    app: 'n1ssan-bridge',
    status: 'online',
    port: PORT,
    hasLoadout: latestLoadout !== null,
    loadoutName: latestLoadout?.profile ?? null,
    loadoutId: latestLoadout?.id ?? null,
    itemCount: selectedSkins.length,
    storage: 'json-file',
    armoryRevision: armoryStore.read().revision,
    inventoryProfiles: armoryStore.read().profiles.length,
  })
})


app.get('/skins', (_req: Request, res: Response) => {
  res.json({
    skins: selectedSkins,
    loadout: latestLoadout,
  })
})

app.post('/skins', async (req: Request, res: Response) => {
  if (!isObject(req.body)) {
    res.status(400).json({
      error: 'Invalid request body',
      details: ['Expected a JSON object'],
    })
    return
  }

  const { skins, profile } = req.body

  if (!Array.isArray(skins)) {
    res.status(400).json({
      error: 'Invalid skins',
      details: ['Expected a "skins" array'],
    })
    return
  }

  if (skins.length > MAX_ITEMS) {
    res.status(400).json({
      error: 'Too many items',
      details: [`Maximum allowed items: ${MAX_ITEMS}`],
    })
    return
  }

  if (typeof profile !== 'string' || !profile.trim()) {
    res.status(400).json({
      error: 'Invalid profile',
      details: ['Profile must be a non-empty string'],
    })
    return
  }

  const errors = skins.flatMap((skin, index) =>
    validateSkin(skin, index + 1),
  )

  if (errors.length > 0) {
    res.status(400).json({
      error: 'Loadout validation failed',
      details: errors,
    })
    return
  }

  const acceptedSkins = skins as BridgeSkin[]
  const profileName = profile.trim()

  // The builder always sends both teams, so just store what arrived.
  const combinedSkins = acceptedSkins

  const loadoutId = nextLoadoutId++

  const combinedTeams = [
    ...new Set(combinedSkins.map(skin => skin.team)),
  ] as Team[]

  // "team" on the loadout record reflects whichever team's items
  // appear first in the payload. The important field for both teams
  // is the "teams" array.
  const primaryTeam: Team = combinedTeams[0] ?? 'T'

  const newLoadout: LoadoutInfo = {
    id: loadoutId,
    profile: profileName,
    team: primaryTeam,
    teams: combinedTeams,
    receivedAt: new Date().toISOString(),
    itemCount: combinedSkins.length,
  }

  const newState: SavedState = {
    version: 1,
    nextLoadoutId,
    skins: combinedSkins,
    loadout: newLoadout,
  }

  try {
    await queueSave(newState)

    selectedSkins = combinedSkins
    latestLoadout = newLoadout

    res.status(200).json({
      success: true,
      message: 'Loadout received, validated, and saved',
      loadout: latestLoadout,
      received: acceptedSkins.length,
      stored: selectedSkins.length,
      teams: combinedTeams,
    })
  } catch (error) {
    // Reuse this ID if the disk write failed.
    nextLoadoutId = loadoutId

    console.error('Failed to save loadout:', error)

    res.status(500).json({
      error: 'Loadout was not saved',
      details: ['The previous valid loadout has been preserved'],
    })
  }
})

if (process.env.N1SSAN_WEB_DIST) {
  const webDistDirectory = path.resolve(process.env.N1SSAN_WEB_DIST)
  const webIndexFile = path.join(webDistDirectory, 'index.html')

  app.get('/loadout', (_req, res, next) => {
    res.sendFile(webIndexFile, err => {
      if (err) next(err)
    })
  })

  app.use(express.static(webDistDirectory, {
    fallthrough: true,
    index: ['index.html'],
  }))
  console.log('Production web assets:', webDistDirectory)
}
app.use(
  (
    err: Error & { status?: number },
    _req: Request,
    res: Response,
    // FIXED: Express only recognises 4-argument middleware as an error
    // handler. The `next` parameter must be present in the signature even
    // though it is not called in this branch.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _next: NextFunction,
  ) => {
    if (err instanceof SyntaxError && err.status === 400) {
      res.status(400).json({
        error: 'Malformed JSON',
        details: ['Request body must contain valid JSON'],
      })
      return
    }

    console.error('n1ssan Bridge error:', err.message)

    res.status(500).json({
      error: 'Internal Bridge error',
    })
  },
)

async function start(): Promise<void> {
  // Create the sole persistent-data directory before any store reads or writes.
  await mkdir(DATA_DIRECTORY, { recursive: true })
  console.log('Canonical configuration directory:', DATA_DIRECTORY)
  if (process.env.NODE_ENV !== 'test') {
    await migrateLegacyConfigurations({
      dataDirectory: DATA_DIRECTORY,
      legacyRoot: process.cwd(),
    })
  }
  // If recovery fails, don't launch with empty state.
  await restoreState()
  await armoryStore.initialize()
  await equipmentStore.initialize(armoryStore.read())
  await loadoutStore.initialize()

  // Nothing is applied until the user picks a profile and clicks Apply to CS2.
  // The mode file is neutralised on every start: a selection belongs to the
  // session that made it, and the DLL ignores a selection it did not see change.
  await writeRuntimeMode('unknown')

  bridgeHttpServer = app.listen(PORT, HOST, () => {
    console.log(`n1ssan Bridge running at http://${HOST}:${PORT}`)
    console.log(`Health check: http://${HOST}:${PORT}/health`)
    console.log(`Latest received skins: http://${HOST}:${PORT}/skins`)
    console.log(`Persistent loadout data file: ${DATA_FILE}`)
    console.log(`Persistent Armory data file: ${ARMORY_FILE}`)
  })
  browserSessionSweep = setInterval(() => { void stopBridgeAfterBrowserSession() }, 2_000)
  attachmentSyncTimer = setInterval(syncObservedAttachments, 2_000)
}

async function syncObservedAttachments(): Promise<void> {
  try {
    await attachmentsSync.pollKills()
    const result = await attachmentsSync.poll()
    if (result.merged > 0) {
      const document = armoryStore.read()
      publishArmoryEvent('attachments-updated', {
        profileId: document.activeProfileId,
        revision: document.revision,
        merged: result.merged,
      })
      console.log(`Armory attachments merged into the profile: ${result.merged} item(s)`)
    } else if (result.reason !== 'idle' && result.reason !== 'no detection file' && result.reason !== 'no records') {
      console.log(`Armory attachments: ${result.reason}`)
    }
  } catch (error) {
    console.error('Armory attachment sync failed:', error instanceof Error ? error.message : error)
  }
}

void start().catch(error => {
  console.error('n1ssan Bridge could not start safely:', error)
  process.exitCode = 1
})
