<script setup lang="ts">
/** 菜单：普通菜单、二级菜单、勾选、快捷键盘键、Popover 与确认弹窗。 */
import { computed, ref } from 'vue'
import { ChevronDownIcon } from '@lucide/vue'
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
  Slider,
} from '@/previewKit'
import { COMMANDS } from './previewData'

const smartPrompt = ref(true)
const detailOpacity = ref<number[]>([80])
const selectedCommand = ref('')
const lastAction = ref('还没有选过菜单项')

const filteredCommands = computed(() => {
  const q = selectedCommand.value.trim().toLowerCase()
  return q ? COMMANDS.filter((c) => c.label.toLowerCase().includes(q)) : COMMANDS
})

function notifyAction(label: string): void {
  lastAction.value = '点了：' + label
}

function pick(value: string): void {
  lastAction.value = '选择了：' + (COMMANDS.find((c) => c.value === value)?.label ?? value)
}
</script>

<template>
  <Card class="min-w-0">
    <CardHeader>
      <CardTitle>菜单</CardTitle>
      <CardDescription>菜单、二级菜单、勾选与确认弹窗。</CardDescription>
    </CardHeader>
    <CardContent class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="outline">生成动作 <ChevronDownIcon /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent class="w-64" align="start">
            <DropdownMenuLabel>生成</DropdownMenuLabel>
            <DropdownMenuGroup>
              <DropdownMenuItem @select="notifyAction('生成图片')">
                生成图片 <DropdownMenuShortcut>⌘ ↵</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem @select="notifyAction('生成视频')">
                生成视频 <DropdownMenuShortcut>⌘ ⇧ ↵</DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>更多模型</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem @select="notifyAction('Seedream 4.5')">Seedream 4.5</DropdownMenuItem>
                <DropdownMenuItem @select="notifyAction('Seedream 5.0 Pro')">Seedream 5.0 Pro</DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Seedance</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem @select="notifyAction('Seedance 2.0')">2.0</DropdownMenuItem>
                    <DropdownMenuItem @select="notifyAction('Seedance 2.0 Fast')">2.0 Fast</DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem v-model="smartPrompt">提示词增强</DropdownMenuCheckboxItem>
            <DropdownMenuItem variant="destructive" @select="notifyAction('清空参数')">清空参数</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Popover>
          <PopoverTrigger as-child>
            <Button variant="secondary">参数浮层</Button>
          </PopoverTrigger>
          <PopoverContent class="w-80" align="start">
            <PopoverHeader>
              <PopoverTitle>自定义参数面板</PopoverTitle>
              <PopoverDescription>Popover 里可以放任意布局。</PopoverDescription>
            </PopoverHeader>
            <div class="grid gap-3">
              <div class="flex items-center justify-between gap-3 text-sm">
                <span>画面细节</span>
                <span class="tabular-nums text-muted-foreground">{{ detailOpacity[0] }}%</span>
              </div>
              <Slider v-model="detailOpacity" :min="0" :max="100" :step="1" />
              <Button @click="notifyAction('应用参数')">应用参数</Button>
            </div>
          </PopoverContent>
        </Popover>

        <Dialog>
          <DialogTrigger as-child>
            <Button variant="outline">确认弹窗</Button>
          </DialogTrigger>
          <DialogContent class="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>开始生成？</DialogTitle>
              <DialogDescription>生成结果会自动放进当前画布。</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline">取消</Button>
              <Button @click="notifyAction('确认生成')">开始生成</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <p class="rounded-2xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">{{ lastAction }}</p>

      <div class="overflow-hidden rounded-3xl border border-border">
        <input
          v-model="selectedCommand"
          class="w-full border-b border-border bg-transparent px-3 py-2 text-sm outline-none"
          placeholder="搜动作 / 节点 / 设置（演示）"
        />
        <div class="flex flex-col p-2">
          <button
            v-for="item in filteredCommands"
            :key="item.value"
            class="flex items-center justify-between rounded-2xl px-3 py-2 text-left text-sm hover:bg-muted"
            @click="pick(item.value)"
          >
            <span>{{ item.label }}</span>
            <span class="text-xs text-muted-foreground">{{ item.shortcut }}</span>
          </button>
        </div>
      </div>
    </CardContent>
  </Card>
</template>
