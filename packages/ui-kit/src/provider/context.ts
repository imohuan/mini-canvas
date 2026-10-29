import { inject, provide, ref, type InjectionKey, type Ref } from 'vue'
import type { UiKitContext } from '../shared/types'
import { resolveConfig } from './config'

export const UI_KIT_CONTEXT: InjectionKey<Ref<UiKitContext>> = Symbol('ui-kit-context')

/** 没有 Provider 时也能用：回落默认配置。 */
export const DEFAULT_CONTEXT: UiKitContext = resolveConfig({})

export function provideUiKitContext(context: Ref<UiKitContext>): void {
  provide(UI_KIT_CONTEXT, context)
}

export function useUiKit(): Ref<UiKitContext> {
  return inject(UI_KIT_CONTEXT, null) ?? ref(DEFAULT_CONTEXT)
}

