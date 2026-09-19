/** Descriptive observations, not personality measurements or scoring features. */
export function writingStatistics(texts: string[]) {
  const count = texts.length
  const rate = (predicate: (text: string) => boolean) =>
    count ? texts.filter(predicate).length / count : 0
  return {
    count,
    meanWords: count
      ? texts.reduce((n, text) => n + text.trim().split(/\s+/).length, 0) /
        count
      : 0,
    questionRate: rate((text) => /[?？]/u.test(text)),
    emojiRate: rate((text) => /\p{Extended_Pictographic}/u.test(text)),
    punctuationPerMessage: count
      ? texts.reduce((n, text) => n + (text.match(/\p{P}/gu)?.length ?? 0), 0) /
        count
      : 0,
    contractionRate: rate((text) =>
      /\b\w+['’](?:t|s|re|ve|ll|d|m)\b/iu.test(text),
    ),
  }
}
