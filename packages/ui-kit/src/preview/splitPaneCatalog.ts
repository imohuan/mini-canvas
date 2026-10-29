/**
 * SplitPane 展示页的配置、预设与示例代码。
 * 与页面分开，保证“调参数”和“复制代码”永远用同一份默认值。
 */

export type SplitPaneDirection = 'horizontal' | 'vertical'

export interface SplitPanePlaygroundState {
  direction: SplitPaneDirection
  initial: number
  minLeft: number
  minRight: number
  snap: number
}

export interface SplitPanePreset {
  id: string
  name: string
  description: string
  patch: Partial<SplitPanePlaygroundState>
}

export const DEFAULT_SPLIT_PANE_STATE: SplitPanePlaygroundState = {
  direction: 'horizontal',
  initial: 0.5,
  minLeft: 120,
  minRight: 120,
  snap: 48,
}

export const SPLIT_PANE_PRESETS: SplitPanePreset[] = [
  {
    id: 'even',
    name: '平均分栏',
    description: '两边一样宽',
    patch: { direction: 'horizontal', initial: 0.5, minLeft: 120, minRight: 120, snap: 48 },
  },
  {
    id: 'list',
    name: '左列表右内容',
    description: '左窄右宽',
    patch: { direction: 'horizontal', initial: 0.28, minLeft: 160, minRight: 280, snap: 48 },
  },
  {
    id: 'vertical',
    name: '上预览下文档',
    description: '上下分栏',
    patch: { direction: 'vertical', initial: 0.55, minLeft: 100, minRight: 90, snap: 40 },
  },
]

/** 右侧配置摘要，只写用户能直接理解的词。 */
export function splitPaneSummary(state: SplitPanePlaygroundState): string {
  const direction = state.direction === 'horizontal' ? '左右' : '上下'
  return `${direction} · ${Math.round(state.initial * 100)}% · 最小 ${state.minLeft}/${state.minRight}px`
}

/** 生成当前配置对应的 SFC 片段。 */
export function buildSplitPaneSnippet(state: SplitPanePlaygroundState): string {
  const lines = [
    '<script setup lang="ts">',
    "import { SplitPane } from '@mini-canvas/ui-kit'",
    '</script>',
    '',
    '<template>',
    '  <SplitPane',
  ]
  if (state.direction === 'vertical') lines.push('    direction="vertical"')
  lines.push(`    :initial="${state.initial}"`)
  lines.push(`    :min-left="${state.minLeft}"`)
  lines.push(`    :min-right="${state.minRight}"`)
  lines.push(`    :snap="${state.snap}"`)
  lines.push('  >')
  lines.push('    <template #left>左边内容</template>')
  lines.push('    <template #right>右边内容</template>')
  lines.push('  </SplitPane>')
  lines.push('</template>')
  return lines.join('\n')
}
