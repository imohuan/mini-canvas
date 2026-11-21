/**
 * 两个下拉的选中标记 + 创作模式的说明（用户 2026-11-21 截图）。
 *
 * 1. 审核模式：选中哪一条，只有那一条有对勾。以前对勾是不判断 aria-checked 的常量节点，
 *    两条都常亮 —— 用户看图 2 时以为两个都选中了。
 * 2. 创作模式：选中项要有对勾（以前一个都没有，用户看图 3 分不清当前是哪套）。
 * 3. 创作模式每行要有描述：只有名字看不出这套是干什么的。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readSfcWithStyles } from './readSfcWithStyles'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = readSfcWithStyles(path.resolve(HERE, '../ui/conversation/AgentComposer.vue'))
const CSS = ['part1.css', 'part2.css', 'part3.css', 'part4.css']
  .map((f) => readFileSync(path.resolve(HERE, '../ui/conversation/agent-composer', f), 'utf8'))
  .join('\n')

describe('审核模式：对勾只画在选中项上', () => {
  it('对勾带 v-if，绑定当前授权方式', () => {
    const review = SRC.slice(SRC.indexOf('ac-review-list'), SRC.indexOf('ac-review-body') + 4000)
    expect(review).toMatch(/v-if="authMode === m\.value"[^>]*class="ac-check-mark ac-review-check"/)
  })

  it('没有无条件的对勾节点（那会让两条都常亮）', () => {
    const review = SRC.slice(SRC.indexOf('ac-review-list'), SRC.indexOf('</DropdownMenuContent>', SRC.indexOf('ac-review-list')))
    expect(review).not.toMatch(/<span class="ac-check-mark ac-review-check"/)
  })
})

describe('创作模式：选中项有对勾，每行有描述', () => {
  const modeMenu = SRC.slice(SRC.indexOf('aria-label="选择创作模式"'), SRC.indexOf('授权方式：接受审核'))

  it('选中项画对勾', () => {
    expect(modeMenu).toMatch(/v-if="s\.activePromptId === m\.id"[^>]*class="ac-check-mark[^"]*"/)
  })

  it('菜单行是上下两行：名字 + 描述', () => {
    expect(modeMenu).toContain('ac-mode-item')
    expect(modeMenu).toMatch(/m\.description|ac-mode-desc/)
  })

  it('描述缺失时用一句兜底说明，不留空行', () => {
    expect(modeMenu).toMatch(/m\.description \|\||modeDescOf\(m\)/)
  })

  it('.ac-mode-desc 允许换行，不会被挤成一行省略', () => {
    const at = CSS.indexOf('.ac-mode-desc {')
    expect(at).toBeGreaterThan(-1)
    const body = CSS.slice(at, CSS.indexOf('}', at))
    expect(body).toMatch(/white-space:\s*normal/)
  })
})
