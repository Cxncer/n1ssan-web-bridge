import { copyFile, readFile, mkdir, rm, rmdir, access, readdir, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const LEGACY_FILES = [
  'n1ssan-data.json',
  'n1ssan-data.json.bak',
  'armory-data.json',
  'armory-data.json.bak',
  'armory-equipment.json',
  'armory-equipment.json.bak',
  'armory-inventory.json',
  'armory-native-equipment.json',
  'runtime-mode.json',
  'loadout-profiles.json',
  'loadout-profiles.json.bak',
  'armory-detected-attachments.json',
  'armory-attachments-ack.json',
]

async function exists(file: string): Promise<boolean> {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

async function hash(file: string): Promise<string> {
  return createHash('sha256').update(await readFile(file)).digest('hex')
}

export async function migrateLegacyConfigurations(options: {
  dataDirectory: string
  legacyRoot: string
  backupRoot?: string
}): Promise<void> {
  const { dataDirectory, legacyRoot } = options
  const backupRoot = options.backupRoot ?? path.join(
    path.dirname(dataDirectory),
    'backups',
    `operation-reforge-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  )

  await mkdir(dataDirectory, { recursive: true })

  const sources = [
    ...LEGACY_FILES.map(name => ({
      file: path.join(legacyRoot, name),
      relative: `bridge-root/${name}`,
    })),
    ...LEGACY_FILES.map(name => ({
      file: path.join(legacyRoot, 'configs', name),
      relative: `bridge-configs/${name}`,
    })),
  ]

  for (const source of sources) {
    if (!(await exists(source.file))) continue

    if (!(await stat(source.file)).isFile()) {
      throw new Error(`Legacy configuration is not a regular file: ${source.file}`)
    }

    const backupFile = path.join(backupRoot, source.relative)
    await mkdir(path.dirname(backupFile), { recursive: true })

    if (await exists(backupFile)) {
      if (await hash(source.file) !== await hash(backupFile)) {
        throw new Error(`Backup verification failed: ${backupFile}`)
      }
    } else {
      await copyFile(source.file, backupFile)
      if (await hash(source.file) !== await hash(backupFile)) {
        throw new Error(`Backup verification failed: ${backupFile}`)
      }
    }

    const canonicalFile = path.join(dataDirectory, path.basename(source.file))

    if (!(await exists(canonicalFile))) {
      await copyFile(source.file, canonicalFile)

      if (await hash(source.file) !== await hash(canonicalFile)) {
        throw new Error(`Migration verification failed: ${canonicalFile}`)
      }
    }

    // Existing canonical files are preserved; the verified backup
    // retains the conflicting legacy version.
    await rm(source.file)
  }

  // Retire only an empty legacy directory. Unknown files and transient
  // runtime-mode acknowledgements are deliberately preserved.
  const legacyDirectory = path.join(legacyRoot, 'configs')
  if (await exists(legacyDirectory)) {
    const remaining = await readdir(legacyDirectory)
    if (remaining.length === 0) await rmdir(legacyDirectory)
  }
}
