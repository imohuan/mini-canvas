<script setup lang="ts">
/**
 * 卡片墙 · Tabs。
 *
 * 基础 / 命令面板 / 组合框 / 反馈 四个页签放一张卡片里，
 * 页签高度跟随全局尺寸，卡片本身不写死高度。
 */
import { computed, ref } from 'vue'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Combobox,
  ComboboxAnchor,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxViewport,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/previewKit'

const active = ref('basics')
const commandQuery = ref('')
const modelQuery = ref('')
const model = ref('seedream')

const COMMANDS = [
  { value: 'new-canvas', label: '新建画布', group: '画布', shortcut: '⌘ N' },
  { value: 'new-image', label: '新建图片节点', group: '节点', shortcut: '⌘ ⇧ I' },
  { value: 'export', label: '导出画布', group: '画布', shortcut: '⌘ E' },
  { value: 'settings', label: '打开设置', group: '系统', shortcut: '⌘ ,' },
]

const MODELS = [
  { value: 'seedream', label: 'Seedream 4.5', hint: '通用图像' },
  { value: 'seedream-pro', label: 'Seedream 5.0 Pro', hint: '细节更稳' },
  { value: 'seedance', label: 'Seedance 2.0', hint: '视频生成' },
  { value: 'seedance-fast', label: 'Seedance 2.0 Fast', hint: '更快' },
]

const filteredModels = computed(() => {
  const q = modelQuery.value.trim().toLowerCase()
  return q ? MODELS.filter((m) => m.label.toLowerCase().includes(q)) : MODELS
})
</script>

<template>
  <Card size="sm" class="break-inside-avoid">
    <CardHeader>
      <CardTitle class="text-sm">Tabs</CardTitle>
      <CardDescription class="text-xs">四个页签：基础 / 命令面板 / 组合框 / 反馈</CardDescription>
    </CardHeader>

    <CardContent>
      <Tabs v-model="active" class="w-full">
        <TabsList class="w-full">
          <TabsTrigger value="basics">基础</TabsTrigger>
          <TabsTrigger value="command">命令面板</TabsTrigger>
          <TabsTrigger value="combobox">组合框</TabsTrigger>
          <TabsTrigger value="feedback">反馈</TabsTrigger>
        </TabsList>

        <TabsContent value="basics" class="grid gap-2 pt-3">
          <div class="flex flex-wrap items-center gap-2">
            <Badge>默认</Badge>
            <Badge variant="secondary">次级</Badge>
            <Badge variant="outline">描边</Badge>
          </div>
          <p class="text-xs text-muted-foreground">
            页签、徽标、勾选、开关、滑块、输入都跟随顶部的圆角与尺寸。
          </p>
        </TabsContent>

        <TabsContent value="command" class="pt-3">
          <div class="overflow-hidden rounded-xl border border-border">
            <Input
              v-model="commandQuery"
              placeholder="搜动作 / 节点 / 设置"
              class="rounded-none border-0 border-b border-border bg-transparent"
            />
            <div class="flex flex-col p-1.5">
              <button
                v-for="item in COMMANDS"
                :key="item.value"
                type="button"
                class="flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-muted"
              >
                <span>{{ item.label }}</span>
                <span class="text-[11px] text-muted-foreground">{{ item.shortcut }}</span>
              </button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="combobox" class="pt-3">
          <Combobox v-model="model" :ignore-filter="true">
            <ComboboxAnchor>
              <ComboboxInput v-model="modelQuery" placeholder="搜索模型" />
            </ComboboxAnchor>
            <ComboboxList>
              <ComboboxViewport>
                <ComboboxEmpty>没有匹配的模型</ComboboxEmpty>
                <ComboboxItem v-for="m in filteredModels" :key="m.value" :value="m.value">
                  <span class="flex flex-1 items-center justify-between gap-2 text-xs">
                    <span>{{ m.label }}</span>
                    <span class="text-muted-foreground">{{ m.hint }}</span>
                  </span>
                </ComboboxItem>
              </ComboboxViewport>
            </ComboboxList>
          </Combobox>
        </TabsContent>

        <TabsContent value="feedback" class="pt-3">
          <div class="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm">轻提示</Button>
            <Button variant="ghost" size="sm">消息</Button>
            <Button variant="secondary" size="sm">次要操作</Button>
          </div>
        </TabsContent>
      </Tabs>
    </CardContent>
  </Card>
</template>
