import { createHash } from 'node:crypto'
import type { FrozenProfile, ManualPersona } from './schemas'

const emptyMeasure = () => ({ score: null, evidenceIds: [] as string[] })

function versionId(userId: string, persona: ManualPersona) {
  const digest = createHash('sha256').update(JSON.stringify(persona)).digest('hex').slice(0, 16)
  return `${userId}:psychology:${digest}`
}

function explicit(id: string, description: string) {
  return { description, evidenceIds: [id] }
}

export function buildFrozenProfile(userId: string, persona: ManualPersona): FrozenProfile {
  const approvedAt = new Date().toISOString()
  const ids = {
    bio: `${userId}:bio`, traits: `${userId}:traits`, style: `${userId}:style`,
    interests: `${userId}:interests`, values: `${userId}:values`,
    children: `${userId}:children`, relationshipType: `${userId}:relationship_type`,
    planning: `${userId}:planning`, communication: `${userId}:communication`,
  }
  const evidence = [
    { id: ids.bio, source: 'explicit_user_answer' as const, statement: persona.bio },
    { id: ids.traits, source: 'explicit_user_answer' as const, statement: persona.traits.join(', ') },
    { id: ids.style, source: 'explicit_user_answer' as const, statement: persona.style },
    { id: ids.interests, source: 'explicit_user_answer' as const, statement: persona.interests.join(', ') },
    { id: ids.values, source: 'explicit_user_answer' as const, statement: persona.values.join(', ') || 'not_disclosed' },
    { id: ids.children, source: 'explicit_user_answer' as const, statement: persona.lifeGoals.wantChildren },
    { id: ids.relationshipType, source: 'explicit_user_answer' as const, statement: persona.lifeGoals.relationshipType },
    { id: ids.planning, source: 'explicit_user_answer' as const, statement: persona.relationshipPreferences.planning },
    { id: ids.communication, source: 'explicit_user_answer' as const, statement: persona.relationshipPreferences.communication },
  ]

  // BFI 2 informed the five behavior domains and the rule that unmeasured scores stay null. https://doi.org/10.1037/pspp0000096
  // Personality state research informed contextual tendencies that remain tied to evidence. https://doi.org/10.1177/10731911211008254
  const behavior = {
    bigFive: {
      extraversion: emptyMeasure(), agreeableness: emptyMeasure(),
      conscientiousness: emptyMeasure(), negativeEmotionality: emptyMeasure(), openness: emptyMeasure(),
    },
    contextualTendencies: {
      selfDescribedTraits: explicit(ids.traits, persona.traits.join(', ')),
      interests: explicit(ids.interests, persona.interests.join(', ')),
    },
    evidenceIds: [ids.traits, ids.interests],
  }

  // The interpersonal circumplex informed warmth and dominance fields. https://doi.org/10.1177/1073191109340382
  // Romantic conflict findings informed reciprocal interaction tendencies. https://doi.org/10.1002/ejsp.2937
  const interpersonal = {
    warmth: emptyMeasure(),
    dominance: emptyMeasure(),
    interactionTendencies: { communicationStyle: explicit(ids.style, persona.style) },
    evidenceIds: [ids.style],
  }

  // ECR RS informed continuous anxiety and avoidance fields with relationship specific evidence. https://doi.org/10.1037/a0022898
  // The emotion regulation review informed regulation preference fields. https://doi.org/10.3390/brainsci13060884
  const attachmentRegulation = {
    anxiety: emptyMeasure(),
    avoidance: emptyMeasure(),
    regulationPreferences: {
      communication: explicit(ids.communication, persona.relationshipPreferences.communication),
    },
    evidenceIds: [ids.communication],
  }

  // The refined Schwartz theory informed personal value storage. https://doi.org/10.1037/a0029393
  // Relationship value research informed value evidence without causal claims. https://doi.org/10.1177/01461672231156975
  const values = {
    personalValues: Object.fromEntries(persona.values.map(value => [value, explicit(ids.values, value)])),
    explicitLifeGoals: {
      wantChildren: explicit(ids.children, persona.lifeGoals.wantChildren),
      relationshipType: explicit(ids.relationshipType, persona.lifeGoals.relationshipType),
    },
    relationshipPreferences: {
      planning: explicit(ids.planning, persona.relationshipPreferences.planning),
      communication: explicit(ids.communication, persona.relationshipPreferences.communication),
    },
    evidenceIds: [ids.values, ids.children, ids.relationshipType, ids.planning, ids.communication],
  }

  return {
    profileVersionId: versionId(userId, persona), userId, name: persona.name,
    version: 1, approvedAt, evidence, behavior, interpersonal, attachmentRegulation,
    values, communicationStyleExamples: [persona.style],
  }
}

export function evidenceIds(profile: FrozenProfile) {
  return new Set(profile.evidence.map(item => item.id))
}

export function validateProfileEvidence(profile: FrozenProfile, used: string[]) {
  const allowed = evidenceIds(profile)
  const invalid = used.filter(id => !allowed.has(id))
  if (invalid.length) throw new Error(`Unknown profile evidence: ${invalid.join(', ')}`)
}
