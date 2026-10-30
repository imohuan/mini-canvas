import { readBool, readNumber, readText, type ComponentPlayground } from '../../preview/playground'
import type { DropdownAnchor } from './types'

/**
 * Dropdown 的试玩配置。
 *
 * 这里是默认值、面板分组和预设的唯一来源：
 * - DropdownPlayground.vue 用它直接生成可视配置面板；
 * - 通用预览页仍可按 id 找到这份配置。
 *
 * 尺寸字段用字符串保存，方便手输 px / rem / calc()；空串表示用组件默认值。
 */
export const dropdownPlayground: ComponentPlayground = {
  id: 'dropdown',
  defaults: {
    trigger: 'click',
    placement: 'bottom-start' as DropdownAnchor,
    align: 'auto',
    offset: 6,
    matchWidth: false,
    arrow: true,
    menuWidth: '',
    menuHeight: '',
    menuMinWidth: '220px',
    menuMaxWidth: '360px',
    menuMaxHeight: '280px',
    layout: 'overlay-scroll',
    disabled: false,
    itemCount: 6,
    showShortcut: false,
  },
  fields: [
    { kind: 'segment', key: 'trigger', label: '触发方式', group: '触发', hint: 'always = 一直显示，用来调试面板布局。', options: [
      { value: 'click', label: '点击' },
      { value: 'hover', label: '悬停' },
      { value: 'contextmenu', label: '右键' },
      { value: 'always', label: '常显' },
    ] },
    /* 弹出方向：真实九宫格，三行三列。
       行 = 主方向（上/左/右/下），列 = 对齐（起点/中/终点）；
       同名格是不同语义（如 top-start=菜单在上方贴左缘；left-start=菜单在左方贴上缘）。 */
    { kind: 'segment', key: 'placement', label: '弹出方向', group: '位置', hint: '每行 = 一个主方向，列 = 起点/中/终点；同名格语义不同。', options: [
      { value: 'top-start', label: '左上' },
      { value: 'top', label: '中上' },
      { value: 'top-end', label: '右上' },
      { value: 'left-start', label: '左上' },
      { value: 'left', label: '左中' },
      { value: 'left-end', label: '左下' },
      { value: 'right-start', label: '右上' },
      { value: 'right', label: '右中' },
      { value: 'right-end', label: '右下' },
      { value: 'bottom-start', label: '左下' },
      { value: 'bottom', label: '中下' },
      { value: 'bottom-end', label: '右下' },
    ] },
    { kind: 'number', key: 'offset', label: '与触发器间距', group: '位置', min: 0, max: 60, suffix: 'px' },
    { kind: 'toggle', key: 'arrow', label: '显示箭头', group: '外观', hint: '箭头会指向触发器中心；左右弹出时贴在左右边。' },
    { kind: 'toggle', key: 'matchWidth', label: '与触发器同宽', group: '尺寸', hint: '勾选后 width 会跟随触发器；再填固定宽会覆盖它。' },
    { kind: 'text', key: 'menuWidth', label: '容器宽度', group: '尺寸', placeholder: '例如 260px；留空用默认', hint: '直接改这里，浮层宽度马上变。' },
    { kind: 'text', key: 'menuHeight', label: '容器高度', group: '尺寸', placeholder: '例如 180px；留空由内容撑开', hint: '填了固定高后，内容超过就按下面的滚动方式处理。' },
    { kind: 'text', key: 'menuMinWidth', label: '最小宽度', group: '尺寸', placeholder: '例如 220px' },
    { kind: 'text', key: 'menuMaxWidth', label: '最大宽度', group: '尺寸', placeholder: '例如 360px；留空不限制' },
    { kind: 'text', key: 'menuMaxHeight', label: '最大高度', group: '尺寸', placeholder: '例如 280px；留空不限制' },
    { kind: 'segment', key: 'layout', label: '内容滚动', group: '尺寸', options: [
      { value: 'overlay-scroll', label: '整体滚' },
      { value: 'inner-scroll', label: '内容滚' },
    ] },
    { kind: 'number', key: 'itemCount', label: '菜单项数量', group: '内容', min: 1, max: 30 },
    { kind: 'toggle', key: 'showShortcut', label: '显示快捷键', group: '内容' },
    { kind: 'toggle', key: 'disabled', label: '禁用触发器', group: '状态' },
  ],
  presets: [
    { id: 'menu', name: '普通点击菜单', description: '最常用的一档', patch: { trigger: 'click', placement: 'bottom-start', align: 'auto', offset: 6, matchWidth: false, arrow: true, menuWidth: '', menuHeight: '', menuMinWidth: '220px', menuMaxWidth: '360px', menuMaxHeight: '280px', layout: 'overlay-scroll', disabled: false, itemCount: 6, showShortcut: false } },
    { id: 'hover', name: '悬停展开', description: '适合工具栏速览', patch: { trigger: 'hover', placement: 'bottom-start', align: 'auto', offset: 6, matchWidth: false, arrow: true, menuWidth: '', menuHeight: '', menuMinWidth: '220px', menuMaxWidth: '360px', menuMaxHeight: '280px', layout: 'overlay-scroll', disabled: false, itemCount: 6, showShortcut: false } },
    { id: 'context', name: '右键菜单', description: '右键触发器打开', patch: { trigger: 'contextmenu', placement: 'bottom-start', align: 'auto', offset: 6, matchWidth: false, arrow: true, menuWidth: '', menuHeight: '', menuMinWidth: '220px', menuMaxWidth: '360px', menuMaxHeight: '280px', layout: 'overlay-scroll', disabled: false, itemCount: 6, showShortcut: true } },
    { id: 'wide', name: '同宽下拉', description: '像原生 select', patch: { trigger: 'click', placement: 'bottom-start', align: 'auto', offset: 4, matchWidth: true, arrow: false, menuWidth: '', menuHeight: '', menuMinWidth: '220px', menuMaxWidth: '', menuMaxHeight: '240px', layout: 'overlay-scroll', disabled: false, itemCount: 5, showShortcut: false } },
    { id: 'inner', name: '固定高 + 内部滚', description: '标题固定，列表滚动', patch: { trigger: 'click', placement: 'bottom-start', align: 'auto', offset: 6, matchWidth: false, arrow: true, menuWidth: '260px', menuHeight: '180px', menuMinWidth: '220px', menuMaxWidth: '', menuMaxHeight: '180px', layout: 'inner-scroll', disabled: false, itemCount: 20, showShortcut: false } },
  ],
  summary: (s) => {
    const trigger = { click: '点击', hover: '悬停', contextmenu: '右键', always: '常显' }[readText(s, 'trigger')] ?? '点击'
    const placementMap: Record<string, string> = {
      'top-start': '左上', 'top': '中上', 'top-end': '右上',
      'left-start': '左上', 'left': '左中', 'left-end': '左下',
      'right-start': '右上', 'right': '右中', 'right-end': '右下',
      'bottom-start': '左下', 'bottom': '中下', 'bottom-end': '右下',
    }
    const placement = placementMap[readText(s, 'placement')] ?? '左下'
    const flags = [trigger, placement]
    if (readBool(s, 'arrow')) flags.push('箭头')
    if (readBool(s, 'matchWidth')) flags.push('同宽')
    flags.push(readNumber(s, 'itemCount', 6) + ' 项')
    if (readBool(s, 'disabled')) flags.push('禁用')
    return flags.join(' · ')
  },
}
