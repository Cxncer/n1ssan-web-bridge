import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, access, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { migrateLegacyConfigurations } from './config-migration.ts'

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'n1ssan-migration-'))
  const legacyRoot = path.join(root, 'bridge')
  const dataDirectory = path.join(root, 'local', 'n1ssan', 'configs')
  const backupRoot = path.join(root, 'backups', 'test')
  await mkdir(legacyRoot, { recursive: true })
  await mkdir(path.join(legacyRoot, 'configs'), { recursive: true })

  return {
    root,
    legacyRoot,
    dataDirectory,
    backupRoot,
    run: () => migrateLegacyConfigurations({
      legacyRoot,
      dataDirectory,
      backupRoot,
    }),
  }
}

test('backs up and verifies legacy files before migrating them', async () => {
  const env = await setup()
  try {
    const source = path.join(env.legacyRoot, 'n1ssan-data.json')
    await writeFile(source, '{"skins":[1]}')

    await env.run()

    assert.equal(
      await readFile(path.join(env.dataDirectory, 'n1ssan-data.json'), 'utf8'),
      '{"skins":[1]}',
    )
    assert.equal(
      await readFile(path.join(env.backupRoot, 'bridge-root', 'n1ssan-data.json'), 'utf8'),
      '{"skins":[1]}',
    )
    await assert.rejects(access(source))
  } finally {
    await rm(env.root, { recursive: true, force: true })
  }
})

test('never overwrites canonical data and preserves conflicts in backup', async () => {
  const env = await setup()
  try {
    const source = path.join(env.legacyRoot, 'configs', 'armory-data.json')
    await mkdir(env.dataDirectory, { recursive: true })
    await writeFile(source, '{"legacy":true}')
    await writeFile(path.join(env.dataDirectory, 'armory-data.json'), '{"canonical":true}')

    await env.run()

    assert.equal(
      await readFile(path.join(env.dataDirectory, 'armory-data.json'), 'utf8'),
      '{"canonical":true}',
    )
    assert.equal(
      await readFile(path.join(env.backupRoot, 'bridge-configs', 'armory-data.json'), 'utf8'),
      '{"legacy":true}',
    )
    await assert.rejects(access(source))
  } finally {
    await rm(env.root, { recursive: true, force: true })
  }
})

test('does not migrate or archive transient runtime acknowledgements', async () => {
  const env = await setup()
  try {
    const source = path.join(env.legacyRoot, 'configs', 'runtime-mode-active.json')
    await writeFile(source, '{"active":true}')

    await env.run()

    assert.equal(await readFile(source, 'utf8'), '{"active":true}')
    await assert.rejects(access(path.join(env.dataDirectory, 'runtime-mode-active.json')))
    await assert.rejects(access(path.join(env.backupRoot, 'bridge-configs', 'runtime-mode-active.json')))
  } finally {
    await rm(env.root, { recursive: true, force: true })
  }
})

test('preserves legacy source when backup verification fails', async () => {
  const env = await setup()
  try {
    const source = path.join(env.legacyRoot, 'n1ssan-data.json')
    const backup = path.join(env.backupRoot, 'bridge-root', 'n1ssan-data.json')

    await writeFile(source, '{"skins":[2]}')
    await mkdir(backup, { recursive: true })

    await assert.rejects(env.run())
    assert.equal(await readFile(source, 'utf8'), '{"skins":[2]}')
    await assert.rejects(access(path.join(env.dataDirectory, 'n1ssan-data.json')))
  } finally {
    await rm(env.root, { recursive: true, force: true })
  }
})
