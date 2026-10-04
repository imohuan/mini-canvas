/**
 * 右键菜单浮层必须**不透光**（用户口径 2026-10-04：「你的插件有个透明度，请把它删掉」）。
 *
 * 现象：菜单卡片用了毛玻璃材质（--ui-glass ≈ 0.86 不透明 + backdrop-filter: blur），
 * 背后的画布 / 节点直接透出来，字压在图片上读不清。
 *
 * 钉两条（对两处菜单容器都查）：
 *   1. 背景走不透光档 token ——ui-overlay-solid（与节点控制栏同一档），不再用 --ui-glass；
 *   2. 不写 backdrop-filter（纯色底上写模糊无效，规范 §2.6 明确禁止）。
 *
 * 为什么读源码：容器的视觉效果只有浏览器里能量，但「用哪个 token / 有没有 blur」
 * 是源码结构，可直接断言；与 ui 包 stylesCompile / uiDropdownRegistration 同款手法。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const FILES = [
  new URL('../ContextMenu.vue', import.meta.url),
  new URL('../ConnectionMenuContent.vue', import.meta.url),
]

/** 切出某条规则（选第一个匹配的规则块） */
function rule(css: string, selector: string): string | null {
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}')
  const m = re.exec(css)
  return m ? m[1] : null
}

describe.each(FILES.map((f) => [f.pathname.split('/').pop(), f] as const))(
  '菜单浮层不透光：%s',
  (_name, url) => {
    const css = readFileSync(url, 'utf-8')
    const container = rule(css, '.ctx-menu') ?? rule(css, '.conn-menu')

    it('容器背景用 --ui-overlay-solid（不透光档），不用 --ui-glass', () => {
      expect(container, '没找到菜单容器规则').toBeTruthy()
      expect(container!).toMatch(/background:\s*var\(--ui-overlay-solid/)
      expect(container!).not.toMatch(/var\(--ui-glass/)
    })

    it('容器不写 backdrop-filter（纯色底上的模糊无效，规范禁止）', () => {
      expect(container!).not.toMatch(/backdrop-filter/)
    })
  },
)
