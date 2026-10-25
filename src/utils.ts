export function parseJsonStringArray(value: unknown): string[] {
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}

export function toTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0)
}

/** 去掉空项和超长项，忽略大小写去重，最多保留 maxItems 项。 */
export function normalizeMetadataList(
  value: string[],
  maxItems: number,
  maxLength: number
): string[] {
  const result: string[] = []
  const seen = new Set<string>()

  for (const item of value) {
    const normalized = typeof item === 'string' ? item.trim().replace(/\s+/g, ' ') : ''
    if (!normalized || normalized.length > maxLength) continue

    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(normalized)

    if (result.length >= maxItems) break
  }

  return result
}

export function getDailyKey(timestamp = Date.now()): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
