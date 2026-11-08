/**
 * 主题工作台的颜色目录。
 *
 * 关键变化（2026-11-02）：不再手写“12 个颜色 + 假样张”的固定表。
 * 真正的颜色项来自 **settings 里已经声明的 color 字段**：插件装了就出现，插件卸了就消失。
 * 这里只保留一层“字段 → 真实预览目标”的元数据。新增颜色时，插件加 Config 字段即可；
 * 如果该颜色想连到画布，再在 COLOR_META 里补一条锚点。没有元数据的字段也会自动出现，
 * 只是会明确标成“未绑定预览”，绝不会为了好看画一条假线。
 */

export type ThemeLabMode = 'light' | 'dark'
export type ThemeLabScene = 'base' | 'multi' | 'align' | 'box' | 'cut'
export type ThemeLabGroup = '品牌' | '连线' | '选择' | '切割' | '其它'

/** 一个真实 DOM 锚点。selector 必须是组件自己渲染出来的元素，不能用样张冒充。 */
export interface ThemeLabAnchor {
  /** 这个目标由哪个插件提供；插件没装时不会用它 */
  plugin: string
  /** 给用户看的目标名 */
  label: string
  /** 真实组件里的选择器 */
  selector: string
  /** 只在哪些场景里找它；不填 = 所有场景都可用 */
  scenes?: ThemeLabScene[]
  /** 取样位置（默认 center） */
  at?: 'center' | 'left' | 'right' | 'top' | 'bottom'
  /** SVG path 专用：按弧长比例取一个真正落在路径上的点（0..1） */
  pathAt?: number
  /** 目标可能在画布外（切割 overlay / 框选框挂在 body 上） */
  scope?: 'stage' | 'document'
  /** 1px 参考线这类极细目标 */
  thin?: boolean
}

/** 一个颜色字段的展示元数据（按 base key 匹配，例如 accentColor / multiSelectFrameOuterColor）。 */
export interface ThemeLabColorMeta {
  label: string
  group: ThemeLabGroup
  /** 展示归属；theme-default 表示默认主题/宿主色板 */
  plugin: string
  description: string
  affects: string
  /** 清空时跟随哪个颜色（可选色才有） */
  followKey?: string
  /** 配置 → 变量 → 组件 的真实链路 */
  chain: string[]
  anchors: ThemeLabAnchor[]
  inactiveHint?: string
  /** 同组排序 */
  order: number
}

/** settings 里一条已声明字段的最小形状（不依赖 kernel 类型，方便纯函数测试） */
export interface DeclaredColorField {
  group: string
  key: string
  schema: {
    type?: 'color' | 'number' | 'select' | 'boolean' | 'text'
    label?: string
    description?: string
    default: string | number | boolean
    optional?: boolean
  }
  value: string | number | boolean
}

/** 工作台真正渲染的一格颜色（亮/暗两格合成一条） */
export interface ThemeLabColorEntry {
  /** base key，例如 accentColor */
  id: string
  label: string
  description: string
  group: ThemeLabGroup
  plugin: string
  pluginLabel: string
  /** 当前主题模式对应的真实 settings key */
  keys: { light: string; dark: string }
  /** 默认值（来自 settings schema） */
  defaults: { light: string; dark: string }
  optional: boolean
  affects: string
  chain: string[]
  anchors: ThemeLabAnchor[]
  inactiveHint?: string
  /** 有没有真实 DOM 锚点；没有时仍然可编辑，只是不画线 */
  bound: boolean
  followKey?: string
  order: number
}

export const GROUP_ORDER: ThemeLabGroup[] = ['品牌', '连线', '选择', '切割', '其它']

export const PLUGIN_LABELS: Record<string, string> = {
  'theme-default': '默认主题',
  'multi-select': '多选',
  'align-guide': '对齐参考线',
  'edge-cutting': '连线切割',
  'canvas-render': '画布内核',
  unknown: '其它插件',
}

/** 可装卸的可选插件（默认主题是画布前提，不在此列） */
export const OPTIONAL_PLUGINS = ['multi-select', 'align-guide', 'edge-cutting'] as const

