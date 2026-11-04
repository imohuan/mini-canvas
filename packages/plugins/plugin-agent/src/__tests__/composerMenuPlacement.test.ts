/**
 * 输入区下拉的统一位置契约（用户口径 2026-11-02）：
 * 「agent 下面这些下拉菜单，显示方向都为顶部居中，偏移保持一致」。
 *
 * 之前六个菜单各写各的：align 有 start 也有 end，side-offset 有 8 / 10 / 18。
 * 同一排按钮点开，菜单一个贴左、一个贴右、一个离得远。
 *
 * 另一个实测问题：每个菜单各自 v-model:open，开着 A 再点 B，两个会同时挂在 body 上。
 * 所以这里同时钉住「同一时刻只开一个」的收口。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readSfcWithStyles } from './readSfcWithStyles'
import { readAgentConversationSource } from './readAgentConversationSource'

const HERE = path.dirname(fileURLToPath(import.meta.url))


/** 只取输入区工具行那一段，避免把队列行「⋯」菜单（它不是输入区菜单）算进来 */
const source = readSfcWithStyles(path.resolve(HERE, '../ui/conversation/AgentComposer.vue'))
const controller = readAgentConversationSource()
const toolbar = (() => {
  const start = source.indexOf('<div class="ac-toolbar">')
  expect(start, '找不到输入区工具行').toBeGreaterThan(-1)
  // 工具行一直到模板结束（</template>）；只按 </div> 截会停在第一个内层 div，只剩一个菜单。
  const end = source.indexOf('</template>', start)
  expect(end, '找不到工具行结尾').toBeGreaterThan(start)
  return source.slice(start, end)
})()

describe('输入区下拉：向上 / 居中 / 统一偏移', () => {
  it('六个菜单都用同一组常量，不再各写 side / align / side-offset', () => {
    const contents = toolbar.match(/<DropdownMenuContent[\s\S]*?>/g) ?? []
    expect(contents.length, '输入区菜单数量变了，更新这条契约').toBeGreaterThanOrEqual(6)
    for (const tag of contents) {
      expect(tag, '菜单没有引用统一的对齐常量').toContain('COMPOSER_MENU_ALIGN')
      expect(tag, '菜单没有引用统一的弹出方向常量').toContain('COMPOSER_MENU_SIDE')
      expect(tag, '菜单没有引用统一的偏移常量').toContain('COMPOSER_MENU_OFFSET')
      expect(tag, '仍写死了 align').not.toMatch(/\balign="(start|end)"/)
      expect(tag, '仍写死了 side-offset').not.toMatch(/:side-offset="\d+"/)
    }
  })

  it('常量取值就是向上 + 居中', () => {
    expect(controller).toMatch(/COMPOSER_MENU_SIDE = 'top'/)
    expect(controller).toMatch(/COMPOSER_MENU_ALIGN = 'center'/)
    expect(controller).toMatch(/COMPOSER_MENU_OFFSET = \d+/)
  })
})

describe('输入区菜单同一时刻只开一个', () => {
  it('开一个菜单会把其余关掉', () => {
    const fn = controller.slice(controller.indexOf('function setComposerMenuOpen'), controller.indexOf('function switchComposerMenu'))
    expect(fn, '找不到统一开合函数').not.toBe('')
    expect(fn, '打开时没有先关掉其它菜单').toMatch(/if \(open\)[\s\S]{0,200}flag\.value = false/)
  })

  it('六个菜单都走统一开合，不再各自 v-model:open', () => {
    // 不能用 [^>]* —— 标签里有 `=>`，会在箭头函数那里被截断。取到下一个 <DropdownMenuTrigger 为止。
    const contents = toolbar.match(/<DropdownMenu [\s\S]*?(?=<DropdownMenuTrigger)/g) ?? []
    expect(contents.length).toBeGreaterThanOrEqual(6)
    for (const tag of contents) {
      expect(tag, '还有菜单用 v-model:open 各存一份状态').not.toContain('v-model:open')
      expect(tag, '菜单没有接统一开合').toContain('setComposerMenuOpen')
    }
  })

  it('触发器不再在 pointerdown 自己开合（一次点击只能翻转一次）', () => {
    // 根因（用户口径 2026-11-03）：pointerdown 先开、Reka 的原生 click 又 toggle 一次，
    // 菜单就会闪一下消失。开合的唯一入口必须留给 DropdownMenuTrigger。
    expect(toolbar).not.toMatch(/@pointerdown="switchComposerMenu\('[a-z]+'\)"/)
    expect(toolbar).not.toContain("@pointerdown=\"switchComposerMenu")
  })
})
