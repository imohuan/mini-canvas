<script setup lang="ts">
/**
 * 浮层组件案例：**每个组件一个真实可点的例子**，标题直接用组件名。
 *
 * 用户口径 2026-11-04：不要一个「浮层配色」表，要看这些组件到底长什么样。
 * 所以这里只做一件事：把 Select / DropdownMenu / Popover / Tooltip / Dialog /
 * Notify / Message 各放一个能点开的实例，名字就叫组件名，方便逐个对照。
 *
 * 所有组件都从 @/previewKit 取，因此尺寸 / 圆角 / 字体 / 颜色改动会同时生效。
 */
import { ref } from 'vue'
import { ChevronDownIcon, InfoIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/previewKit'

const embeddedValue = ref('Seedream 4.5')
const detachedValue = ref('seedance')
const scrollValue = ref('分辨率 1024')
const depthValue = ref('seedance-20')

/** 长列表案例：40 项，必然出现滚动条。 */
const LONG_LIST = [
  ...Array.from({ length: 40 }, (_, i) => `分辨率 ${1024 + i * 128}`),
]
const messageText = ref('')

/** Message 案例：页内一条消息，可关闭。 */
const messageVisible = ref(true)

function notify(): void {
  toast.success('已保存到画布', {
    description: '这是 Notify 案例：右下角通知（vue-sonner）',
  })
}

function sendMessage(): void {
  messageText.value = '这是一条 Message 案例：页内消息条，不需要弹层。'
  messageVisible.value = true
}
</script>

<template>
  <div class="rounded-3xl border border-border bg-card p-4">
    <div class="mb-3 flex flex-wrap items-baseline justify-between gap-2">
      <div class="flex items-baseline gap-2">
        <span class="text-sm font-medium">浮层组件案例</span>
        <span class="text-xs text-muted-foreground">每一项都可点开，标题就是组件名</span>
      </div>
    </div>

    <div class="grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <!-- Select：三种常见写法（基础 / 长列表滚动 / 分组） -->
      <div class="flex flex-col gap-3 rounded-2xl bg-muted/40 p-3 sm:col-span-2 lg:col-span-3">
        <div class="flex flex-col">
          <span class="text-xs font-medium">Select</span>
          <span class="text-[11px] text-muted-foreground">
            嵌入（item-aligned，面板盖在触发器上）/ 分离（popper，面板贴着触发器外侧）/ 滚动 / 二级分组
          </span>
        </div>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div class="flex flex-col gap-1.5">
            <span class="text-[11px] text-muted-foreground">嵌入（item-aligned）</span>
            <Select v-model="embeddedValue">
              <SelectTrigger class="w-full" aria-label="Select 嵌入案例">
                <SelectValue placeholder="选择模型" />
              </SelectTrigger>
              <!-- position=item-aligned：面板与选中行对齐、盖住触发器（shadcn 默认样式） -->
              <SelectContent position="item-aligned">
                <SelectItem value="Seedream 4.5">Seedream 4.5</SelectItem>
                <SelectItem value="Seedream 5.0 Pro">Seedream 5.0 Pro</SelectItem>
                <SelectItem value="Seedance 2.0">Seedance 2.0</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div class="flex flex-col gap-1.5">
            <span class="text-[11px] text-muted-foreground">分离（popper）</span>
            <Select v-model="detachedValue">
              <SelectTrigger class="w-full" aria-label="Select 分离案例">
                <SelectValue placeholder="选择模型" />
              </SelectTrigger>
              <!-- position=popper：面板浮在触发器下方，宽度与触发器对齐 -->
              <SelectContent position="popper" side="bottom" :side-offset="4">
                <SelectItem value="seedream">Seedream 4.5</SelectItem>
                <SelectItem value="seedream-pro">Seedream 5.0 Pro</SelectItem>
                <SelectItem value="seedance">Seedance 2.0</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div class="flex flex-col gap-1.5">
            <span class="text-[11px] text-muted-foreground">长列表（自动出滚动条）</span>
            <Select v-model="scrollValue">
              <SelectTrigger class="w-full" aria-label="Select 滚动案例">
                <SelectValue placeholder="选择分辨率" />
              </SelectTrigger>
              <SelectContent class="max-h-56">
                <SelectItem v-for="item in LONG_LIST" :key="item" :value="item">{{ item }}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div class="flex flex-col gap-1.5">
            <span class="text-[11px] text-muted-foreground">二级（分组 + 子项）</span>
            <Select v-model="depthValue">
              <SelectTrigger class="w-full" aria-label="Select 二级案例">
                <SelectValue placeholder="选择模型" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Seedream</SelectLabel>
                  <SelectItem value="seedream-45">4.5</SelectItem>
                  <SelectItem value="seedream-50">5.0 Pro</SelectItem>
                </SelectGroup>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>Seedance</SelectLabel>
                  <SelectItem value="seedance-20">2.0</SelectItem>
                  <SelectItem value="seedance-fast">2.0 Fast</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <!-- DropdownMenu -->
      <div class="flex flex-col gap-2 rounded-2xl bg-muted/40 p-3">
        <span class="text-xs font-medium">DropdownMenu</span>
        <span class="text-[11px] text-muted-foreground">点击展开一组操作（含二级菜单）</span>
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="outline" class="w-full justify-between">
              更多操作 <ChevronDownIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" class="w-56">
            <DropdownMenuLabel>画布</DropdownMenuLabel>
            <DropdownMenuItem>重命名</DropdownMenuItem>
            <DropdownMenuItem>复制一份</DropdownMenuItem>
            <DropdownMenuSeparator />
            <!-- 二级菜单：悬停或方向键进入，父菜单保持展开 -->
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>更多模型</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem>Seedream 4.5</DropdownMenuItem>
                <DropdownMenuItem>Seedream 5.0 Pro</DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Seedance</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem>2.0</DropdownMenuItem>
                    <DropdownMenuItem>2.0 Fast</DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuGroup>
              <DropdownMenuLabel>导出</DropdownMenuLabel>
              <DropdownMenuItem>导出 PNG</DropdownMenuItem>
              <DropdownMenuItem>导出 SVG</DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive">删除</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <!-- Popover -->
      <div class="flex flex-col gap-2 rounded-2xl bg-muted/40 p-3">
        <span class="text-xs font-medium">Popover</span>
        <span class="text-[11px] text-muted-foreground">点开后放任意内容</span>
        <Popover>
          <PopoverTrigger as-child>
            <Button variant="outline" class="w-full">打开参数面板</Button>
          </PopoverTrigger>
          <PopoverContent align="start" class="w-64">
            <PopoverHeader>
              <PopoverTitle>生成参数</PopoverTitle>
              <PopoverDescription>Popover 里可以放表单、滑块等任意布局。</PopoverDescription>
            </PopoverHeader>
            <div class="mt-2 grid gap-1.5">
              <Label class="text-xs">随机种子</Label>
              <Input placeholder="例如 20261104" />
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <!-- Tooltip -->
      <div class="flex flex-col gap-2 rounded-2xl bg-muted/40 p-3">
        <span class="text-xs font-medium">Tooltip</span>
        <span class="text-[11px] text-muted-foreground">鼠标悬停显示一句说明</span>
        <TooltipProvider :delay-duration="80">
          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="outline" class="w-full justify-start gap-2">
                <InfoIcon /> 悬停看提示
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">这是 Tooltip 案例：悬停出现的轻提示</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <!-- Dialog -->
      <div class="flex flex-col gap-2 rounded-2xl bg-muted/40 p-3">
        <span class="text-xs font-medium">Dialog</span>
        <span class="text-[11px] text-muted-foreground">模态弹窗，需要用户确认</span>
        <Dialog>
          <DialogTrigger as-child>
            <Button variant="outline" class="w-full">打开弹窗</Button>
          </DialogTrigger>
          <DialogContent class="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>删除这张画布？</DialogTitle>
              <DialogDescription>删除后不可恢复，节点与连线都会一起消失。</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline">取消</Button>
              <Button variant="destructive">确认删除</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <!-- Notify -->
      <div class="flex flex-col gap-2 rounded-2xl bg-muted/40 p-3">
        <span class="text-xs font-medium">Notify</span>
        <span class="text-[11px] text-muted-foreground">右下角浮出的通知</span>
        <Button variant="outline" class="w-full" @click="notify">发一条通知</Button>
        <Badge variant="outline" class="w-fit text-[11px]">toast / vue-sonner</Badge>
      </div>

      <!-- Message -->
      <div class="flex flex-col gap-2 rounded-2xl bg-muted/40 p-3 sm:col-span-2 lg:col-span-3">
        <div class="flex items-center justify-between gap-2">
          <div class="flex flex-col">
            <span class="text-xs font-medium">Message</span>
            <span class="text-[11px] text-muted-foreground">页内消息条：不遮挡内容，可关闭</span>
          </div>
          <Button variant="outline" size="sm" @click="sendMessage">显示消息</Button>
        </div>
        <div
          v-if="messageVisible && messageText"
          class="flex items-start gap-2 rounded-xl bg-primary/10 px-3 py-2 text-xs text-foreground"
          role="status"
        >
          <InfoIcon class="mt-0.5 size-3.5 flex-none opacity-70" />
          <span class="min-w-0 flex-1">{{ messageText }}</span>
          <button
            type="button"
            class="flex-none text-muted-foreground hover:text-foreground"
            aria-label="关闭消息"
            @click="messageVisible = false"
          >×</button>
        </div>
      </div>
    </div>
  </div>
</template>
