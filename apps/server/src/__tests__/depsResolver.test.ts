/**
 * depsResolver —— 安装期依赖解析（发布体系 Task 3）。
 *
 * 装 X 前：查 X 的 plume.dependencies → 对照本机已装的 provides →
 * 缺的按 provides 在 npm 找提供者 → 递归解析（防环）→ 产出安装顺序计划。
 */
import { describe, it, expect } from 'vitest'
import { resolveDeps } from '../updater/depsResolver.js'

/** 假 npmClient：包名 → { provides, dependencies, optionalDependencies } */
const fakeClient = (meta: Record<string, { provides?: string[]; dependencies?: string[]; optionalDependencies?: string[] }>) => ({
  packument: async (name: string) => ({
    name,
    'dist-tags': { latest: '1.0.0' },
    versions: { "1.0.0": { version: "1.0.0", tarball: "x", plume: meta[name] ?? {} } },
    time: {},
  }),
  /** 按 provides 名搜：假实现只认 meta 里有的 */
  search: async (q: string) =>
    Object.entries(meta)
      .filter(([, m]) => (m.provides ?? []).some((p) => q.includes(p)))
      .map(([name]) => ({ name, description: "", version: "1.0.0", date: "", links: {} })),
})

describe('resolveDeps', () => {
  it('缺依赖 → 计划先装提供者再装目标', async () => {
    const client = fakeClient({
      'plugin-x': { provides: ['svc-x'] },
      'plugin-target': { dependencies: ['svc-x'] },
    })
    const plan = await resolveDeps("plugin-target", new Map(), client)
    expect(plan.installOrder.map((p) => p.pkg)).toEqual(['plugin-x', 'plugin-target'])
    expect(plan.missing).toEqual([])
  })

  it('依赖本机已满足 → 只装目标', async () => {
    const client = fakeClient({
      'plugin-target': { dependencies: ['svc-x'] },
    })
    const local = new Map([["svc-x", "plugin-local"]])
    const plan = await resolveDeps("plugin-target", local, client)
    expect(plan.installOrder.map((p) => p.pkg)).toEqual(['plugin-target'])
  })

  it('依赖在 npm 上找不到提供者 → missing 报告', async () => {
    const client = fakeClient({
      'plugin-target': { dependencies: ['svc-ghost'] },
    })
    const plan = await resolveDeps("plugin-target", new Map(), client)
    expect(plan.missing).toEqual(['svc-ghost'])
    expect(plan.installOrder.map((p) => p.pkg)).toEqual(['plugin-target'])
  })

  it('A 依赖 B、B 依赖 A → cycle=true 不死循环', async () => {
    const client = fakeClient({
      'plugin-a': { provides: ['svc-a'], dependencies: ['svc-b'] },
      'plugin-b': { provides: ['svc-b'], dependencies: ['svc-a'] },
    })
    const plan = await resolveDeps("plugin-a", new Map(), client)
    expect(plan.cycle).toBe(true)
  })

  it('optionalDependencies 缺 → 只进 optionalMissing', async () => {
    const client = fakeClient({
      'plugin-target': { optionalDependencies: ['svc-opt'] },
    })
    const plan = await resolveDeps("plugin-target", new Map(), client)
    expect(plan.optionalMissing).toEqual(['svc-opt'])
    expect(plan.missing).toEqual([])
  })

  it('递归：目标依赖 X，X 又依赖 Y → 安装顺序 Y、X、target', async () => {
    const client = fakeClient({
      'plugin-target': { dependencies: ['svc-x'] },
      'plugin-x': { provides: ['svc-x'], dependencies: ['svc-y'] },
      'plugin-y': { provides: ['svc-y'] },
    })
    const plan = await resolveDeps("plugin-target", new Map(), client)
    expect(plan.installOrder.map((p) => p.pkg)).toEqual(['plugin-y', 'plugin-x', 'plugin-target'])
  })
})
