/**
 * 试玩配置注册表。
 *
 * 每个组件的配置就住在它自己的目录里（src/components/<id>/playground.ts），
 * 文档也在一起（src/components/<id>/docs.md）。这里只做汇总登记。
 *
 * 加新组件：在组件目录写好 playground.ts，然后在下面 PLAYGROUND_CATALOG 加一行。
 */

import { buttonPlayground } from '../../components/button/playground'
import { buttonGroupPlayground } from '../../components/button-group/playground'
import { inputPlayground } from '../../components/input/playground'
import { numberPlayground } from '../../components/number/playground'
import { sliderPlayground } from '../../components/slider/playground'
import { switchPlayground } from '../../components/switch/playground'
import { tabsPlayground } from '../../components/tabs/playground'
import { selectPlayground } from '../../components/select/playground'
import { dropdownPlayground } from '../../components/dropdown/playground'
import { tooltipPlayground } from '../../components/tooltip/playground'
import { dialogPlayground } from '../../components/dialog/playground'
import { confirmPlayground } from '../../components/confirm/playground'
import { notifyPlayground } from '../../components/notify/playground'
import { messagesPlayground } from '../../components/messages/playground'
import { splitPanePlayground } from '../../components/split-pane/playground'
import { providerPlayground } from '../../provider/playground'
import type { ComponentPlayground } from '../playground'

/** 所有组件的试玩配置；key 就是 catalog / 文档的组件 id。 */
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
  tooltip: tooltipPlayground,
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

export type { ComponentPlayground, PlaygroundField, PlaygroundPreset, PlaygroundValue } from '../playground'
