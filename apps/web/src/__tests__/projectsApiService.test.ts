/**
 * 项目数据服务：项目页插件不 import 入口，只按名取 'projectsApi'。
 *
 * 验收对应 18 号文档待确认项：项目页面板要能真正操作项目数据。
 * 这里不测后端，只钉三件事：服务名对、方法齐、请求仍走统一出口（带管理令牌）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@plume-canvas/canvas-data'
import { projectsApiPlugin, type ProjectsApiService } from '../projectsApiPlugin'

const calls: Array<{ url: string; init?: RequestInit }> = []

function stubFetch(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }),
  )
}

const g = globalThis as { localStorage?: unknown }

beforeEach(() => {
  calls.length = 0
  g.localStorage = {
    m: new Map<string, string>([['plume_admin_token', 'tok-abc']]),
    getItem(k: string) {
      return (this as unknown as { m: Map<string, string> }).m.get(k) ?? null
    },
    setItem(k: string, v: string) {
      ;(this as unknown as { m: Map<string, string> }).m.set(k, v)
    },
    removeItem(k: string) {
      ;(this as unknown as { m: Map<string, string> }).m.delete(k)
    },
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete g.localStorage
})

describe('projectsApi 服务', () => {
  it('应用级插件把服务按名上架，项目页可用', async () => {
    const ctx = new Context()
    ctx.plugin(projectsApiPlugin)
    await ctx.start()
    const api = ctx.tryGet<ProjectsApiService>('projectsApi')
    expect(api, '没有 projectsApi 服务').toBeTruthy()
    // 画布方法与项目方法都在；缺一个面板就会“按钮点了没反应”。
    for (const key of ['listProjects', 'createProject', 'listCanvases', 'createCanvas', 'deleteProject']) {
      expect(typeof (api as unknown as Record<string, unknown>)[key], key).toBe('function')
    }
    ctx.stop()
  })

  it('列表请求仍走相对路径，写请求带管理令牌', async () => {
    const ctx = new Context()
    ctx.plugin(projectsApiPlugin)
    await ctx.start()
    const api = ctx.get<ProjectsApiService>('projectsApi')

    stubFetch({ projects: [] })
    expect(await api.listProjects()).toEqual([])
    expect(calls[0]?.url).toBe('/api/projects')

    calls.length = 0
    stubFetch({ project: { id: 'p1', name: '新项目', createdAt: 1, canvasCount: 0 } })
    await api.createProject('新项目')
    expect(calls[0]?.url).toBe('/api/projects')
    const headers = new Headers(calls[0]?.init?.headers)
    expect(headers.get('authorization') ?? headers.get('x-admin-token')).toBeTruthy()
    ctx.stop()
  })
})
