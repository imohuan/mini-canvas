import { SIZE_OPTIONS, readSize, readText, readBool, type ComponentPlayground } from './types'

export const buttonGroupPlayground: ComponentPlayground = {
  id: 'button-group',
  defaults: {
    orientation: 'horizontal',
    size: 'md',
    attached: true,
    block: false,
  },
  fields: [
    { kind: 'segment', key: 'orientation', label: '方向', options: [
      { value: 'horizontal', label: '左右' },
      { value: 'vertical', label: '上下' },
    ] },
    { kind: 'segment', key: 'size', label: '尺寸', options: SIZE_OPTIONS },
    { kind: 'toggle', key: 'attached', label: '贴合' },
    { kind: 'toggle', key: 'block', label: '占满宽度' },
  ],
  presets: [
    { id: 'toolbar', name: '工具栏', description: '贴合的一组操作', patch: { orientation: 'horizontal', size: 'md', attached: true, block: false } },
    { id: 'roomy', name: '留缝按钮组', description: '每个按钮独立', patch: { orientation: 'horizontal', size: 'md', attached: false, block: false } },
    { id: 'vertical', name: '竖排', description: '侧边工具列', patch: { orientation: 'vertical', size: 'sm', attached: true, block: false } },
  ],
  summary: (s) => {
    const dir = readText(s, 'orientation') === 'vertical' ? '上下' : '左右'
    const size = { sm: '小', md: '中', lg: '大' }[readSize(s)]
    const flags = [dir, size]
    flags.push(readBool(s, 'attached') ? '贴合' : '留缝')
    if (readBool(s, 'block')) flags.push('整行')
    return flags.join(' · ')
  },
}
