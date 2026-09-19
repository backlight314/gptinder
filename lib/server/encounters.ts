import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import type { BumpEvent } from '../badge-protocol'
import { canonicalHandshake } from '../badge-protocol'
import type { Encounter, EncounterResponse, FrozenParticipant } from '../domain'
import { scoreCompatibility } from '../scoring'
import { collections, transaction } from './db'
import { hashSecret } from './auth'
import { AppError, requireValue } from './errors'

export async function requireEncounter(encounterId: string, userId: string) {
  const c = await collections()
  const encounter = requireValue(
    await c.encounters.findOne({
      _id: encounterId,
      'participants.userId': userId,
    }),
    'Encounter not found.',
  )
  if (
    await c.profiles.countDocuments({
      _id: { $in: encounter.participants.map((p) => p.profileVersionId) },
      invalidatedAt: { $exists: true },
    })
  )
    throw new AppError(
      410,
      'This encounter is unavailable because a participant deleted an imported source.',
    )
  return encounter
}
export async function createEncounter(
  userId: string,
  event: BumpEvent,
): Promise<Encounter> {
  const c = await collections()
  const handshakeKey = createHash('sha256')
    .update(canonicalHandshake(event))
    .digest('hex')
  return transaction(async (session) => {
    const now = new Date()
    const local = requireValue(
      await c.badges.findOne(
        {
          tokenHash: hashSecret(event.localToken),
          status: 'active',
          expiresAt: { $gt: now },
          userId,
        },
        { session },
      ),
      'The connected badge is not bound to your account or has expired.',
    )
    const peer = requireValue(
      await c.badges.findOne(
        {
          tokenHash: hashSecret(event.peerToken),
          status: 'active',
          expiresAt: { $gt: now },
        },
        { session },
      ),
      'The other badge is not bound or has expired.',
    )
    if (peer.userId === local.userId)
      throw new AppError(400, 'An encounter needs two different people.')
    const existing = await c.encounters.findOne({ handshakeKey }, { session })
    if (existing) return existing
    const participants: FrozenParticipant[] = []
    // Sequential reads: MongoDB sessions do not support parallel transaction operations.
    for (const id of [local.userId, peer.userId]) {
      const user = requireValue(await c.users.findOne({ _id: id }, { session }))
      const consent = requireValue(
        await c.consents.findOne(
          { userId: id },
          { session, sort: { createdAt: -1 } },
        ),
      )
      if (
        !user.profileVersionId ||
        !user.preferenceVersionId ||
        !consent.flags.sharedProfile ||
        !consent.flags.aiProcessing
      )
        throw new AppError(
          409,
          'Both people must approve their profiles and sharing before an encounter.',
        )
      participants.push({
        userId: id,
        name: user.displayName,
        profileVersionId: user.profileVersionId,
        preferenceVersionId: user.preferenceVersionId,
      })
    }
    const encounter: Encounter = {
      _id: randomUUID(),
      handshakeKey,
      participants: participants as Encounter['participants'],
      status: 'pending_start',
      createdAt: now,
    }
    await c.encounters.insertOne(encounter, { session })
    return encounter
  }).catch(async (error) => {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 11000
    )
      return requireValue(
        await c.encounters.findOne({
          handshakeKey,
          'participants.userId': userId,
        }),
      )
    throw error
  })
}
export async function getEncounter(
  encounterId: string,
  userId: string,
): Promise<EncounterResponse> {
  const c = await collections()
  const encounter = await requireEncounter(encounterId, userId)
  const [profiles, messages, result] = await Promise.all([
    c.profiles
      .find(
        { _id: { $in: encounter.participants.map((p) => p.profileVersionId) } },
        { projection: { _id: 1, userId: 1, shareable: 1, avatarSeed: 1 } },
      )
      .toArray(),
    c.messages.find({ encounterId }).sort({ turnNumber: 1 }).limit(6).toArray(),
    c.results.findOne({ encounterId }),
  ])
  const self = requireValue(
    encounter.participants.find((p) => p.userId === userId),
  )
  const current = requireValue(
    await c.preferences.findOne({ _id: self.preferenceVersionId }),
  )
  const partner = profiles.find((p) => p.userId !== userId)
  const previous = current.previousVersionId
    ? await c.preferences.findOne({ _id: current.previousVersionId, userId })
    : null
  const comparison =
    previous && partner
      ? {
          previousVersion: previous.version,
          currentVersion: current.version,
          previous: scoreCompatibility(
            previous.dimensions,
            partner.shareable.features,
          ),
          current: scoreCompatibility(
            current.dimensions,
            partner.shareable.features,
          ),
        }
      : null
  return { encounter, profiles, messages, result, comparison }
}
