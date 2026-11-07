import { readFile, rename, writeFile } from 'node:fs/promises'
import type { ArmoryDocument, ItemAttachments } from '../src/armory/contracts.ts'
import { validateAttachments } from '../src/armory/contracts.ts'

/**
 * Merges sticker / charm state that the native runtime observed in CS2 into the
 * Armory profile.
 *
 * The DLL writes a detection file when the player changes a weapon's stickers or
 * charm in the game's own inventory screen; the Bridge is the only writer of
 * `armory-data.json`, so it validates and merges those records here. Nothing is
 * ever applied to the game from this direction.
 */

export type DetectedRecord = {
  seq?: unknown
  instanceId?: unknown
  projectedItemId?: unknown
  complete?: unknown
  stableForMs?: unknown
  observedAt?: unknown
  attachments?: unknown
  consumedToolInstanceId?: unknown
  consumedToolKind?: unknown
}

export type DetectionDocument = {
  source?: unknown
  profileId?: unknown
  inventoryRevision?: unknown
  seq?: unknown
  records?: unknown
}

export type AttachmentsSyncOptions = {
  detectionPath: string
  ackPath: string
  read: () => ArmoryDocument
  replace: (expectedRevision: number, candidate: unknown) => Promise<ArmoryDocument>
  /** Called after a successful merge, e.g. to re-project the inventory. */
  onMerged?: (mergedInstanceIds: string[]) => Promise<void>
}

