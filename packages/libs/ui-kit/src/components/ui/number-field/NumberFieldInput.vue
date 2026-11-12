<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from 'cn'
import { NumberFieldInput } from 'reka-ui'
import { numberFieldInputVariants } from '.'

/**
 * 与 Button 同一套写法：自己声明 size，由注册薄层注入全局档位。
 *
 * 之前这里把 `h-9` 写死在 class 里，所以全局改「控件尺寸」时它纹丝不动
 * （2026-11-04 用户反馈）。现在高度 / 字号进 cva 变体，档位一变就跟着变。
 */
const props = withDefaults(
  defineProps<{
    class?: HTMLAttributes['class']
    size?: 'sm' | 'default' | 'lg'
  }>(),
  { size: 'default' },
)
</script>

<template>
  <NumberFieldInput
    data-slot="input"
    :data-size="props.size"
    :class="cn(
      'bg-input/50 border-transparent focus-visible:border-ring focus-visible:ring-ring/30 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 rounded-3xl border px-3 py-1 transition-[color,box-shadow,background-color] file:h-7 file:text-sm file:font-medium focus-visible:ring-3 aria-invalid:ring-3 w-full min-w-0 text-center outline-none placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
      numberFieldInputVariants({ size: props.size }),
      props.class,
    )"
  />
</template>
