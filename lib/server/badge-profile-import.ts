import 'server-only'

import type { Encounter } from '../domain'
import { importPublicProfile, SocialImportError } from '../social-import'
import { storeSocialImport } from '../social-store'
import { getMongoDatabase } from '../mongodb'
import { AppError } from './errors'

type ImportRecord = {
  _id: string
  status: 'running' | 'completed' | 'failed'
  profileUrls: [string, string]
  profileIds?: [string, string]
  attempts: number
  createdAt: Date
  updatedAt: Date
  completedAt?: Date
}

export async function importEncounterProfiles(encounter: Encounter) {
  const database = await getMongoDatabase()
  const records = database.collection<ImportRecord>('badge_profile_imports')
  const existing = await records.findOne({ _id: encounter._id })
  if (existing?.status === 'completed') return existing
  if (existing?.status === 'running')
    throw new AppError(409, 'This badge encounter is already being imported.')

  const now = new Date()
  if (existing) {
    const claimed = await records.findOneAndUpdate(
      { _id: encounter._id, status: 'failed' },
      {
        $set: { status: 'running', updatedAt: now },
        $inc: { attempts: 1 },
        $unset: { completedAt: '' },
      },
      { returnDocument: 'after' },
    )
    if (!claimed)
      throw new AppError(409, 'This badge encounter is already being imported.')
  } else {
    try {
      await records.insertOne({
        _id: encounter._id,
        status: 'running',
        profileUrls: encounter.participants.map(
          (participant) => participant.profileUrl,
        ) as [string, string],
        attempts: 1,
        createdAt: now,
        updatedAt: now,
      })
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 11000
      )
        throw new AppError(
          409,
          'This badge encounter is already being imported.',
        )
      throw error
    }
  }

  try {
    const imported = await Promise.all(
      encounter.participants.map((participant, index) =>
        importPublicProfile(
          participant.profileUrl,
          index === 0 ? 'coral' : 'violet',
        ),
      ),
    )
    const stored = await Promise.all(imported.map(storeSocialImport))
    const profileIds = stored.map(({ profileId }) => profileId) as [
      string,
      string,
    ]
    await records.updateOne(
      { _id: encounter._id, status: 'running' },
      {
        $set: {
          status: 'completed',
          profileIds,
          completedAt: new Date(),
          updatedAt: new Date(),
        },
      },
    )
    return records.findOne({ _id: encounter._id })
  } catch (error) {
    await records.updateOne(
      { _id: encounter._id },
      { $set: { status: 'failed', updatedAt: new Date() } },
    )
    if (error instanceof SocialImportError)
      throw new AppError(error.status, error.message)
    throw error
  }
}