export const SCENE_META: Array<{
  id: ThemeLabScene
  label: string
  plugin?: string
  hint: string
}> = [
  {
    id: 'base',
    label: '基础',
    hint: '选中一条真实连线：流光正在跑。改强调色 / 连线色，按钮与连线会立刻变。',
  },
  {
    id: 'multi',
    label: '多选',
    plugin: 'multi-select',
    hint: '真实多选插件已选中两个节点：内外框、批量端口和节点标记都是它渲染的。',
  },
  {
    id: 'align',
    label: '对齐',
    plugin: 'align-guide',
    hint: '回放一次真实拖拽：参考线由对齐插件自己计算并绘制。',
  },
  {
    id: 'box',
    label: '框选',
    plugin: 'multi-select',
    hint: '真实 Shift 绘制框正在回放：颜色与线型都来自多选插件配置。',
  },
  {
    id: 'cut',
    label: '切割',
    plugin: 'edge-cutting',
    hint: '切割插件的真实 overlay 正在回放：轨迹与刀锋都不是样张，也不会真的删线。',
  },
]

/**
 * 字段 → 真实目标。
 *
 * 这里每个 selector 都能在画布里找到真正吃这个颜色的元素；找不到就不画线。
 * 新增颜色但没有锚点时，工作台仍会显示色块，并明确标成“未绑定预览”。
 */
