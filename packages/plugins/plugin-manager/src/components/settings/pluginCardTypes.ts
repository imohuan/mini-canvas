/** 插件卡片的数据形状：页面负责拼数据，卡片只负责画。 */
export type PluginCardTone = 'on' | 'off' | 'warn' | 'err' | 'builtin'

export type PluginServerTone = 'on' | 'off' | 'warn' | 'err'

export type PluginCardButtonVariant =
  | 'default'
  | 'outline'
  | 'secondary'
  | 'destructive'
  | 'ghost'
  | 'link'

export interface PluginCardAction {
  key: string
  label: string
  variant?: PluginCardButtonVariant
  disabled?: boolean
  title?: string
  ariaLabel?: string
}

export interface PluginManagerCardView {
  id: string
  title: string
  description: string
  /** 版本、包名等第二行信息 */
  meta?: string
  status: string
  tone: PluginCardTone
  busy?: boolean
  builtin?: boolean
  server?: { text: string; tone: PluginServerTone }
  error?: string
  warning?: string
  note?: string
  actions: PluginCardAction[]
  /** 点击卡片时触发的动作；没有就不做整卡点击 */
  primaryAction?: string
  clickHint?: string
  footerNote?: string
}
