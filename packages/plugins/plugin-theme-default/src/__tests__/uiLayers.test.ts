/**
 * 界面浮层层级契约（用户口径 2026-11-03）：
 * 「请检查你所有地方弹出框，你可以发现你这里的 z-index 不够」。
 *
 * 实测状态：生成历史弹窗是 z-50，Agent 面板 1000、外壳顶栏 / 底栏 700，
 * 所以弹窗打开后反而被画布控件盖住。根因不是某一个弹窗写错，而是组件库默认的
 * z-50 从来没有接入宿主的画布层叠带。
 *
 * 这条测试盯住两件事：
 * 1. 默认主题确实加载了浮层表，且浮层表按「画布 < 浮面板 < 对话框 < 菜单 < 提示 < 预览」排序；
 * 2. 业务弹窗不再各写魔法数字 / 私有 z-index，改为引用主题提供的命名层。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const REPO = path.resolve(PKG, '../../..')
const read = (rel: string): string => readFileSync(path.join(REPO, rel), 'utf-8')

const css = read('packages/plugins/plugin-theme-default/src/styles/ui-layers.css')
const entry = read('packages/plugins/plugin-theme-default/src/index.ts')

/** 从 CSS 里取自定义变量的原文值 */
function varValue(name: string): string {
  const m = css.match(new RegExp('--' + name + ':\\s*([^;]+);'))
  expect(m, 'ui-layers.css 缺少 --' + name).toBeTruthy()
  return m![1]!.trim()
}

describe('默认主题：界面浮层层级表', () => {
  it('主题入口真的加载了 ui-layers.css（只建文件不接线等于没修）', () => {
    expect(entry).toMatch(/import\s+["']\.\/styles\/ui-layers\.css["']/)
  })

  it('对话框压在核心画布层叠带的模态档上，不是组件库默认的 z-50', () => {
    expect(varValue('ui-layer-dialog')).toMatch(/var\(--layer-modal/)
  })

  it('应用级浮面板高于画布外壳（700）与节点控制栏，低于对话框', () => {
    const panel = Number(varValue('ui-layer-app-panel'))
    expect(panel).toBeGreaterThan(700)
    expect(panel).toBeLessThan(100000)
  })

  it('菜单、提示、全屏预览依次在对话框之上', () => {
    expect(varValue('ui-layer-menu')).toMatch(/calc\(var\(--layer-modal-top/)
    expect(varValue('ui-layer-tooltip')).toMatch(/calc\(var\(--layer-modal-top/)
    expect(varValue('ui-layer-viewer')).toMatch(/calc\(var\(--layer-modal-top/)
  })

  it('shadcn 的 Dialog / AlertDialog / Sheet 遮罩与内容都被统一接管', () => {
    for (const slot of ['dialog-overlay', 'dialog-content', 'alert-dialog-overlay', 'alert-dialog-content', 'sheet-overlay', 'sheet-content']) {
      expect(css, '缺少 [data-slot=\'' + slot + '\'] 的层级规则')
        .toContain("[data-slot='" + slot + "']")
    }
  })
})

describe('业务浮层使用主题命名层，不再自己写层级数字', () => {
  /** 只检查**整块浮层**的根节点；面板内部的拖拽手柄等小部件允许有自己的小数字。 */
  const sources: Array<[string, RegExp]> = [
    [
      'packages/ui/src/components/areas/AgentPanel.vue',
      /<section[\s\S]*?class="agent-shell mc-layer-app-panel"/,
    ],
    [
      'packages/ui/src/components/areas/LeftDrawer.vue',
      /class="left-drawer mc-layer-app-panel/,
    ],
    [
      'packages/ui/src/components/areas/modals-area/ShortcutModal.vue',
      /class="mc-layer-app-panel fixed inset-0/,
    ],
    [
      'packages/ui/src/components/AssetUploadDialog.vue',
      /class="mc-layer-dialog fixed inset-0/,
    ],
    [
      'packages/ui/src/components/assets/manage-dialog/ManageDialogShell.vue',
      /class="mc-layer-dialog fixed inset-0/,
    ],
  ]

  for (const [file, pattern] of sources) {
    it(path.basename(file) + ' 使用主题的命名层', () => {
      const src = read(file)
      expect(src).toMatch(pattern)
      expect(src, '整块浮层不要再写 z-[数字] 这种魔法层')
        .not.toMatch(/z-\[(?:\d{2,})\]/)
    })
  }

  it('展开的节点底栏按对话框层显示（此前只压过节点控制栏、被左抽屉与 Agent 盖住）', () => {
    const src = read('packages/plugins/plugin-bottom-bar/src/NodeBottomBar.vue')
    expect(src).toMatch(/zIndex:\s*'var\(--ui-layer-dialog/)
  })
})

/** 递归读源码目录，用于「整片浮层不许再写 z-50 / 100000 字面量」的扫描 */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '__tests__') continue
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(vue|ts|css)$/.test(name)) out.push(full)
  }
  return out
}

describe('浮层数字扫描：宿主的整块浮层不再绕过主题', () => {
  it('packages/ui 的浮层不再写 z-[100000] / z-[100001]', () => {
    const offenders = walk(path.join(REPO, 'packages/ui/src'))
      .map((f) => readFileSync(f, 'utf-8'))
      .filter((s) => /z-\[1000(?:0[01])\]/.test(s))
    expect(offenders).toHaveLength(0)
  })
})
