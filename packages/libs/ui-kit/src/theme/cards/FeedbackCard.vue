<script setup lang="ts">
/**
 * 卡片墙 · 反馈。
 *
 * Notify（右下角通知）与 Message（页内消息条）放在一张卡片里，
 * 两者都是「告诉用户发生了什么」，只是打扰程度不同。
 */
import { ref } from 'vue'
import { CircleAlertIcon, InfoIcon, XIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Separator,
} from '../../previewKit'

const messageVisible = ref(true)
const messageKind = ref<'info' | 'error'>('info')

function notify(): void {
  toast.success('已保存到画布', { description: '右下角通知（vue-sonner）' })
}

function showMessage(kind: 'info' | 'error'): void {
  messageKind.value = kind
  messageVisible.value = true
}
</script>

<template>
  <Card class="break-inside-avoid">
    <CardHeader>
      <CardTitle class="text-sm">Notify / Message</CardTitle>
      <CardDescription class="text-xs">一个在右下角浮出，一个贴在页里不挡内容</CardDescription>
    </CardHeader>

    <CardContent class="grid gap-3">
      <div class="flex flex-col gap-1.5">
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs text-muted-foreground">Notify · 右下角浮出</span>
          <Badge variant="outline" class="text-[10px]">toast</Badge>
        </div>
        <Button variant="outline" class="w-full" @click="notify">发一条通知</Button>
      </div>

      <Separator />

      <div class="flex flex-col gap-1.5">
        <span class="text-xs text-muted-foreground">Message · 页内消息条</span>
        <div class="flex flex-wrap gap-2">
          <Button variant="outline" @click="showMessage('info')">普通消息</Button>
          <Button variant="outline" @click="showMessage('error')">错误消息</Button>
        </div>

        <div
          v-if="messageVisible"
          class="flex items-start gap-2 rounded-lg px-2.5 py-2 text-xs"
          :class="messageKind === 'error' ? 'bg-destructive/12 text-destructive' : 'bg-primary/12 text-foreground'"
          role="status"
        >
          <CircleAlertIcon v-if="messageKind === 'error'" class="mt-0.5 size-3.5 flex-none" />
          <InfoIcon v-else class="mt-0.5 size-3.5 flex-none opacity-70" />
          <span class="min-w-0 flex-1">
            {{ messageKind === 'error' ? '保存失败：后台拒绝了这次写入。' : '已保存到画布，可以继续编辑。' }}
          </span>
          <button
            type="button"
            class="flex-none opacity-60 hover:opacity-100"
            aria-label="关闭消息"
            @click="messageVisible = false"
          >
            <XIcon class="size-3.5" />
          </button>
        </div>
      </div>
    </CardContent>
  </Card>
</template>