export const COLOR_META: Record<string, ThemeLabColorMeta> = {
  accentColor: {
    label: '强调色',
    group: '品牌',
    plugin: 'theme-default',
    description: '主按钮、选中工具、开关、链接。',
    affects: '所有表示“当前 / 可操作”的地方',
    chain: ['accentColorDark', '--uic-accent-color-dark', '--ui-accent', 'shadcn Button'],
    order: 0,
    anchors: [
      {
        plugin: 'multi-select',
        label: '多选标记',
        selector: '.v2-multi-radio',
        scenes: ['multi', 'box'],
      },
      { plugin: 'theme-default', label: '真实主按钮', selector: '[data-lab="accent-action"]' },
      { plugin: 'theme-default', label: '真实主按钮', selector: '[data-lab="accent-action"]' },
    ],
  },
  accentHoverColor: {
    label: '强调色（悬停）',
    group: '品牌',
    plugin: 'theme-default',
    description: '主按钮悬停与按下时的加深档。',
    affects: '真实按钮的悬停反馈',
    chain: ['accentHoverColorDark', '--uic-accent-hover-color-dark', '--ui-accent-hover', '主按钮 :hover'],
    order: 1,
    inactiveHint: '把鼠标移到真实主按钮上：底色会切到悬停档；这条线指向同一个按钮。',
    anchors: [
      {
        plugin: 'theme-default',
        label: '真实主按钮',
        selector: '[data-lab="accent-action"]',
        scenes: ['base', 'align', 'cut'],
      },
    ],
  },
  dangerColor: {
    label: '危险色',
    group: '品牌',
    plugin: 'theme-default',
    description: '删除、失效、破坏性操作。',
    affects: '危险图标与文字',
    chain: ['dangerColorDark', '--uic-danger-color-dark', '--ui-danger', 'NodeEmptyState'],
    order: 2,
    anchors: [
      {
        plugin: 'theme-default',
        label: '失效素材图标',
        selector: '[data-lab="danger-state"] .nes-icon',
      },
    ],
  },
  warnColor: {
    label: '警示色',
    group: '品牌',
    plugin: 'theme-default',
    description: '注意事项、未确认状态。',
    affects: '警示图标与文字',
    chain: ['warnColorDark', '--uic-warn-color-dark', '--ui-warn', 'NodeEmptyState'],
    order: 3,
    anchors: [
      {
        plugin: 'theme-default',
        label: '待确认图标',
        selector: '[data-lab="warn-state"] .nes-icon',
      },
    ],
  },
  edgeRailColor: {
    label: '连线颜色',
    group: '连线',
    plugin: 'theme-default',
    description: '节点之间那条静态导轨。',
    affects: '所有连线的底色',
    chain: ['edgeRailColorDark', '--uic-edge-rail-color-dark', '--ui-edge-rail', 'useThemeColor → CustomEdge'],
    order: 10,
    anchors: [
      { plugin: 'theme-default', label: '流光导轨', selector: '.ef-rail', pathAt: 0.36 },
      { plugin: 'theme-default', label: '静态导轨', selector: '.ef-base', pathAt: 0.36 },
    ],
  },
  edgeFlowColor: {
    label: '流光颜色',
    group: '连线',
    plugin: 'theme-default',
    description: '选中连线时沿线跑动的光斑。',
    affects: '流光、箭头与选中辉光',
    followKey: 'accentColor',
    chain: ['edgeFlowColorDark', '--uic-edge-flow-color-dark', '--ui-edge-flow', 'CustomEdge 流光'],
    order: 11,
    inactiveHint: '先选中一条连线，流光才会跑起来；线指向流光所在的导轨。',
    anchors: [
      { plugin: 'theme-default', label: '流光导轨', selector: '.ef-rail', pathAt: 0.68 },
    ],
  },
  alignGuideColor: {
    label: '参考线颜色',
    group: '选择',
    plugin: 'align-guide',
    description: '拖动节点对齐时出现的辅助线。',
    affects: '吸附参考线',
    followKey: 'accentColor',
    chain: ['alignGuideColorDark', '--uic-align-guide-dark', '--ui-guide', 'AlignGuideOverlay'],
    order: 20,
    inactiveHint: '切到「对齐」场景，插件会画出真实参考线。',
    anchors: [
      { plugin: 'align-guide', label: '真实对齐线', selector: '.align-guide-line', scenes: ['align'], thin: true },
    ],
  },
  multiSelectBoxColor: {
    label: '绘制框颜色',
    group: '选择',
    plugin: 'multi-select',
    description: 'Shift 拖拽时随鼠标画出的框。',
    affects: '绘制框描边与淡底',
    followKey: 'accentColor',
    chain: ['multiSelectBoxColorDark', 'resolveMultiSelectFrameConfig', '--ui-select-box', 'BoxSelectLayer'],
    order: 21,
    inactiveHint: '切到「框选」场景，真实 Shift 绘制框会自动回放。',
    anchors: [
      {
        plugin: 'multi-select',
        label: '真实绘制框',
        selector: '[data-multi-select-box]',
        scenes: ['box'],
        scope: 'document',
      },
    ],
  },
  multiSelectFrameOuterColor: {
    label: '多选框-外框',
    group: '选择',
    plugin: 'multi-select',
    description: '选中多个节点后，外面的大框。',
    affects: '多选外框',
    followKey: 'accentColor',
    chain: ['multiSelectFrameOuterColorDark', 'frameStrokeCss', '--ui-select-outer', 'SelectionFrame'],
    order: 22,
    inactiveHint: '切到「多选」或「框选」场景，选中两个以上节点后出现。',
    anchors: [
      {
        plugin: 'multi-select',
        label: '真实多选外框',
        selector: '.selection-frame-outer',
        scenes: ['multi', 'box'],
        at: 'top',
      },
    ],
  },
  multiSelectFrameInnerColor: {
    label: '多选框-内框',
    group: '选择',
    plugin: 'multi-select',
    description: '紧贴选中节点的小框。',
    affects: '多选内框',
    followKey: 'accentColor',
    chain: ['multiSelectFrameInnerColorDark', 'frameStrokeCss', '--ui-select-inner', 'SelectionFrame'],
    order: 23,
    inactiveHint: '切到「多选」或「框选」场景，选中两个以上节点后出现。',
    anchors: [
      {
        plugin: 'multi-select',
        label: '真实多选内框',
        selector: '.selection-frame-inner',
        scenes: ['multi', 'box'],
        at: 'bottom',
      },
    ],
  },
  pathColor: {
    label: '切割轨迹颜色',
    group: '切割',
    plugin: 'edge-cutting',
    description: 'Alt 拖拽时划过的完整轨迹。',
    affects: '刀光轨迹',
    followKey: 'accentHoverColor',
    chain: ['pathColor', 'edgeCuttingConfigFrom', '--edge-cutting-path-color', 'EdgeCuttingOverlay.cut-path'],
    order: 30,
    inactiveHint: '切到「切割」场景，真实刀光 overlay 会回放。',
    anchors: [
      {
        plugin: 'edge-cutting',
        label: '真实切割轨迹',
        selector: '.edge-cutting-overlay .cut-path',
        scenes: ['cut'],
        scope: 'document',
        pathAt: 0.55,
      },
    ],
  },
  bladeColor: {
    label: '刀锋颜色',
    group: '切割',
    plugin: 'edge-cutting',
    description: '刀尖和那一小截发光尾迹。',
    affects: '刀锋与火花',
    followKey: 'accentColor',
    chain: ['bladeColor', 'edgeCuttingConfigFrom', '--edge-cutting-blade-color', 'EdgeCuttingOverlay.blade-tip'],
    order: 31,
    inactiveHint: '切到「切割」场景，真实刀光 overlay 会回放。',
    anchors: [
      {
        plugin: 'edge-cutting',
        label: '真实刀尖',
        selector: '.edge-cutting-overlay .blade-tip',
        scenes: ['cut'],
        scope: 'document',
      },
    ],
  },
}

