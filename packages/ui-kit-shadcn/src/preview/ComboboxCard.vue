<script setup lang="ts">
/** 组合框：可搜索的模型选择。 */
import { computed, ref } from 'vue'
import {
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
} from '@/previewKit'

const model = ref('seedream')
const query = ref('')

const MODELS = [
  { value: 'seedream', label: 'Seedream 4.5', hint: '通用图像' },
  { value: 'seedream-pro', label: 'Seedream 5.0 Pro', hint: '细节更稳' },
  { value: 'seedance', label: 'Seedance 2.0', hint: '视频生成' },
  { value: 'seedance-fast', label: 'Seedance 2.0 Fast', hint: '更快，适合草稿' },
]

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  return q ? MODELS.filter((m) => m.label.toLowerCase().includes(q)) : MODELS
})
</script>

<template>
  <Card class="min-w-0">
    <CardHeader>
      <CardTitle>组合框</CardTitle>
      <CardDescription>输入即筛，选中写回。</CardDescription>
    </CardHeader>
    <CardContent>
      <Combobox v-model="model" :ignore-filter="true">
        <ComboboxAnchor>
          <ComboboxInput v-model="query" placeholder="搜索模型" />
        </ComboboxAnchor>
        <ComboboxList>
          <ComboboxViewport>
            <ComboboxEmpty>没有匹配的模型</ComboboxEmpty>
            <ComboboxItem v-for="m in filtered" :key="m.value" :value="m.value">
              <span class="flex flex-1 items-center justify-between gap-2">
                <span>{{ m.label }}</span>
                <span class="text-xs text-muted-foreground">{{ m.hint }}</span>
              </span>
            </ComboboxItem>
          </ComboboxViewport>
        </ComboboxList>
      </Combobox>
    </CardContent>
  </Card>
</template>
