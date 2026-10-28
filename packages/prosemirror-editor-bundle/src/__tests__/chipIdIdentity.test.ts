/**
 * 标签身份统一（用户 2026-10-28）：
 *
 * 以前同一个标签存在两种 id —— @ 下拉插入用上游节点 id（`204`），
 * 「标记」转换用 `ref-slot:image:1`。刷新后注册表一空，节点 id 那种就退化成下划线文字，
 * 输入框里同时出现两种标签。现在两种路径落进文档的 id 必须完全一致。
 */
import { describe, expect, it } from 'vitest'
import { Schema } from 'prosemirror-model'
import { schema as baseSchema } from 'prosemirror-schema-basic'
import { slotIdFromName, migrateLegacyChipIds } from '../useEditor.ts'

describe('slotIdFromName：名字 → 唯一标签身份', () => {
  it('四种资源各自映射到 ref-slot:<kind>:<N>', () => {
    expect(slotIdFromName('图片1')).toBe('ref-slot:image:1')
    expect(slotIdFromName('视频2')).toBe('ref-slot:video:2')
    expect(slotIdFromName('音频3')).toBe('ref-slot:audio:3')
    expect(slotIdFromName('文本4')).toBe('ref-slot:text:4')
  })

  it('名字里有空格也认（图片 12 → ref-slot:image:12）', () => {
    expect(slotIdFromName('图片 12')).toBe('ref-slot:image:12')
  })

  it('认不出的名字返回 null（技能/MCP/自由文本保持原 id）', () => {
    expect(slotIdFromName('canvas')).toBeNull()
    expect(slotIdFromName('我的角色')).toBeNull()
    expect(slotIdFromName('')).toBeNull()
  })
})

describe('migrateLegacyChipIds：老存档迁移', () => {
  const schema = new Schema({
    nodes: baseSchema.spec.nodes.append({
      resource: {
        attrs: { id: {}, name: {}, url: { default: '' }, value: { default: '' } },
        group: 'inline',
        inline: true,
        atom: true,
        toDOM: () => ['span', {}],
      },
    }),
    marks: baseSchema.spec.marks,
  })

  const makeDoc = (ids: string[]) =>
    schema.node('doc', null, [
      schema.node('paragraph', null, ids.map((id) =>
        schema.nodes.resource.create({ id, name: id.startsWith('ref-slot:') ? '图片' + id.split(':')[2] : '图片1' }),
      )),
    ])

  it('节点 id 形式 → 改写成 ref-slot:*（按名字）', () => {
    const doc = makeDoc(['204'])
    const out = migrateLegacyChipIds(doc)
    const ids: string[] = []
    out.descendants((n) => { if (n.type.name === 'resource') ids.push(String(n.attrs.id)) })
    expect(ids).toEqual(['ref-slot:image:1'])
  })

  it('已经是 ref-slot:* 的不动（返回同一引用，调用方可跳过事务）', () => {
    const doc = makeDoc(['ref-slot:image:1'])
    expect(migrateLegacyChipIds(doc)).toBe(doc)
  })

  it('认不出名字的引用不动（技能/MCP/资产）', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [schema.nodes.resource.create({ id: 'skill-1', name: 'canvas' })]),
    ])
    expect(migrateLegacyChipIds(doc)).toBe(doc)
  })
})
