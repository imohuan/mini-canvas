<script setup lang="ts">
/** 反馈：徽标、按钮口味与提示条。 */
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/previewKit'
</script>

<template>
  <Card class="min-w-0">
    <CardHeader>
      <CardTitle>反馈</CardTitle>
      <CardDescription>徽标、按钮口味与提示。</CardDescription>
    </CardHeader>
    <CardContent class="grid gap-4">
      <div class="flex flex-wrap items-center gap-2">
        <Badge>默认</Badge>
        <Badge variant="secondary">次级</Badge>
        <Badge variant="outline">描边</Badge>
        <Badge variant="destructive">危险</Badge>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <Button>主按钮</Button>
        <Button variant="secondary">次级</Button>
        <Button variant="outline">描边</Button>
        <Button variant="ghost">幽灵</Button>
        <Button variant="destructive">危险</Button>
        <Button variant="link">链接</Button>
      </div>

      <p class="rounded-2xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
        Tabs / 分隔线 / 徽标 / 勾选 / 开关 / 滑块 / 输入，均跟随上方圆角与尺寸。
      </p>
    </CardContent>
  </Card>
</template>
