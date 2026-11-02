/**
 * 下拉菜单的「一次点击切换」契约。
 *
 * 用户实测（2026-11-03）：素材库菜单开着时点「移动」，第一次点击只关掉旧菜单，
 * 新菜单不弹，要点两下。根因是 reka-ui 的 DropdownMenu 默认 `modal: true` ——
 * 菜单打开期间会禁用菜单外所有元素的指针事件。
 * 这里守住默认值：菜单必须默认非模态，需要模态时由调用点显式打开。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const src = readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../components/ui/dropdown-menu/DropdownMenu.vue',
  ),
  'utf-8',
)
/** 去掉块注释再断言：注释里会引用 reka-ui 的默认值，不能把说明文字当成代码 */
const code = src.replace(/\/\*[\s\S]*?\*\//g, '')

describe('DropdownMenu 默认非模态', () => {
  it('组件默认值 modal: false（否则外部点击会被吞掉一次）', () => {
    expect(code).toMatch(/withDefaults\(defineProps<DropdownMenuRootProps>\(\),\s*\{\s*modal:\s*false\s*\}\)/)
  })

  it('没有把 modal 写死成 true', () => {
    expect(code).not.toMatch(/modal:\s*true/)
  })
})
