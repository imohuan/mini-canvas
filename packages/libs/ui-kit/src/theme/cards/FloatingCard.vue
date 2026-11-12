<script setup lang="ts">
/**
 * 卡片墙 · 浮层。
 *
 * Popover / Tooltip / Dialog 三种浮层各一个能点开的实例；
 * 箭头、间距、偏移都吃顶部配置（gap + offset 累加）。
 */
import { InfoIcon } from '@lucide/vue'
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
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
  Separator,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../previewKit'
</script>

<template>
  <Card class="break-inside-avoid">
    <CardHeader>
      <CardTitle class="text-sm">Popover / Tooltip / Dialog</CardTitle>
      <CardDescription class="text-xs">三种浮层的真实用法，箭头与间距跟随顶部配置</CardDescription>
    </CardHeader>

    <CardContent class="grid gap-3">
      <div class="flex flex-col gap-1.5">
        <Label class="text-xs">Popover · 放任意内容</Label>
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

      <Separator />

      <div class="flex flex-col gap-1.5">
        <Label class="text-xs">Tooltip · 悬停说明</Label>
        <TooltipProvider :delay-duration="80">
          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="outline" class="w-full justify-start gap-2">
                <InfoIcon /> 悬停看提示
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">悬停出现的轻提示，不打断操作</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <Separator />

      <div class="flex flex-col gap-1.5">
        <Label class="text-xs">Dialog · 需要确认</Label>
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
    </CardContent>
  </Card>
</template>
