/**
 * 薄层覆盖度：App.vue 里放任何 shadcn 组件，都要吃到顶部「组件配置」。
 *
 * 用户口径（2026-11-04）：为什么 App.vue 里这些组件跟着配置变，换成别的组件就不变？
 * 原因是薄层只包了部分家族 —— 没包的组件既不注入尺寸，调用点写死 size 还会盖掉全局档。
 * 这里守两条：
 * 1. 注册表里的每个 shadcn 家族都要出现在 previewKit 里；
 * 2. 预览卡片不写死 sm/default/lg（Card 这类展示容器可以用默认档）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SHADCN_FAMILY_NAMES } from '../shadcnFamilies'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const kit = readFileSync(path.join(SRC, 'previewKit.ts'), 'utf-8')

describe('previewKit 覆盖全部 shadcn 家族', () => {
  it('每个家族都有 configure(module, 家族名)', () => {
    const missing = SHADCN_FAMILY_NAMES.filter(
      (family) => !new RegExp(`configure\\(\\w+Module, '${family}'\\)`).test(kit),
    )
    expect(missing, '这些家族没进薄层：' + missing.join(', ')).toEqual([])
  })

  it('预览卡片不写死控件尺寸档位', () => {
    const dir = path.join(SRC, 'theme/cards')
    const offenders: string[] = []
    for (const file of readdirSync(dir).filter((n) => n.endsWith('.vue'))) {
      const text = readFileSync(path.join(dir, file), 'utf-8')
      // Card 是展示容器，写死 sm 会盖掉「控件尺寸」；Button 等同理。
      if (/size="(sm|default|lg)"/.test(text)) offenders.push(file)
    }
    expect(offenders, '这些卡片写死了尺寸：' + offenders.join(', ')).toEqual([])
  })
})