export type AttachmentsSyncResult = {
  merged: number
  skipped: number
  ackedSeq: number
  reason: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asSeq(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

export class AttachmentsSync {
  private readonly options: AttachmentsSyncOptions
  private lastAckedSeq = 0
  private running = false

  constructor(options: AttachmentsSyncOptions) {
    this.options = options
  }

  /** One poll. Safe to call on an interval; overlapping calls are skipped. */
  async poll(): Promise<AttachmentsSyncResult> {
    const empty: AttachmentsSyncResult = { merged: 0, skipped: 0, ackedSeq: this.lastAckedSeq, reason: 'idle' }

    if (this.running) return { ...empty, reason: 'busy' }
    this.running = true

    try {
      return await this.mergeOnce()
    } finally {
      this.running = false
    }
  }

  private async mergeOnce(): Promise<AttachmentsSyncResult> {
    const document = this.options.read()
    const detection = await this.readDetection()

    if (!detection) {
      return { merged: 0, skipped: 0, ackedSeq: this.lastAckedSeq, reason: 'no detection file' }
    }

    const records = Array.isArray(detection.records) ? detection.records : []
    if (records.length === 0) {
      return { merged: 0, skipped: 0, ackedSeq: this.lastAckedSeq, reason: 'no records' }
    }

    // A record is only trustworthy for the profile and projection it was read
    // from. A mismatched revision means the profile changed under the game, so
    // the observation describes an inventory that no longer exists.
    if (detection.profileId !== document.activeProfileId) {
      return this.ack(detection, 'records belong to another profile')
    }

    if (asSeq(detection.inventoryRevision) !== document.revision) {
      return this.ack(detection, 'records belong to another inventory revision')
    }

    const profile = document.profiles.find(candidate => candidate.id === document.activeProfileId)
    if (!profile) {
      return this.ack(detection, 'active profile is missing')
    }

    const candidate = structuredClone(document) as ArmoryDocument
    const candidateProfile = candidate.profiles.find(item => item.id === candidate.activeProfileId)
    if (!candidateProfile) {
      return this.ack(detection, 'active profile is missing')
    }

    const mergedInstanceIds: string[] = []
    let skipped = 0
    let highestSeq = this.lastAckedSeq

    for (const raw of records) {
      if (!isRecord(raw)) {
        skipped += 1
        continue
      }

      const record = raw as DetectedRecord
      const seq = asSeq(record.seq)
      if (seq <= this.lastAckedSeq) continue
      highestSeq = Math.max(highestSeq, seq)

      if (record.complete !== true) {
        skipped += 1
        continue
      }

      const instanceId = typeof record.instanceId === 'string' ? record.instanceId : ''
      const instance = instanceId
        ? candidateProfile.items.find(item => item.id === instanceId)
        : undefined

      if (!instance) {
        skipped += 1
        continue
      }

      if (instance.attachments?.origin === 'manual') {
        // Explicitly authored data is never replaced by an observation.
        skipped += 1
        continue
      }

      // The DLL reports the attributes only; provenance is the Bridge's to add.
      const observed: ItemAttachments = {
        ...(record.attachments as Omit<ItemAttachments, 'origin' | 'observedAt' | 'observedInventoryRevision'>),
        origin: 'native',
        observedAt: typeof record.observedAt === 'string' ? record.observedAt : new Date().toISOString(),
        observedInventoryRevision: document.revision,
      }

      const errors = validateAttachments(observed, `items[${instanceId}]`)
      if (errors.length > 0) {
        skipped += 1
        continue
      }

      const consumedToolId =
        typeof record.consumedToolInstanceId === 'string' ? record.consumedToolInstanceId : ''
      const consumedToolKind =
        record.consumedToolKind === 'sticker' || record.consumedToolKind === 'charm'
          ? record.consumedToolKind
          : null

      // The same detection record can be replayed if the Bridge stops after
      // committing the profile but before writing its acknowledgement. The
      // sourceInstanceId embedded in the attachment makes consumption idempotent.
      const sourceAlreadyRecorded = consumedToolId !== '' && (
        instance.attachments?.stickers.some(sticker => sticker.sourceInstanceId === consumedToolId) ||
        instance.attachments?.charm?.sourceInstanceId === consumedToolId
      )

      if (consumedToolId && consumedToolKind && !sourceAlreadyRecorded) {
        const toolIndex = candidateProfile.items.findIndex(item => item.id === consumedToolId)
        const tool = toolIndex >= 0 ? candidateProfile.items[toolIndex] : undefined

        if (tool && tool.kind === consumedToolKind && Number.isSafeInteger(tool.quantity) && tool.quantity > 0) {
          if (tool.quantity === 1) {
            candidateProfile.items.splice(toolIndex, 1)
          } else {
            tool.quantity -= 1
            tool.updatedAt = new Date().toISOString()
          }
        } else {
          // Keep the attachment observation even if its source item is already
          // absent or inconsistent; never consume a different item by guess.
          skipped += 1
        }
      }

      instance.attachments = observed
      instance.updatedAt = new Date().toISOString()
      mergedInstanceIds.push(instanceId)
    }

    if (mergedInstanceIds.length === 0) {
      return this.ack({ seq: highestSeq }, 'nothing to merge')
    }

    candidateProfile.updatedAt = new Date().toISOString()

    try {
      await this.options.replace(document.revision, candidate)
    } catch (error) {
      // A concurrent write wins; the records stay pending and are retried with
      // the new revision, so no observation is lost or applied twice.
      console.error('Attachment merge deferred:', error instanceof Error ? error.message : error)
      return { merged: 0, skipped, ackedSeq: this.lastAckedSeq, reason: 'revision conflict' }
    }

    if (this.options.onMerged) {
      await this.options.onMerged(mergedInstanceIds)
    }

    return this.ack({ seq: highestSeq }, `merged ${mergedInstanceIds.length}`, mergedInstanceIds.length)
  }

  private async readDetection(): Promise<DetectionDocument | null> {
    try {
      const text = await readFile(this.options.detectionPath, 'utf8')
      const parsed: unknown = JSON.parse(text)
      return isRecord(parsed) ? (parsed as DetectionDocument) : null
    } catch {
      return null
    }
  }

  private async ack(
    detection: { seq?: unknown },
    reason: string,
    merged = 0,
  ): Promise<AttachmentsSyncResult> {
    const seq = asSeq(detection.seq)

    if (seq > this.lastAckedSeq) {
      this.lastAckedSeq = seq
      const temporaryPath = `${this.options.ackPath}.tmp`
      const payload = `${JSON.stringify({ ackedSeq: seq, updatedAt: new Date().toISOString() }, null, 2)}\n`

      try {
        await writeFile(temporaryPath, payload, 'utf8')
        await rename(temporaryPath, this.options.ackPath)
      } catch (error) {
        console.error('Attachment ack could not be written:', error instanceof Error ? error.message : error)
      }
    }

    return { merged, skipped: 0, ackedSeq: this.lastAckedSeq, reason }
  }
}
