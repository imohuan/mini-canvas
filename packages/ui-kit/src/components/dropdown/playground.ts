import { readText, readBool, readNumber, type ComponentPlayground } from '../../preview/playground'

export const dropdownPlayground: ComponentPlayground = {
  id: 'dropdown',
  defaults: {
    trigger: 'click',
    placement: 'bottom-start',
    offset: 6,
    matchWidth: false,
    menuMinWidth: '220px',
    menuMaxHeight: '220px',
    disabled: false,
    itemCount: 6,
  },
  fields: [
    { kind: 'segment', key: 'trigger', label: '触发方式', options: [
      { value: 'click', label: '点击' },
      { value: 'hover', label: '悬停' },
      { value: 'contextmenu', label: '右键' },
    ] },
    { kind: 'segment', key: 'placement', label: '弹出方向', options: [
      { value: 'bottom-start', label: '左下' },
      { value: 'bottom-end', label: '右下' },
      { value: 'top-start', label: '左上' },
      { value: 'right-start', label: '右侧' },
    ] },
    { kind: 'number', key: 'offset', label: '与触发器间距', min: 0, max: 40, suffix: 'px' },
    { kind: 'number', key: 'itemCount', label: '菜单项数量', min: 1, max: 14 },
    { kind: 'toggle', key: 'matchWidth', label: '与触发器同宽' },
    { kind: 'toggle', key: 'disabled', label: '禁用' },
  ],
  presets: [
    { id: 'menu', name: '点击菜单', description: '最常用', patch: { trigger: 'click', placement: 'bottom-start', offset: 6, matchWidth: false, menuMinWidth: '220px', menuMaxHeight: '220px', disabled: false, itemCount: 6 } },
    { id: 'hover', name: '悬停展开', description: '鼠标移上去就开', patch: { trigger: 'hover', placement: 'bottom-start', offset: 6, matchWidth: false, menuMinWidth: '220px', menuMaxHeight: '220px', disabled: false, itemCount: 6 } },
    { id: 'context', name: '右键菜单', description: '右键触发器打开', patch: { trigger: 'contextmenu', placement: 'bottom-start', offset: 6, matchWidth: false, menuMinWidth: '220px', menuMaxHeight: '220px', disabled: false, itemCount: 6 } },
    { id: 'wide', name: '同宽下拉', description: '跟触发器一样宽', patch: { trigger: 'click', placement: 'bottom-start', offset: 6, matchWidth: true, menuMinWidth: '220px', menuMaxHeight: '320px', disabled: false, itemCount: 10 } },
  ],
  summary: (s) => {
    const trigger = { click: '点击', hover: '悬停', contextmenu: '右键' }[readText(s, 'trigger')] ?? '点击'
    const placement = { 'bottom-start': '左下', 'bottom-end': '右下', 'top-start': '左上', 'right-start': '右侧' }[readText(s, 'placement')] ?? '左下'
    const flags = [trigger, placement]
    if (readBool(s, 'matchWidth')) flags.push('同宽')
    flags.push(readNumber(s, 'itemCount', 6) + ' 项')
    if (readBool(s, 'disabled')) flags.push('禁用')
    return flags.join(' · ')
  },
}
