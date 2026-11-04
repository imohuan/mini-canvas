<script setup lang="ts">
/** 覆盖范围：当前已拉下来的组合件与单件清单。 */
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/previewKit'

const NAMES = [
  'Button', 'Input', 'Textarea', 'NumberField', 'Slider', 'Switch', 'Checkbox', 'RadioGroup',
  'Select', 'Combobox', 'DropdownMenu', 'ContextMenu', 'Menubar', 'Popover', 'Tooltip',
  'Dialog', 'AlertDialog', 'Sheet', 'Tabs', 'Command', 'Card', 'Badge', 'Separator',
  'InputGroup', 'ColorPicker',
]
</script>

<template>
  <Card class="min-w-0">
    <CardHeader>
      <CardTitle>覆盖范围</CardTitle>
      <CardDescription>已拉下来的组合件与单件。</CardDescription>
    </CardHeader>
    <CardContent class="flex flex-wrap gap-2">
      <Badge v-for="name in NAMES" :key="name" variant="outline">{{ name }}</Badge>
    </CardContent>
  </Card>
</template>
