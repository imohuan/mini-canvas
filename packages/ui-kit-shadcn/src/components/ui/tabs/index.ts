import type { VariantProps } from 'class-variance-authority'
import { cva } from 'class-variance-authority'

export { default as Tabs } from './Tabs.vue'
export { default as TabsContent } from './TabsContent.vue'
export { default as TabsList } from './TabsList.vue'
export { default as TabsTrigger } from './TabsTrigger.vue'

export const tabsListVariants = cva(
  'rounded-full p-1 group-data-vertical/tabs:rounded-2xl data-[variant=line]:rounded-none group/tabs-list inline-flex w-fit items-center justify-center text-muted-foreground group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col',
  {
    variants: {
      variant: {
        default: 'bg-muted',
        line: 'gap-1 bg-transparent',
      },
      /**
       * 高度档位：与 Button / Input / 下拉触发器同一套三档（32 / 36 / 40）。
       *
       * 之前这里写死 `h-9`，所以全局尺寸选「大」时，页签仍停在 36px，
       * 和旁边 40px 的按钮、输入框排在一行就明显不齐（2026-11-04 用户反馈）。
       */
      size: {
        sm: 'group-data-horizontal/tabs:h-8',
        default: 'group-data-horizontal/tabs:h-9',
        lg: 'group-data-horizontal/tabs:h-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export type TabsListVariants = VariantProps<typeof tabsListVariants>