/** accentColorLight → accentColor；pathColor 原样返回 */
export function baseKeyOf(key: string): string {
  return key.replace(/(Light|Dark)$/, '')
}

/** 主题色板里“几乎总是存在”的宿主字段，不需要对应可装卸插件 */
const ALWAYS_INSTALLED = new Set(['theme-default', 'canvas-render'])

/**
 * 把 settings 里的真实 color 字段合成工作台的一格一格颜色。
 *
 * 规则（也是“以后新增颜色怎么办”的答案）：
 * - 有字段、有元数据、插件已装 → 显示，并连到真实组件；
 * - 有字段、没元数据 → 仍然显示，但标成“未绑定预览”，不画假线；
 * - 没字段 / 插件没装 → 不显示（配置本来就不存在）。
 */
export function buildColorEntries(
  fields: DeclaredColorField[],
  installed: ReadonlySet<string>,
): ThemeLabColorEntry[] {
  const colorFields = fields.filter((field) => field.schema?.type === 'color')

  const byBase = new Map<string, DeclaredColorField[]>()
  for (const field of colorFields) {
    const base = baseKeyOf(field.key)
    const list = byBase.get(base) ?? []
    list.push(field)
    byBase.set(base, list)
  }

  const entries: ThemeLabColorEntry[] = []
  for (const [base, groupFields] of byBase) {
    const meta = COLOR_META[base]
    const plugin = meta?.plugin ?? 'unknown'
    // 未知来源的字段只会在“声明它的插件已经装上”时才存在于 settings，
    // 所以这里不能再拿 installed 过滤一遍（否则用户新加的颜色永远不出现）。
    if (plugin !== 'unknown' && !ALWAYS_INSTALLED.has(plugin) && !installed.has(plugin)) continue

    const lightField =
      groupFields.find((field) => field.key === base + 'Light') ??
      groupFields.find((field) => field.key === base) ??
      groupFields.find((field) => field.key === base + 'Dark')
    const darkField =
      groupFields.find((field) => field.key === base + 'Dark') ??
      groupFields.find((field) => field.key === base) ??
      lightField
    if (!lightField || !darkField) continue

    const lightDefault = String(lightField.schema.default ?? '')
    const darkDefault = String(darkField.schema.default ?? lightDefault)
    const optional = Boolean(lightField.schema.optional ?? darkField.schema.optional)
    const anchors = meta?.anchors ?? []

    entries.push({
      id: base,
      label: meta?.label ?? lightField.schema.label ?? darkField.schema.label ?? base,
      description: meta?.description ?? lightField.schema.description ?? '',
      group: meta?.group ?? '其它',
      plugin,
      pluginLabel: PLUGIN_LABELS[plugin] ?? plugin,
      keys: { light: lightField.key, dark: darkField.key },
      defaults: { light: lightDefault, dark: darkDefault },
      optional,
      affects: meta?.affects ?? '还没有声明预览锚点',
      chain: meta?.chain ?? ['—'],
      anchors,
      inactiveHint: meta?.inactiveHint,
      bound: anchors.length > 0,
      followKey: meta?.followKey,
      order: meta?.order ?? 999,
    })
  }

  return entries.sort((a, b) => {
    const groupDiff = GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group)
    if (groupDiff !== 0) return groupDiff
    if (a.order !== b.order) return a.order - b.order
    return a.label.localeCompare(b.label, 'zh-CN')
  })
}
