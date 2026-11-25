/**
 * 编辑菜单开着时，这颗标签不再弹 hover 预览（用户 2026-11-25）。
 *
 * 现象：点标签图标打开底栏的节点菜单后，鼠标仍停在标签上，编辑器 500ms 后又把预览
 * 弹出来 —— 两个浮层压在同一块区域，菜单选不中行。
 *
 * 锁两件事：压制后当前预览立刻收起；解除后恢复（不能永久禁掉）。
 */
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// vitest 的 cwd 就是包根（package.json 所在目录）
const SRC = readFileSync(path.join(process.cwd(), 'src/useEditor.ts'), 'utf8')

describe('菜单打开时压制标签预览', () => {
  it('suppressResourcePreview 会清计时器、收掉当前预览、记下被压制的标签', () => {
    const at = SRC.indexOf('function suppressResourcePreview')
    expect(at).toBeGreaterThan(0)
    const body = SRC.slice(at, SRC.indexOf('\n  }\n', at) + 5)
    expect(body).toContain('clearTimeout(hoverTimer)')
    expect(body).toContain('hideResourcePreview()')
    expect(body).toContain('suppressedPreviewChipId')
  })

  it('鼠标进入被压制的标签 → 直接返回，不排预览计时器', () => {
    const at = SRC.indexOf('function handleResourceMouseEnter')
    expect(at).toBeGreaterThan(0)
    const body = SRC.slice(at, SRC.indexOf('\n  function handleResourceMouseLeave', at))
    const guard = body.indexOf('suppressedPreviewChipId')
    expect(guard).toBeGreaterThan(0)
    // 必须排在排计时器之前 —— 排了再 return 等于没挡（500ms 后照样弹）
    expect(guard).toBeLessThan(body.indexOf('hoverTimer = setTimeout'))
  })

  it('组件对外暴露这个方法（底栏才能调用）', () => {
    const vue = readFileSync(path.join(process.cwd(), 'src/index.vue'), 'utf8')
    expect(vue).toContain('suppressResourcePreview')
  })

  /**
   * 老文档的标签 DOM 上 `data-url` 可能是空串（落进文档时资源还没 resolve）。
   * 若预览只看 DOM 属性，那颗标签会永远没有预览 —— 必须回退注册表里的当前地址。
   */
  it('★ hover 预览的地址回退到注册表 item.url', () => {
    const at = SRC.indexOf('hoverTimer = setTimeout')
    expect(at).toBeGreaterThan(0)
    const body = SRC.slice(at, SRC.indexOf('// 素材自带 `hoverPreview`', at))
    expect(body).toMatch(/el\.getAttribute\("data-url"\)[^\n]*\|\|[^\n]*item\?\.url/)
  })
})
