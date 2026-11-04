<script setup lang="ts">
/** 表单：输入、文本域、数字、勾选、开关、单选与滑块。 */
import { ref } from 'vue'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
  NumberField,
  NumberFieldContent,
  NumberFieldDecrement,
  NumberFieldIncrement,
  NumberFieldInput,
  RadioGroup,
  RadioGroupItem,
  Slider,
  Switch,
  Textarea,
} from '@/previewKit'

const name = ref('')
const note = ref('')
const count = ref<number>(1)
const enabled = ref(true)
const checked = ref(false)
const mode = ref('light')
const weight = ref<number[]>([60])
</script>

<template>
  <Card class="min-w-0">
    <CardHeader>
      <CardTitle>表单</CardTitle>
      <CardDescription>输入、勾选、开关与单选。</CardDescription>
    </CardHeader>
    <CardContent class="grid gap-4">
      <div class="grid gap-2">
        <Label for="form-name">名称</Label>
        <Input id="form-name" v-model="name" placeholder="给这个节点起个名字" />
      </div>

      <div class="grid gap-2">
        <Label for="form-note">备注</Label>
        <Textarea id="form-note" v-model="note" placeholder="写点说明" />
      </div>

      <div class="grid gap-2">
        <Label>数量</Label>
        <NumberField v-model="count" :min="0" :max="99">
          <NumberFieldContent>
            <NumberFieldDecrement />
            <NumberFieldInput />
            <NumberFieldIncrement />
          </NumberFieldContent>
        </NumberField>
      </div>

      <div class="flex flex-wrap items-center gap-5">
        <label class="flex items-center gap-2 text-sm">
          <Checkbox v-model="checked" /> 记住选择
        </label>
        <label class="flex items-center gap-2 text-sm">
          <Switch v-model="enabled" /> 启用
        </label>
      </div>

      <div class="grid gap-2">
        <Label>外观</Label>
        <RadioGroup v-model="mode" class="flex flex-wrap gap-4">
          <label class="flex items-center gap-2 text-sm">
            <RadioGroupItem value="light" /> 浅色
          </label>
          <label class="flex items-center gap-2 text-sm">
            <RadioGroupItem value="dark" /> 深色
          </label>
          <label class="flex items-center gap-2 text-sm">
            <RadioGroupItem value="system" /> 跟随系统
          </label>
        </RadioGroup>
      </div>

      <div class="grid gap-2">
        <div class="flex items-center justify-between gap-4">
          <Label>强度</Label>
          <span class="text-sm tabular-nums text-muted-foreground">{{ weight[0] }}</span>
        </div>
        <Slider v-model="weight" :min="0" :max="100" :step="1" />
      </div>
    </CardContent>
  </Card>
</template>
