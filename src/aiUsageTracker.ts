import type { Context } from 'koishi'
import fs from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'
import { withStorageLock } from './storage'
import { getDailyKey } from './utils'

/** 用量达到每日上限的这个比例时在日志里提醒一次。 */
const WARN_RATIO = 0.8

interface Usage { day: string; requests: number; retries: number; successes: number; failures: number }

export class AIUsageTracker {
  private usage: Usage = this.empty()
  private warned = false
  private get filename() { return path.resolve(this.ctx.baseDir, 'data/chatluna-memes/.ai-usage.json') }
  constructor(private ctx: Context, private getDailyLimit: () => number) {}
  private get dailyLimit() { return this.getDailyLimit() }
  private empty(): Usage { return { day: getDailyKey(), requests: 0, retries: 0, successes: 0, failures: 0 } }

  private async read(): Promise<Usage> {
    try {
      const usage = JSON.parse(await fs.readFile(this.filename, 'utf8')) as Usage
      if (typeof usage.day !== 'string' || !['requests', 'retries', 'successes', 'failures'].every((key) => Number.isSafeInteger(usage[key]) && usage[key] >= 0)) {
        throw new Error('Invalid AI usage ledger')
      }
      return usage.day === getDailyKey() ? usage : this.empty()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return this.empty()
      throw error
    }
  }

  async initialize() { this.usage = await this.read() }

  private async update(operation: (usage: Usage) => boolean | void): Promise<boolean> {
    return withStorageLock(this.filename, async () => {
      const usage = await this.read()
      if (operation(usage) === false) { this.usage = usage; return false }
      const dir = path.dirname(this.filename)
      await fs.mkdir(dir, { recursive: true })
      const temp = `${this.filename}.${randomUUID()}.tmp`
      try {
        await fs.writeFile(temp, JSON.stringify(usage), { flag: 'wx', mode: 0o600 })
        await fs.rename(temp, this.filename)
      } finally { await fs.rm(temp, { force: true }) }
      this.usage = usage
      return true
    })
  }

  /** 每次请求前持久化预占，包括失败请求及重试。 */
  async reserveRequest(retry = false, onReserved?: (day: string) => void): Promise<boolean> {
    if (this.usage.day !== getDailyKey()) this.warned = false
    let reservedDay: string
    const allowed = await this.update((usage) => {
      if (this.dailyLimit > 0 && usage.requests >= this.dailyLimit) return false
      usage.requests++
      if (retry) usage.retries++
      reservedDay = usage.day
    })
    if (allowed) onReserved?.(reservedDay!)
    if (allowed && this.dailyLimit > 0 && !this.warned && this.usage.requests / this.dailyLimit >= WARN_RATIO) {
      this.warned = true
      this.ctx.logger('chatluna-memes').warn(`AI 请求用量 ${this.usage.requests}/${this.dailyLimit}，接近每日上限`)
    }
    return allowed
  }

  async recordResult(success: boolean, day = getDailyKey()) {
    await this.update((usage) => {
      if (usage.day !== day) return false
      if (success) usage.successes++
      else usage.failures++
    })
  }

  getStats() {
    const usage = this.usage.day === getDailyKey() ? this.usage : this.empty()
    return {
      ...usage, dailyCount: usage.requests, dailyLimit: this.dailyLimit,
      remaining: this.dailyLimit > 0 ? Math.max(0, this.dailyLimit - usage.requests) : -1,
      usagePercent: this.dailyLimit > 0 ? usage.requests / this.dailyLimit * 100 : 0,
    }
  }

}
