/**
 * 预览页的试玩配置注册表（catalog）。
 *
 * 每个组件在 playgrounds/<id>.ts 里有一份自己的配置，这里统一登记。
 * 页面按当前选中的组件 id 来这里取配置；取不到就退回「无参数」提示。
 *
 * 加新组件：写好 playgrounds/<id>.ts，然后在下面 PLAYGROUND_CATALOG 里加一行。
 */

import { buttonPlayground } from './button'
import { buttonGroupPlayground } from './button-group'
import { inputPlayground } from './input'
import { numberPlayground } from './number'
import { sliderPlayground } from './slider'
import { switchPlayground } from './switch'
import { tabsPlayground } from './tabs'
import { selectPlayground } from './select'
import { dropdownPlayground } from './dropdown'
import { popoverPlayground } from './popover'
import { tooltipPlayground } from './tooltip'
import { contextMenuPlayground } from './context-menu'
import { dialogPlayground } from './dialog'
import { confirmPlayground } from './confirm'
import { notifyPlayground } from './notify'
import { messagesPlayground } from './messages'
import { splitPanePlayground } from './split-pane'
import { providerPlayground } from './provider'
import type { ComponentPlayground } from './types'

/** 所有组件的试玩配置；key 就是 catalog / docs 的组件 id。 */
export const PLAYGROUND_CATALOG: Record<string, ComponentPlayground> = {
  button: buttonPlayground,
  'button-group': buttonGroupPlayground,
  input: inputPlayground,
  number: numberPlayground,
  slider: sliderPlayground,
  switch: switchPlayground,
  tabs: tabsPlayground,
  select: selectPlayground,
  dropdown: dropdownPlayground,
  popover: popoverPlayground,
  tooltip: tooltipPlayground,
  'context-menu': contextMenuPlayground,
  dialog: dialogPlayground,
  confirm: confirmPlayground,
  notify: notifyPlayground,
  messages: messagesPlayground,
  'split-pane': splitPanePlayground,
  provider: providerPlayground,
}

/** 取某个组件的配置；没有配置的组件返回 undefined。 */
export function findPlayground(id: string): ComponentPlayground | undefined {
  return PLAYGROUND_CATALOG[id]
}

/** 有配置的组件 id 列表，测试用它检查覆盖率。 */
export const PLAYGROUND_IDS = Object.keys(PLAYGROUND_CATALOG)

export type { ComponentPlayground, PlaygroundField, PlaygroundPreset, PlaygroundValue } from './types'
