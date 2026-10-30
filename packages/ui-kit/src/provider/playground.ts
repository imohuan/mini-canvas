import { readBool, readText, type ComponentPlayground } from '../preview/playground'

export const providerPlayground: ComponentPlayground = {
  id: 'provider',
  defaults: {
    size: 'md',
    density: 'comfortable',
    radius: 10,
    dark: true,
    accent: '#22b8d8',
  },
  fields: [
    { kind: 'segment', key: 'size', label: '默认尺寸', options: [
      { value: 'sm', label: '小' },
      { value: 'md', label: '中' },
      { value: 'lg', label: '大' },
    ] },
    { kind: 'segment', key: 'density', label: '密度', options: [
      { value: 'compact', label: '紧凑' },
      { value: 'comfortable', label: '标准' },
      { value: 'spacious', label: '宽松' },
    ] },
    { kind: 'range', key: 'radius', label: '圆角', min: 0, max: 24, step: 1, unit: 'px' },
    { kind: 'toggle', key: 'dark', label: '深色主题' },
    { kind: 'text', key: 'accent', label: '主题色', placeholder: '#22b8d8' },
  ],
  presets: [
    { id: 'balanced', name: '标准', description: '中等尺寸，常规密度', patch: { size: 'md', density: 'comfortable', radius: 10, dark: true, accent: '#22b8d8' } },
    { id: 'compact', name: '紧凑型', description: '信息密度高', patch: { size: 'sm', density: 'compact', radius: 6, dark: true, accent: '#22b8d8' } },
    { id: 'roomy', name: '宽松型', description: '大尺寸，留白多', patch: { size: 'lg', density: 'spacious', radius: 16, dark: true, accent: '#7c5cff' } },
  ],
  summary: (s) => {
    const size = { sm: '小', md: '中', lg: '大' }[readText(s, 'size')] ?? '中'
    const density = { compact: '紧凑', comfortable: '标准', spacious: '宽松' }[readText(s, 'density')] ?? '标准'
    const flags = [size, density]
    if (readBool(s, 'dark')) flags.push('深色')
    flags.push(readText(s, 'accent') || '默认色')
    return flags.join(' · ')
  },
}
