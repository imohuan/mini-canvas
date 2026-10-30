import { readNumber, readText, type ComponentPlayground } from '../../preview/playground'

export const splitPanePlayground: ComponentPlayground = {
  id: 'split-pane',
  defaults: {
    direction: 'horizontal',
    initial: 0.5,
    minLeft: 120,
    minRight: 120,
    snap: 48,
    leftLabel: '左边内容',
    rightLabel: '右边内容',
  },
  fields: [
    { kind: 'segment', key: 'direction', label: '方向', options: [
      { value: 'horizontal', label: '左右' },
      { value: 'vertical', label: '上下' },
    ] },
    { kind: 'range', key: 'initial', label: '初始比例', min: 0.15, max: 0.85, step: 0.05, unit: '%' },
    { kind: 'number', key: 'minLeft', label: '左侧最小尺寸', min: 40, max: 320, step: 10, suffix: 'px' },
    { kind: 'number', key: 'minRight', label: '右侧最小尺寸', min: 40, max: 320, step: 10, suffix: 'px' },
    { kind: 'number', key: 'snap', label: '吸边距离', min: 20, max: 100, step: 4, suffix: 'px' },
    { kind: 'text', key: 'leftLabel', label: '左侧文字' },
    { kind: 'text', key: 'rightLabel', label: '右侧文字' },
  ],
  presets: [
    { id: 'even', name: '左右均分', description: '各占一半', patch: { direction: 'horizontal', initial: 0.5, minLeft: 120, minRight: 120, snap: 48, leftLabel: '左边内容', rightLabel: '右边内容' } },
    { id: 'wide-left', name: '左侧更宽', description: '主次分栏', patch: { direction: 'horizontal', initial: 0.7, minLeft: 200, minRight: 120, snap: 48, leftLabel: '主区域', rightLabel: '侧栏' } },
    { id: 'vertical', name: '上下分栏', description: '上方主内容', patch: { direction: 'vertical', initial: 0.6, minLeft: 120, minRight: 120, snap: 48, leftLabel: '上方内容', rightLabel: '下方内容' } },
  ],
  summary: (s) => {
    const dir = readText(s, 'direction') === 'vertical' ? '上下' : '左右'
    const ratio = Math.round(readNumber(s, 'initial', 0.5) * 100)
    const flags = [dir, ratio + '%']
    flags.push(readNumber(s, 'minLeft', 120) + 'px / ' + readNumber(s, 'minRight', 120) + 'px')
    return flags.join(' · ')
  },
}
