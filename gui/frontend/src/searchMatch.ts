export interface SearchMatch {
  kind: 'exact' | 'fuzzy'
  value: string
  distance: number
}

export interface SearchMatchOptions {
  /** Fuzzy matching is disabled below this token length. */
  minimumFuzzyLength?: number
}

export function normalizeSearchText(value: string): string {
  return value.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function searchEditDistance(left: string, right: string): number {
  if (left === right) return 0
  if (!left.length) return right.length
  if (!right.length) return left.length
  const previous = Array.from(
    { length: right.length + 1 },
    (_, index) => index,
  )
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0]
    previous[0] = row
    for (let column = 1; column <= right.length; column += 1) {
      const old = previous[column]
      previous[column] = Math.min(
        previous[column] + 1,
        previous[column - 1] + 1,
        diagonal + (left[row - 1] === right[column - 1] ? 0 : 1),
      )
      diagonal = old
    }
  }
  return previous[right.length]
}

function fuzzyTokenDistance(
  queryToken: string,
  candidateToken: string,
  minimumFuzzyLength: number,
): number | undefined {
  if (queryToken.length < minimumFuzzyLength) return undefined
  if (candidateToken.length < Math.max(3, queryToken.length - 2)) {
    return undefined
  }
  const candidatePrefix = candidateToken.slice(0, queryToken.length)
  const longest = Math.max(queryToken.length, candidatePrefix.length)
  const distance = searchEditDistance(queryToken, candidatePrefix)
  const allowedDistance = queryToken.length <= 5
    ? 1
    : queryToken.length <= 10
      ? 2
      : Math.max(2, Math.floor(queryToken.length * 0.18))
  return distance <= allowedDistance
    && (longest - distance) / longest >= 0.72
    ? distance
    : undefined
}

export function findSearchMatch(
  queryValue: string,
  candidateValues: Array<string | null | undefined>,
  options: SearchMatchOptions = {},
): SearchMatch | undefined {
  const query = normalizeSearchText(queryValue)
  if (!query) return undefined
  const candidates = candidateValues
    .filter((value): value is string => Boolean(value?.trim()))
    .map(value => ({ original: value, normalized: normalizeSearchText(value) }))
  const exact = candidates.find(candidate =>
    candidate.normalized.includes(query))
  if (exact) return { kind: 'exact', value: exact.original, distance: 0 }

  const minimumFuzzyLength = options.minimumFuzzyLength ?? 4
  const queryTokens = query.split(' ')
    .filter(token => token.length >= minimumFuzzyLength)
  if (!queryTokens.length) return undefined

  let best: SearchMatch | undefined
  for (const candidate of candidates) {
    const candidateTokens = candidate.normalized.split(' ').filter(Boolean)
    let totalDistance = 0
    let matches = true
    for (const queryToken of queryTokens) {
      const distances = candidateTokens
        .map(token =>
          fuzzyTokenDistance(queryToken, token, minimumFuzzyLength))
        .filter((distance): distance is number => distance != null)
      if (!distances.length) {
        matches = false
        break
      }
      totalDistance += Math.min(...distances)
    }
    if (matches && (!best || totalDistance < best.distance)) {
      best = {
        kind: 'fuzzy',
        value: candidate.original,
        distance: totalDistance,
      }
    }
  }
  return best
}

export function matchesSearchQuery(
  query: string,
  candidateValues: Array<string | null | undefined>,
  options?: SearchMatchOptions,
): boolean {
  if (!normalizeSearchText(query)) return true
  const populated = candidateValues
    .filter((value): value is string => Boolean(value?.trim()))
  return Boolean(findSearchMatch(
    query,
    [...populated, populated.join(' ')],
    options,
  ))
}
