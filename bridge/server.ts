import express from 'express'
import type { Request, Response, NextFunction } from 'express'
import { copyFile, readFile, writeFile, rename } from 'node:fs/promises'
import path from 'node:path'

const app = express()

const PORT = Number(process.env.N1SSAN_PORT ?? 3210)
const HOST = '127.0.0.1'
const MAX_ITEMS = 100
const DATA_FILE = process.env.N1SSAN_DATA_FILE
  ? path.resolve(process.env.N1SSAN_DATA_FILE)
  : path.join(process.cwd(), 'n1ssan-data.json')

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

        // FIXED: attach cause so the original backup error is preserved.
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
    // FIXED: attach cause so the original primary error is preserved.
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
      // FIXED: attach cause so the original error is preserved.
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
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  }

  if (req.method === 'OPTIONS') {
    res.sendStatus(204)
    return
  }

  next()
})

app.use(express.json({ limit: '500kb' }))

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    app: 'n1ssan-bridge',
    status: 'online',
    port: PORT,
    hasLoadout: latestLoadout !== null,
    itemCount: selectedSkins.length,
    storage: 'json-file',
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

  const { skins, profile, team } = req.body

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

  if (!isTeam(team)) {
    res.status(400).json({
      error: 'Invalid team',
      details: ['Team must be T or CT'],
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

  if (skins.some(skin => skin.team !== team)) {
    res.status(400).json({
      error: 'Team mismatch',
      details: ['Every submitted item must match the submitted team'],
    })
    return
  }

  const acceptedSkins = skins as BridgeSkin[]
  const profileName = profile.trim()

  // Preserve the other team's items when updating the same profile.
  // A different profile starts a fresh saved loadout.
  const preservedSkins =
    latestLoadout?.profile === profileName
      ? selectedSkins.filter(skin => skin.team !== team)
      : []

  const combinedSkins = [
    ...preservedSkins,
    ...acceptedSkins,
  ]

  if (combinedSkins.length > MAX_ITEMS) {
    res.status(400).json({
      error: 'Too many items in combined loadout',
      details: [`Maximum allowed items across both teams: ${MAX_ITEMS}`],
    })
    return
  }

  const loadoutId = nextLoadoutId++

  const combinedTeams = [
    ...new Set(combinedSkins.map(skin => skin.team)),
  ] as Team[]

  const newLoadout: LoadoutInfo = {
    id: loadoutId,
    profile: profileName,
    team,
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
    // Persist the complete combined loadout before reporting success.
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
    next: NextFunction,
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

  app.listen(PORT, HOST, () => {
    console.log(`n1ssan Bridge running at http://${HOST}:${PORT}`)
    console.log(`Health check: http://${HOST}:${PORT}/health`)
    console.log(`Latest received skins: http://${HOST}:${PORT}/skins`)
    console.log(`Persistent data file: ${DATA_FILE}`)
  })
}

void start().catch(error => {
  console.error('n1ssan Bridge could not start safely:', error)
  process.exitCode = 1
})