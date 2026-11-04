<script setup lang="ts">
/**
 * 预览页顶部的「组件配置」条。
 *
 * 这里的每一项都对应真实组件会读的开关，改完立刻生效：
 * - 颜色 / 字体 / 圆角：写 CSS 变量；
 * - 尺寸档位 / 箭头 / 间距 / 偏移 / 二级菜单间距：写 componentConfig。
 *
 * 布局（用户口径 2026-11-04）：桌面端固定 6 列。
 * 之前最多 4 列，字段被拉得很宽；现在每个字段只占一列，
 * 单行能同时看到更多配置，也不用上下滚动。
 *
 * 拆件：颜色 / 数字 / 单选各是一个小组件（./config/*），
 * 这里只负责排布与写回，避免再出现"一个文件里三套重复模板"。
 */
import { computed } from 'vue'
import { Switch } from '@/previewKit'
import { RADIUS_OPTIONS } from './fonts'
import FontSelect from './FontSelect.vue'
import { COMPONENT_SIZE_CHOICES } from '../componentConfig'
import type { PreviewThemeConfig } from './useThemePreview'
import ConfigField from './config/ConfigField.vue'
import ColorConfigField from './config/ColorConfigField.vue'
import ChoiceChips from './config/ChoiceChips.vue'
import NumberConfigField from './config/NumberConfigField.vue'
import type { ChoiceOption } from './config/types'

const props = defineProps<{ config: PreviewThemeConfig; dark: boolean }>()
const emit = defineEmits<{ 'update:config': [value: PreviewThemeConfig]; 'update:dark': [value: boolean] }>()

function patch(changes: Partial<PreviewThemeConfig>): void {
  emit('update:config', { ...props.config, ...changes })
}

/**
 * 圆角预览：把档位 id 换算成一小块方块的圆角。
 * 入参是 id（'large'），不是像素值 —— 之前直接把 id 丢进 rem 正则，
 * 结果每一档都算成 0px，用户看到的就是"选哪个都不变"。
 */
function radiusPreview(id: string): string {
  const option = RADIUS_OPTIONS.find((r) => r.id === id)
  const match = /^([\d.]+)rem$/.exec(option?.value ?? '')
  const px = match ? Number(match[1]) * 16 : 0
  // 预览块 22px 见方：上限 11px（正好半圆）
  return `${Math.min(Math.max(px, 0), 11).toFixed(1)}px`
}

const radiusOptions = computed<ChoiceOption[]>(() =>
  RADIUS_OPTIONS
    // 'default' 与 'medium' 都是 0.625rem：并成一档，免得出现两个"默认"
    .filter((r) => r.id !== 'medium')
    .map((r) => ({
      value: r.id,
      label: r.id === 'none' ? '无' : r.label.split('（')[0],
      paint: radiusPreview(r.id),
      kind: 'radius' as const,
      title: r.label,
    })),
)

const sizeOptions = computed<ChoiceOption[]>(() =>
  COMPONENT_SIZE_CHOICES.map((size) => ({
    value: size,
    label: size === 'sm' ? '小' : size === 'lg' ? '大' : '标准',
    // 20×20 框内可显示 4~14px：三档互相差 4px，缩略图能看出层次又不撑高
    paint: (size === 'sm' ? 6 : size === 'lg' ? 14 : 10) + 'px',
    kind: 'size' as const,
  })),
)
</script>

<template>
  <div class="rounded-3xl border border-border bg-card p-3">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-baseline gap-2">
        <span class="text-sm font-medium">组件配置</span>
        <span class="text-xs text-muted-foreground">改完立刻作用到下面所有组件（含 Teleport 出去的浮层）</span>
      </div>
      <label class="flex items-center gap-2 text-xs text-muted-foreground">
        暗色
        <Switch :model-value="dark" @update:model-value="emit('update:dark', $event)" />
      </label>
    </div>

    <!-- 6 列：每个字段只占一格，窄屏退回 2 列，避免横向挤压 -->
    <div class="grid grid-cols-1 gap-x-3 gap-y-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      <ColorConfigField
        label="底色 Base Color"
        field="baseColor"
        :config="config"
        :dark="dark"
        @update:config="emit('update:config', $event)"
      />
      <ColorConfigField
        label="主题色 Theme"
        field="theme"
        :config="config"
        :dark="dark"
        @update:config="emit('update:config', $event)"
      />

      <ConfigField label="正文字体 Font">
        <FontSelect :model-value="config.font" @update:model-value="(v) => patch({ font: v })" />
      </ConfigField>
      <ConfigField label="标题字体 Heading">
        <FontSelect allow-follow :model-value="config.heading" @update:model-value="(v) => patch({ heading: v })" />
      </ConfigField>

      <!-- 圆角 / 尺寸各占一格：两组的预览框固定 20×20，行高一致 -->
      <ConfigField label="圆角 Radius">
        <ChoiceChips
          :model-value="config.radius"
          :options="radiusOptions"
          @update:model-value="(v) => patch({ radius: v })"
        />
      </ConfigField>
      <ConfigField label="控件尺寸 Size">
        <ChoiceChips
          :model-value="config.size"
          :options="sizeOptions"
          @update:model-value="(v) => patch({ size: v as PreviewThemeConfig['size'] })"
        />
      </ConfigField>

      <ConfigField label="浮层箭头">
        <label class="flex h-8 items-center gap-2 text-xs text-muted-foreground">
          <Switch
            :model-value="config.arrowVisible"
            @update:model-value="patch({ arrowVisible: $event })"
          />
          {{ config.arrowVisible ? '显示' : '不显示' }}
        </label>
      </ConfigField>

      <NumberConfigField
        label="子菜单间距"
        :model-value="config.subGap"
        @update:model-value="(v) => patch({ subGap: v })"
      />
      <NumberConfigField
        label="触发器间距 gap"
        :model-value="config.gap"
        @update:model-value="(v) => patch({ gap: v })"
      />
      <NumberConfigField
        label="额外偏移 offset"
        :model-value="config.offset"
        @update:model-value="(v) => patch({ offset: v })"
      />
    </div>

    <p class="mt-3 text-xs text-muted-foreground">
      浮层最终距离 = gap + offset。箭头是三角形时，间隔从箭头尖端量起。
    </p>
  </div>
</template>
