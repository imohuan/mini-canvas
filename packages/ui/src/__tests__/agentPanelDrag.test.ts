/**
 * Agent 面板拖拽契约（用户口径 2026-10-09：「右侧这个 Agent 面板要能拖拽」）。
 *
 * 面板有两种摆法，要求**两种都能拖**：
 *   · 浮窗态：拖头部 = 移动；右下角 = 自由缩放；
 *   · 停靠态：拖左缘 = 改宽；**拖头部 = 拖出来变成浮窗并跟随鼠标**。
 *
 * 为什么用静态结构判定（与本仓 canvasChipMenu / assetTreeStructure 同一口径）：
 * 「停靠态能不能拖」这件事在浏览器里很难一眼看出真假 —— 用户看到的只是"拖不动"，
 * 但原因可能是 startDrag 首行 return、也可能头部没给可拖样式。这类"接线是否接上"的
 * 契约只能盯源码结构；真实手感由 e2e 与真机验证覆盖。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const panel = readFileSync(path.resolve(HERE, '../components/areas/AgentPanel.vue'), 'utf8')

/** 取出 startDrag 函数体（从声明到下一个顶层 function 之前） */
function startDragBody(): string {
  const at = panel.indexOf('function startDrag(')
  expect(at).toBeGreaterThan(-1)
  const rest = panel.slice(at)
  const next = rest.indexOf('\nfunction ', 10)
  return next === -1 ? rest : rest.slice(0, next)
}

describe('Agent 面板拖拽', () => {
  it('停靠态头部也可抓（startDrag 不再一上来就 return）', () => {
    const body = startDragBody()
    // 旧写法：if (ui.agent.docked) return —— 那正是"停靠时拖不动"的根因
    expect(body).not.toMatch(/if\s*\(\s*ui\.agent\.docked\s*\)\s*return/)
    // 仍然要挡按钮：点头部里的图标按钮不该触发拖动
    expect(body).toMatch(/closest\('button'\)/)
  })

  it('头部两种摆法都带可拖样式与抓手光标', () => {
    expect(panel).toContain('class="agent-head draggable"')
    expect(panel).not.toContain(':class="{ draggable: !ui.agent.docked }"')
    expect(panel).toMatch(/\.agent-head\.draggable \{[^}]*cursor:\s*grab/)
  })

  it('停靠态拖动会脱离停靠，并按「抓取点」换算浮窗坐标（不跳位）', () => {
    const body = startDragBody()
    // 脱离停靠
    expect(body).toMatch(/ui\.agent\.docked\s*=\s*false/)
    // 抓取点偏移：clientX - rect.left
    expect(body).toMatch(/e\.clientX\s*-\s*rect\.left/)
    expect(body).toMatch(/startX\s*-\s*grabDX/)
    expect(body).toMatch(/startY\s*-\s*grabDY/)
    // 夹进视口
    expect(body).toContain('clampPos')
  })

  it('有拖动阈值：点一下头部不会把面板拖出停靠', () => {
    expect(panel).toMatch(/DRAG_THRESHOLD\s*=\s*\d+/)
    const body = startDragBody()
    expect(body).toMatch(/DRAG_THRESHOLD/)
    // 阈值判断必须发生在"脱离停靠"之前
    expect(body.indexOf('DRAG_THRESHOLD', body.indexOf('const move'))).toBeLessThan(body.indexOf('ui.agent.docked = false'))
  })

  it('拖出来的高度沿用当前真实高度（不会突然缩成默认值）', () => {
    expect(startDragBody()).toMatch(/s\.chatHeight\s*=\s*Math\.round\(rect\.height\)/)
  })

  it('拖拽期间禁文字选中，松手恢复并摘掉监听', () => {
    const body = startDragBody()
    expect(body).toContain("document.body.style.userSelect = 'none'")
    expect(body).toMatch(/removeEventListener\('pointermove'/)
    expect(body).toMatch(/removeEventListener\('pointerup'/)
    expect(body).toMatch(/document\.body\.style\.userSelect = ''/)
  })

  it('停靠态左缘改宽与浮窗右下角缩放都还在', () => {
    expect(panel).toContain('class="agent-resize"')
    expect(panel).toContain('class="agent-corner"')
    expect(panel).toMatch(/function startResize\(/)
    expect(panel).toMatch(/function startCornerResize\(/)
  })

  /**
   * 停靠/浮窗切换按钮的**图标要说明点下去会发生什么**（用户口径 2026-10-09，附截图）。
   *
   * 曾经两种状态都画 PanelRight（右侧分栏 = 停靠），于是在停靠态，图标指的正是
   * 「我现在已经在的地方」，而那颗按钮实际要做的是「变浮窗」—— 图标与动作相反。
   */
  it('停靠/浮窗切换：图标随状态变，与 aria-label 同向', () => {
    // 停靠态 → 动作是「变浮窗」→ 画悬浮框
    expect(panel).toMatch(/<PictureInPicture2 v-if="ui\.agent\.docked"/)
    // 浮窗态 → 动作是「停靠到右缘」→ 画右侧分栏
    expect(panel).toMatch(/<PanelRight v-else/)
    // 图标库确实导出了这两枚（名字写错要到构建时才炸）
    expect(panel).toMatch(/import \{[^}]*\bPictureInPicture2\b[^}]*\} from 'lucide-vue-next'/)
    expect(panel).toMatch(/import \{[^}]*\bPanelRight\b[^}]*\} from 'lucide-vue-next'/)
    // 纯图标按钮要同时有 aria-label 与 title（ui-style-guide §5.3）
    expect(panel).toMatch(/:aria-label="ui\.agent\.docked \? '切换为浮窗' : '停靠到右侧'"[\s\S]{0,90}?:title="ui\.agent\.docked \? '切换为浮窗' : '停靠到右侧'"/)
  })
})

