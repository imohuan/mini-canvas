/**
 * Agent 面板外壳的显隐契约（用户口径 2026-11-02：「Agent 点开没反应」）。
 *
 * 根因：外壳用 `v-show="ui.agent.open"`，而 agent 服务的句柄是**运行期注入**的。
 * 如果取句柄这一步不建立响应式依赖，首帧读到的 undefined 会被缓存成「永远关着」：
 * 服务随后上架，按钮高亮变了、面板 DOM 却一直带 display:none。
 *
 * 这里盯住「取句柄必须经过 computed」这条接线；真实显隐由浏览器实测覆盖。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const UI_SRC = readFileSync(path.resolve(HERE, '../composables/ui/useAgentShell.ts'), 'utf8')
const PANEL = readFileSync(path.resolve(HERE, '../components/areas/AgentPanel.vue'), 'utf8')

describe('Agent 面板显隐', () => {
  it('面板打开状态绑定在 ui.agent.open 上', () => {
    expect(PANEL).toContain('v-show="ui.agent.open"')
  })

  it('取 agent 服务时经过 computed（服务晚到也能触发重算）', () => {
    expect(UI_SRC).toMatch(/const agentSvcRef = computed\(\(\) => readyHost\.ctx\?\.get<[^>]*>\('agent'\)\)/)
    expect(UI_SRC).toMatch(/const agentSvc = \(\): [^=]+=> agentSvcRef\.value/)
    // 旧写法（不建立依赖）：getter 里直接现取，服务晚到就永远读不到
    expect(UI_SRC).not.toMatch(/const agentSvc = \(\): [^=]+=>\s*readyHost\?\.ctx\?\.get<[^>]*>\('agent'\)/)
  })
})
