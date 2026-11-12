/**
 * 底栏契约住在 canvas-data：节点插件只依赖上游引擎，就能拿到动作类型与 nodeBar 服务形状。
 *
 * 这条测试钉两件事：
 * 1. 服务名 `nodeBar` 已登记进内核 Services（按名推导，不需要手写泛型）；
 * 2. 纯转换函数保留「工具名 → tool:<name>」这个稳定 id，底栏和后台都按它对齐。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@plume-canvas/kernel'
import type { ToolDef } from '@plume-canvas/kernel'
import { barToolToAction, type BarAction, type NodeBarContract } from '../barContract'
import type { Services } from '@plume-canvas/kernel'

describe('底栏契约（canvas-data）', () => {
  it('nodeBar 服务名在 Services 里有类型', () => {
    const ctx = new Context()
    const bar: NodeBarContract = {
      list: () => [],
      get: () => undefined,
      applierOf: () => undefined,
      state: () => undefined,
      register: () => {},
      registerApplier: () => {},
      publishTools: () => () => {},
    }
    ctx.inject('nodeBar', bar)
    // 只用服务名、不写泛型：类型来自 canvas-data 的声明合并
    const got: Services['nodeBar'] = ctx.get('nodeBar')
    expect(got).toBe(bar)
    ctx.stop()
  })

  it('工具转动作：id 固定为 tool:<name>，参数与模板逐项复制', () => {
    const tool: ToolDef = {
      name: 'gen-image',
      title: '生成图片',
      description: '出一张图',
      group: '图片',
      produces: 'image',
      params: [{ key: 'ratio', type: 'select', label: '比例', default: '1:1' }],
      templates: [{ id: 't1', name: '海报', prompt: '海报' }],
      run: () => ({ ok: true }),
    } as ToolDef
    const action: BarAction = barToolToAction(tool, { types: ['image'], produces: 'image' }, async () => ({ ok: true }))
    expect(action.id).toBe('tool:gen-image')
    expect(action.types).toEqual(['image'])
    expect(action.fields?.[0]?.key).toBe('ratio')
    expect(action.templates?.[0]?.id).toBe('t1')
  })
})
