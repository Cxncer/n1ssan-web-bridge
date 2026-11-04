import express from 'express'
import type { Request, Response, NextFunction } from 'express'
import { copyFile, readFile, writeFile, rename } from 'node:fs/promises'
import path from 'node:path'
import {
  ArmoryRevisionConflictError,
  ArmoryStore,
  ArmoryValidationError,
} from './armory-store.ts'
import { createLocalIntegrationSnapshot } from '../src/integration/local-snapshot.ts'
import { ArmoryEquipmentStore, EquipmentRevisionConflictError, EquipmentValidationError } from './armory-equipment-store.ts'
import { validateArmoryEquipmentDocument } from '../src/armory/equipment.ts'
import { simulateLocalIntegration } from '../src/integration/simulator.ts'

const app = express()

const PORT = Number(process.env.N1SSAN_PORT ?? 3210)
const HOST = '127.0.0.1'
const MAX_ITEMS = 100
const DATA_FILE = process.env.N1SSAN_DATA_FILE
  ? path.resolve(process.env.N1SSAN_DATA_FILE)
  : path.join(process.cwd(), 'n1ssan-data.json')
const ARMORY_FILE = process.env.N1SSAN_ARMORY_FILE
  ? path.resolve(process.env.N1SSAN_ARMORY_FILE)
  : path.join(process.cwd(), 'armory-data.json')
const armoryStore = new ArmoryStore(ARMORY_FILE)
const EQUIPMENT_FILE = process.env.N1SSAN_EQUIPMENT_FILE
  ? path.resolve(process.env.N1SSAN_EQUIPMENT_FILE)
  : path.join(path.dirname(ARMORY_FILE), 'armory-equipment.json')
const equipmentStore = new ArmoryEquipmentStore(EQUIPMENT_FILE)

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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
  const temporaryFile = `${DATA_FILE}.tmp`
  const backupFile = `${DATA_FILE}.bak`
  const contents = `${JSON.stringify(state, null, 2)}\n`

  await writeFile(temporaryFile, contents, 'utf8')

  try {
    await copyFile(DATA_FILE, backupFile)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }

  await rename(temporaryFile, DATA_FILE)
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
  const backupFile = `${DATA_FILE}.bak`

  try {
    const saved = await readValidState(DATA_FILE)

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
    await readFile(DATA_FILE, 'utf8')

    const damagedCopy = `${DATA_FILE}.corrupt-${Date.now()}`
    await copyFile(DATA_FILE, damagedCopy)
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
  const recoveryFile = `${DATA_FILE}.recovery.tmp`

  await writeFile(
    recoveryFile,
    `${JSON.stringify(backup, null, 2)}\n`,
    'utf8',
  )

  await rename(recoveryFile, DATA_FILE)

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


app.get('/armory', (_req: Request, res: Response) => {
  res.json({ data: armoryStore.read() })
})

app.get('/armory/equipment', (_req: Request, res: Response) => {
  const armory = armoryStore.read()
  const data = equipmentStore.read()
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
  const data = createLocalIntegrationSnapshot(
    armoryStore.read(),
    selectedSkins,
    latestLoadout,
    undefined,
    equipmentStore.read(),
  )

  res.setHeader('Cache-Control', 'no-store')
  res.json({ data })
})


app.get('/integration/simulator', (_req: Request, res: Response) => {
  const snapshot = createLocalIntegrationSnapshot(
    armoryStore.read(),
    selectedSkins,
    latestLoadout,
    undefined,
    equipmentStore.read(),
  )
  const data = simulateLocalIntegration(snapshot)
  res.setHeader('Cache-Control', 'no-store')
  res.json({ data })
})


app.get('/health', (_req: Request, res: Response) => {
  res.json({
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
  // If recovery fails, don't launch with empty state.
  await restoreState()
  await armoryStore.initialize()
  await equipmentStore.initialize(armoryStore.read())

  app.listen(PORT, HOST, () => {
    console.log(`n1ssan Bridge running at http://${HOST}:${PORT}`)
    console.log(`Health check: http://${HOST}:${PORT}/health`)
    console.log(`Latest received skins: http://${HOST}:${PORT}/skins`)
    console.log(`Persistent loadout data file: ${DATA_FILE}`)
    console.log(`Persistent Armory data file: ${ARMORY_FILE}`)
  })
}

void start().catch(error => {
  console.error('n1ssan Bridge could not start safely:', error)
  process.exitCode = 1
})
