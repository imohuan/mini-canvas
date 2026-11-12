<script setup lang="ts">
/**
 * 卡片墙 · 基础组件。
 *
 * 按钮 / 徽标 / 勾选 / 开关 / 滑块 / 输入 / 分隔线 —— 一张卡片里按行排好，
 * 高度随内容，不和旁边卡片互相对齐（用户口径 2026-11-04：卡片墙）。
 */
import { ref } from 'vue'
import { PlusIcon, SparklesIcon } from '@lucide/vue'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
  Separator,
  Slider,
  Switch,
} from '../../previewKit'

const checked = ref(true)
const enabled = ref(true)
const level = ref<number[]>([24])
const text = ref('')
</script>

<template>
  <Card class="break-inside-avoid">
    <CardHeader>
      <CardTitle class="text-sm">基础组件</CardTitle>
      <CardDescription class="text-xs">同一档尺寸下高矮一致，圆角跟随顶部配置</CardDescription>
    </CardHeader>

    <CardContent class="grid gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <Button>主按钮</Button>
        <Button variant="secondary">次级</Button>
        <Button variant="outline">描边</Button>
        <Button variant="ghost">幽灵</Button>
        <Button variant="link">链接</Button>
        <Button variant="destructive">危险</Button>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <Button size="icon-sm" aria-label="新增"><PlusIcon /></Button>
        <Button variant="outline"><SparklesIcon /> 图标 + 文字</Button>
        <Button variant="secondary" disabled>已禁用</Button>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <Badge>默认</Badge>
        <Badge variant="secondary">次级</Badge>
        <Badge variant="outline">描边</Badge>
        <Badge variant="destructive">危险</Badge>
      </div>

      <Separator />

      <div class="flex flex-wrap items-center gap-4">
        <label class="flex items-center gap-1.5 text-xs"><Checkbox v-model="checked" /> 勾选</label>
        <label class="flex items-center gap-1.5 text-xs"><Switch v-model="enabled" /> 开关</label>
      </div>

      <div class="grid gap-1.5">
        <div class="flex items-center justify-between gap-4">
          <Label class="text-xs">滑块</Label>
          <span class="text-xs tabular-nums text-muted-foreground">{{ level[0] }}</span>
        </div>
        <Slider v-model="level" :min="1" :max="60" :step="1" />
      </div>

      <div class="grid gap-1.5">
        <Label class="text-xs">输入框</Label>
        <Input v-model="text" placeholder="单行输入" />
      </div>
    </CardContent>
  </Card>
</template>
