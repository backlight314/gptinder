const words = (text: string) =>
  text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
/** Conservative copy check; model audits and human review address semantic disclosure. */
export function copiesPrivatePassage(output: string, samples: string[]) {
  const target = words(output).join(' ')
  return samples.some((sample) => {
    const tokens = words(sample)
    if (tokens.length < 5) return false
    for (let i = 0; i <= tokens.length - 5; i++)
      if (target.includes(tokens.slice(i, i + 5).join(' '))) return true
    return false
  })
}
function signature(text: string) {
  const tokens = words(text)
  return [
    Math.min(tokens.length, 100) / 100,
    Math.min((text.match(/\p{Extended_Pictographic}/gu) ?? []).length, 5) / 5,
    Math.min((text.match(/[!?]/g) ?? []).length, 5) / 5,
  ]
}
export function styleDistance(output: string, heldOut: string[]) {
  if (!heldOut.length) return null
  const target = signature(output)
  const average = [0, 0, 0]
  for (const sample of heldOut)
    signature(sample).forEach((value, i) => {
      average[i] += value / heldOut.length
    })
  return (
    Math.round(
      (100 *
        target.reduce(
          (sum, value, i) => sum + Math.abs(value - average[i]),
          0,
        )) /
        3,
    ) / 100
  )
}
