<script setup lang="ts">
/**
 * 卡片墙 · 下拉类。
 *
 * Select 的四种写法（嵌入 / 分离 / 滚动 / 分组）与 DropdownMenu 的多级菜单，
 * 放在同一张卡片里，方便并排比较面板的贴合方式。
 */
import { ref } from 'vue'
import { ChevronDownIcon } from '@lucide/vue'
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Label,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/previewKit'

const embedded = ref('Seedream 4.5')
const detached = ref('seedance')
const longValue = ref('分辨率 1024')
const depthValue = ref('seedance-20')

/** 40 项，打开就必然出现滚动条。 */
const LONG_LIST = Array.from({ length: 40 }, (_, i) => `分辨率 ${1024 + i * 128}`)
</script>

<template>
  <Card class="break-inside-avoid">
    <CardHeader>
      <CardTitle class="text-sm">Select / DropdownMenu</CardTitle>
      <CardDescription class="text-xs">嵌入、分离、长列表滚动、分组，以及三级子菜单</CardDescription>
    </CardHeader>

    <CardContent class="grid gap-3">
      <div class="grid gap-1.5">
        <Label class="text-xs">嵌入（item-aligned，面板盖在触发器上）</Label>
        <Select v-model="embedded">
          <SelectTrigger class="w-full" aria-label="Select 嵌入案例">
            <SelectValue placeholder="选择模型" />
          </SelectTrigger>
          <SelectContent position="item-aligned">
            <SelectItem value="Seedream 4.5">Seedream 4.5</SelectItem>
            <SelectItem value="Seedream 5.0 Pro">Seedream 5.0 Pro</SelectItem>
            <SelectItem value="Seedance 2.0">Seedance 2.0</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div class="grid gap-1.5">
        <Label class="text-xs">分离（popper，面板贴着触发器外侧）</Label>
        <Select v-model="detached">
          <SelectTrigger class="w-full" aria-label="Select 分离案例">
            <SelectValue placeholder="选择模型" />
          </SelectTrigger>
          <SelectContent position="popper" side="bottom" :side-offset="4">
            <SelectItem value="seedream">Seedream 4.5</SelectItem>
            <SelectItem value="seedream-pro">Seedream 5.0 Pro</SelectItem>
            <SelectItem value="seedance">Seedance 2.0</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div class="grid gap-1.5">
        <Label class="text-xs">长列表（自动出滚动条）</Label>
        <Select v-model="longValue">
          <SelectTrigger class="w-full" aria-label="Select 滚动案例">
            <SelectValue placeholder="选择分辨率" />
          </SelectTrigger>
          <SelectContent class="max-h-56">
            <SelectItem v-for="item in LONG_LIST" :key="item" :value="item">{{ item }}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div class="grid gap-1.5">
        <Label class="text-xs">二级分组（分组标题 + 子项）</Label>
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

      <div class="grid gap-1.5">
        <Label class="text-xs">DropdownMenu（含三级子菜单）</Label>
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="outline" class="w-full justify-between font-normal">
              更多操作 <ChevronDownIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" class="w-52">
            <DropdownMenuLabel>画布</DropdownMenuLabel>
            <DropdownMenuItem>重命名</DropdownMenuItem>
            <DropdownMenuItem>复制一份</DropdownMenuItem>
            <DropdownMenuSeparator />
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
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive">删除</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </CardContent>
  </Card>
</template>
