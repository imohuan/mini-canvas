/**
 * notify 服务契约：默认主题提供，底层转发到 vue-sonner；业务插件不自己挂 Toaster。
 *
 * 为什么测这层：通知最容易悄悄失效（弹了但看不见，或插件各装一份 Toaster 叠出两条）。
 * 这里钉住「每个方法都真的走到 vue-sonner」。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: Array<[string, ...unknown[]]> = []

vi.mock('vue-sonner', () => {
  const record = (kind: string) => (message: unknown, options?: unknown) => {
    calls.push([kind, message, options])
    return kind + '-id'
  }
  const toast = Object.assign(record('default'), {
    info: record('info'),
    success: record('success'),
    warning: record('warning'),
    error: record('error'),
    loading: record('loading'),
    message: record('message'),
    promise: (...args: unknown[]) => {
      calls.push(['promise', ...args])
      return 'promise-id'
    },
    dismiss: (id?: unknown) => calls.push(['dismiss', id]),
  })
  return { toast }
})

import { createNotifyService } from '../notifyService'

describe('notify 服务', () => {
  beforeEach(() => calls.splice(0, calls.length))

  it('成功 / 失败 / 警告 / 加载 / 普通消息各走对应的 sonner 方法', () => {
    const notify = createNotifyService()
    notify.success('保存成功')
    notify.error('保存失败')
    notify.warning('注意')
    notify.loading('正在生成')
    notify.info('提示')
    notify('普通消息')
    expect(calls.map((c) => c[0])).toEqual(['success', 'error', 'warning', 'loading', 'info', 'default'])
  })

  it('description / duration / id 原样传下去（原地更新 loading 要用到 id）', () => {
    const notify = createNotifyService()
    notify.success('完成', { id: 'gen-1', description: '共 3 张图', duration: 5000 })
    expect(calls[0]).toEqual(['success', '完成', { id: 'gen-1', description: '共 3 张图', duration: 5000 }])
  })

  it('dismiss 能关单条；promise 能自动切换 loading → success/error', () => {
    const notify = createNotifyService()
    notify.dismiss('gen-1')
    expect(calls[0]).toEqual(['dismiss', 'gen-1'])
    const promise = Promise.resolve(1)
    notify.promise(promise, { loading: '生成中', success: '成功', error: '失败' })
    expect(calls[1]?.[0]).toBe('promise')
    expect(calls[1]?.[1]).toBe(promise)
  })
})
