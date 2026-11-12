<script setup lang="ts">
// 右上角：积分余额 / 主题切换 / 设置（照用户标注只保留这三个）
// 按钮与提示气泡从画布 ctx 的 ui 注册表按名取；交互与 aria 语义不变。
import { Zap, Palette, Settings } from 'lucide-vue-next'
import { useUiComponent } from '@plume-canvas/canvas-render'
import { useUi } from '../../composables/ui'

const Button = useUiComponent('Button')
const Tooltip = useUiComponent('Tooltip')
const TooltipContent = useUiComponent('TooltipContent')
const TooltipProvider = useUiComponent('TooltipProvider')
const TooltipTrigger = useUiComponent('TooltipTrigger')

const ui = useUi()
const s = ui.state
</script>

<template>
  <TooltipProvider :delay-duration="150">
    <div class="flex items-center gap-2">
      <!-- <Button
        variant="outline"
        size="sm"
        aria-label="积分余额" @click="ui.showToast('积分余额')"
      ><Zap :size="14" /> 20</Button> -->
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" size="icon-sm" aria-label="主题切换" @click="ui.toggleTheme()">
            <Palette />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">主题切换</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button :variant="s.settingsOpen ? 'secondary' : 'ghost'" size="icon-sm"
            aria-label="设置" :aria-pressed="s.settingsOpen ? 'true' : 'false'"
            @click="s.settingsOpen = !s.settingsOpen">
            <Settings />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">设置</TooltipContent>
      </Tooltip>
    </div>
  </TooltipProvider>
</template>
