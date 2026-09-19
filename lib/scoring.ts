import {
  DIMENSIONS,
  featuresSchema,
  preferencesSchema,
  surveySchema,
  type DirectionalScore,
  type Features,
  type Preferences,
} from './domain'

export const ALGORITHM_VERSION = 'directional-fit-v1'
export function scoreCompatibility(
  preferences: Preferences,
  partner: Features,
): DirectionalScore {
  preferencesSchema.parse(preferences)
  featuresSchema.parse(partner)
  const eligible = DIMENSIONS.filter(
    (d) => preferences[d].desired !== null && preferences[d].importance > 0,
  )
  const breakdown = eligible.flatMap((dimension) => {
    const actual = partner[dimension]
    const { desired, importance } = preferences[dimension]
    return actual === null || desired === null
      ? []
      : [
          {
            dimension,
            desired,
            actual,
            importance,
            fit: 1 - Math.abs(desired - actual),
          },
        ]
  })
  const totalWeight = breakdown.reduce((sum, d) => sum + d.importance, 0)
  const eligibleWeight = eligible.reduce(
    (sum, d) => sum + preferences[d].importance,
    0,
  )
  return {
    score: totalWeight
      ? Math.round(
          (100 * breakdown.reduce((sum, d) => sum + d.importance * d.fit, 0)) /
            totalWeight,
        )
      : null,
    coverage: eligibleWeight ? totalWeight / eligibleWeight : 0,
    knownDimensions: breakdown.length,
    eligibleDimensions: eligible.length,
    breakdown,
  }
}
export function scoreTipi(input: number[]) {
  const a = surveySchema.parse(input)
  return {
    extraversion: (a[0] + 8 - a[5]) / 2,
    agreeableness: (8 - a[1] + a[6]) / 2,
    conscientiousness: (a[2] + 8 - a[7]) / 2,
    emotionalStability: (8 - a[3] + a[8]) / 2,
    openness: (a[4] + 8 - a[9]) / 2,
  }
}
