import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { AIUsageTracker } from '../src/aiUsageTracker'
import { AnnotationScheduler } from '../src/annotation-scheduler'
import { AnnotationQueue } from '../src/annotation-queue'

const roots: string[] = []
afterEach(async () => { vi.useRealTimers(); await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))) })

async function tracker(limit: number) {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatluna-memes-ai-'))
  roots.push(baseDir)
  const ctx = { baseDir, logger: () => ({ warn: vi.fn() }) } as any
  return { instance: new AIUsageTracker(ctx, () => limit), ctx }
}

describe('AI 配额及调度', () => {
  it('并发请求在上限处原子预占，失败及重试计数跨实例保留', async () => {
    const { instance, ctx } = await tracker(3)
    const sibling = new AIUsageTracker(ctx, () => 3)
    const outcomes = await Promise.all([instance.reserveRequest(), sibling.reserveRequest(true), instance.reserveRequest(), sibling.reserveRequest()])
    expect(outcomes.filter(Boolean)).toHaveLength(3)
    await instance.recordResult(false)
    await instance.recordResult(true)
    const restored = new AIUsageTracker(ctx, () => 3)
    await restored.initialize()
    expect(restored.getStats()).toMatchObject({ requests: 3, retries: 1, successes: 1, failures: 1, remaining: 0 })
    expect(await restored.reserveRequest()).toBe(false)
  })
  it('损坏配额文件不会被静默重置或允许新请求', async () => {
    const { instance, ctx } = await tracker(3)
    const dir = path.join(ctx.baseDir, 'data/chatluna-memes')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, '.ai-usage.json'), 'invalid')
    await expect(instance.reserveRequest()).rejects.toThrow()
    expect(await fs.readFile(path.join(dir, '.ai-usage.json'), 'utf8')).toBe('invalid')
  })
  it('新 UTC 日期重置请求计数', async () => {
    const { instance } = await tracker(1)
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-09T23:59:00Z'))
    expect(await instance.reserveRequest()).toBe(true)
    expect(await instance.reserveRequest()).toBe(false)
    vi.setSystemTime(new Date('2026-10-10T00:01:00Z'))
    expect(await instance.reserveRequest()).toBe(true)
  })
  it('请求超时后保持底层占用槽位，直到底层结束，防止并发超限', async () => {
    const scheduler = new AnnotationScheduler(() => 1)
    const controller = new AbortController()
    let finish: (value: string) => void
    const first = scheduler.run(() => new Promise<string>((resolve) => { finish = resolve }), controller.signal, 5)
    const secondOperation = vi.fn(async () => 'second')
    const second = scheduler.run(secondOperation, controller.signal, 1000)
    await expect(first).rejects.toThrow('timed out')
    expect(secondOperation).not.toHaveBeenCalled()
    expect(scheduler.stats.active).toBe(1)
    finish!('late result')
    await expect(second).resolves.toBe('second')
  })
  it('取消排队任务不调用底层模型', async () => {
    const scheduler = new AnnotationScheduler(() => 1)
    const a = new AbortController()
    const b = new AbortController()
    let finish: () => void
    const first = scheduler.run(() => new Promise<void>((resolve) => { finish = resolve }), a.signal, 1000)
    const operation = vi.fn(async () => 'should not run')
    const second = scheduler.run(operation, b.signal, 1000)
    b.abort()
    await expect(second).rejects.toThrow('cancelled')
    finish!()
    await first
    expect(operation).not.toHaveBeenCalled()
  })
  it('底层模型忽略取消时排队任务仍有等待超时', async () => {
    const scheduler = new AnnotationScheduler(() => 1)
    const controller = new AbortController()
    let finish: () => void
    const first = scheduler.run(() => new Promise<void>((resolve) => { finish = resolve }), controller.signal, 5)
    const operation = vi.fn(async () => 'should not run')
    const second = scheduler.run(operation, controller.signal, 10)
    await expect(first).rejects.toThrow('timed out')
    await expect(second).rejects.toThrow('waiting for a slot')
    expect(operation).not.toHaveBeenCalled()
    finish!()
  })
  it('任务队列记录跳过和失败；进度回调异常不重复计数', async () => {
    const queue = new AnnotationQueue()
    const result = await queue.enqueue([1, 2, 3], 2, async (row) => row === 1 ? 'success' : row === 2 ? 'skipped' : 'fail', () => { throw new Error('callback failed') })
    expect(result).toEqual({ success: 1, fail: 1, skipped: 1, cancelled: 0 })
    expect(queue.stats).toMatchObject({ pending: 0, active: 0, success: 1, fail: 1, skipped: 1 })
  })
  it('取消后旧批次停止，随后新批次仍能执行', async () => {
    const queue = new AnnotationQueue()
    let finish: () => void
    const old = queue.enqueue([1, 2, 3], 1, async (_row, signal) => {
      await new Promise<void>((resolve) => { finish = resolve })
      return signal.aborted ? 'cancelled' : 'success'
    }, 0)
    await Promise.resolve()
    queue.cancel()
    finish!()
    expect(await old).toMatchObject({ cancelled: 3 })
    expect(await queue.enqueue([4], 1, async () => 'success')).toMatchObject({ success: 1 })
  })
  it('手动单张标注不排在未完成的批量任务之后', async () => {
    const queue = new AnnotationQueue()
    let finish: () => void
    const batch = queue.enqueue([1], 1, () => new Promise<'success'>((resolve) => { finish = () => resolve('success') }))
    await Promise.resolve()
    expect(await queue.enqueue([2], 1, async () => 'success', undefined, undefined, true)).toMatchObject({ success: 1 })
    finish!()
    expect(await batch).toMatchObject({ success: 1 })
  })
})
