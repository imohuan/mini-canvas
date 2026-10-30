import { toDoc, type RawDocModule, type UiKitDoc } from './docRaw'

export type { UiKitDoc } from './docRaw'

interface DocModule extends RawDocModule {}

const modules = {
  provider: () => import('virtual:ui-kit-doc/provider') as Promise<DocModule>,
  button: () => import('virtual:ui-kit-doc/button') as Promise<DocModule>,
  'button-group': () => import('virtual:ui-kit-doc/button-group') as Promise<DocModule>,
  input: () => import('virtual:ui-kit-doc/input') as Promise<DocModule>,
  number: () => import('virtual:ui-kit-doc/number') as Promise<DocModule>,
  slider: () => import('virtual:ui-kit-doc/slider') as Promise<DocModule>,
  switch: () => import('virtual:ui-kit-doc/switch') as Promise<DocModule>,
  tabs: () => import('virtual:ui-kit-doc/tabs') as Promise<DocModule>,
  dropdown: () => import('virtual:ui-kit-doc/dropdown') as Promise<DocModule>,
  select: () => import('virtual:ui-kit-doc/select') as Promise<DocModule>,
  popover: () => import('virtual:ui-kit-doc/popover') as Promise<DocModule>,
  tooltip: () => import('virtual:ui-kit-doc/tooltip') as Promise<DocModule>,
  'context-menu': () => import('virtual:ui-kit-doc/context-menu') as Promise<DocModule>,
  dialog: () => import('virtual:ui-kit-doc/dialog') as Promise<DocModule>,
  confirm: () => import('virtual:ui-kit-doc/confirm') as Promise<DocModule>,
  notify: () => import('virtual:ui-kit-doc/notify') as Promise<DocModule>,
  messages: () => import('virtual:ui-kit-doc/messages') as Promise<DocModule>,
  'split-pane': () => import('virtual:ui-kit-doc/split-pane') as Promise<DocModule>,
}

/** 文档加载完成前的占位，避免页面闪空。 */
export const PLACEHOLDER_DOC: UiKitDoc = { markdown: '', examples: [], codeHtml: [] }

const cache = new Map<string, UiKitDoc>()

/**
 * 文档是构建期产物，一次预取全部；个别 md 没写也不会拖垮页面。
 */
export async function loadDocs(): Promise<Record<string, UiKitDoc>> {
  if (cache.size > 0) return Object.fromEntries(cache)
  const entries = Object.keys(modules)
  const results = await Promise.allSettled(Object.values(modules).map((load) => load()))
  for (let i = 0; i < entries.length; i += 1) {
    const result = results[i]
    cache.set(entries[i], result.status === 'fulfilled'
      ? toDoc(result.value)
      : { markdown: '# ' + entries[i] + '\n\n文档还没写。', examples: [], codeHtml: [] })
  }
  return Object.fromEntries(cache)
}
