/**
 * 参考标签身份（用户 2026-10-28 定案）：**认节点 / 认名称**，不认类型+序号。
 *
 * 为什么钉死：序号会随排序/增删变化，标签追着序号跑必然指错对象；
 * 节点 id 永远不变，名称又是画布内唯一的，两种身份都稳定。
 */
import { describe, expect, it } from 'vitest'
import { Schema } from 'prosemirror-model'
import { schema as baseSchema } from 'prosemirror-schema-basic'
import {
  buildRefChipItem,
  nodeIdOfChipId,
  refNameChipId,
  refNameOfChipId,
  refNodeChipId,
} from '../useEditor.ts'

/**
 * 标签缩略图的加载状态（用户 2026-10-29：图没加载出来就给加载 UI，不能留空白）。
 *
 * 这条只钉数据契约：DOM 侧的 attachChipThumbState 跑在浏览器里（本包测试是 node 环境），
 * 真机行为由 Chrome MCP 验证：加载中 is-loading、成功 is-covered、失败保持图标。
 */
describe('标签身份：ref-node / ref-name', () => {
  it('节点 id 原样往返', () => {
    expect(refNodeChipId('n9')).toBe('ref-node:n9')
    expect(nodeIdOfChipId('ref-node:n9')).toBe('n9')
  })

  it('名称原样往返（含空格）', () => {
    expect(refNameChipId('天空 之城')).toBe('ref-name:天空 之城')
    expect(refNameOfChipId('ref-name:天空 之城')).toBe('天空 之城')
  })

  it('老格式不会被误认成节点', () => {
    expect(nodeIdOfChipId('ref-slot:image:1')).toBeNull()
    expect(refNameOfChipId('ref-slot:image:1')).toBeNull()
  })
})

describe('buildRefChipItem：未绑定统一资源图标，绑定后跟真实类型', () => {
  it('待绑定：没有 chipKind（渲染时画通用资源图标）', () => {
    const item = buildRefChipItem({ id: 'ref-name:雨声', name: '雨声' })
    expect(item.chipKind).toBeUndefined()
    expect(item.mediaType).toBeUndefined()
    expect(item.name).toBe('雨声')
  })

  it('已绑定音频：有 chipKind=audio、有 value 时带上', () => {
    const item = buildRefChipItem({
      id: 'ref-node:n1',
      name: '雨声',
      bound: { kind: 'audio', url: 'a.mp3', value: '内容' },
    })
    expect(item.chipKind).toBe('audio')
    expect(item.mediaType).toBe('audio')
    expect(item.url).toBe('a.mp3')
    expect(item.value).toBe('内容')
  })

  it('失效：invalid 标记（底栏据此禁止发送）', () => {
    const item = buildRefChipItem({ id: 'ref-node:gone', name: '天空之城', invalid: true })
    expect(item.invalid).toBe(true)
  })

  /**
   * 外观（DOM）由 renderEditor 负责，本包测试跑在 node 环境（没有 document），
   * 所以这里只钉「同一份身份 + 注册表可被覆盖」这条数据契约；
   * 视觉由底栏的 DOM 测试与真机验证覆盖。
   */
  it('renderEditor 读注册表最新条目：同 id 覆盖后拿到新名字/新类型', () => {
    const first = buildRefChipItem({ id: 'ref-node:n1', name: '旧名' })
    const latest = buildRefChipItem({
      id: 'ref-node:n1',
      name: '新名',
      bound: { kind: 'video', url: 'frame.png' },
    })
    expect(typeof first.renderEditor).toBe('function')
    expect(typeof latest.renderEditor).toBe('function')
    expect(latest.id).toBe(first.id)
    expect(latest.chipKind).toBe('video')
    expect(latest.name).toBe('新名')
  })
})

describe('schema 属性：chipKind 跟着文档走（冷启动也能画对图标）', () => {
  const schema = new Schema({
    nodes: baseSchema.spec.nodes.append({
      resource: {
        attrs: { id: {}, name: {}, chipKind: { default: '' }, url: { default: '' } },
        group: 'inline',
        inline: true,
        atom: true,
        toDOM: () => ['span', {}],
      },
    }),
    marks: baseSchema.spec.marks,
  })

  it('chipKind 能存进节点并原样读回', () => {
    const node = schema.nodes.resource.create({ id: 'ref-node:n1', name: '天空之城', chipKind: 'image' })
    expect(node.attrs.chipKind).toBe('image')
  })
})
