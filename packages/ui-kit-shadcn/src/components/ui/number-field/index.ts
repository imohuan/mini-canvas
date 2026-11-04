import type { VariantProps } from 'class-variance-authority'
import { cva } from 'class-variance-authority'

export { default as NumberField } from './NumberField.vue'
export { default as NumberFieldContent } from './NumberFieldContent.vue'
export { default as NumberFieldDecrement } from './NumberFieldDecrement.vue'
export { default as NumberFieldIncrement } from './NumberFieldIncrement.vue'
export { default as NumberFieldInput } from './NumberFieldInput.vue'

/**
 * 数字输入框的尺寸变体 —— 与 Button 完全同一套写法（cva + size 变体）。
 *
 * 用户口径 2026-11-04：为什么 Button 改尺寸会变、输入框不变？
 * 因为 Button 的高度写在 cva 的 size 变体里（h-8 / h-9 / h-10），
 * 而这里原来把 `h-9` 写死在子件的 class 里，改成别的档位没有任何规则命中。
 *
 * 现在高度、内边距、字号都进变体，子件按根节点 provide 的档位取，
 * 全局「控件尺寸」一改，输入框和两侧加减按钮一起变高。
 */
export const numberFieldVariants = cva('', {
  variants: {
    size: {
      sm: '',
      default: '',
      lg: '',
    },
  },
  defaultVariants: {
    size: 'default',
  },
})

/** 输入框本体：高度与圆角随档位走 */
export const numberFieldInputVariants = cva('', {
  variants: {
    size: {
      sm: 'h-8 text-sm',
      default: 'h-9 text-base md:text-sm',
      lg: 'h-10 text-base',
    },
  },
  defaultVariants: {
    size: 'default',
  },
})

/** 两侧加减按钮：内边距跟着高度走，避免大档里图标挤在一起 */
export const numberFieldStepVariants = cva('', {
  variants: {
    size: {
      sm: 'p-2',
      default: 'p-3',
      lg: 'p-4',
    },
  },
  defaultVariants: {
    size: 'default',
  },
})

export type NumberFieldSize = NonNullable<
  VariantProps<typeof numberFieldInputVariants>['size']
>
