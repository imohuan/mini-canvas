<script setup lang="ts">
/**
 * VideoClipPanel —— 视频剪辑胶片条（video/clip 功能模式的底栏；单选时显示）。
 *
 * 1:1 复刻 packages/ui/public/video-clip-demo.html 的暗色胶囊剪辑条（用户口径 2026-10-29）：
 *   关闭 | 键盘（配置入口） | 胶片格（蓝胶囊选区 + 播放头 + 时长 pill） | 磁吸 | 循环 | 白色确认圆钮。
 * 点键盘图标在按钮上方弹出快捷键说明（shadcn Popover）。
 *
 * 几何与 demo 同一套（重点抄 demo 文件头「吸附行为」5 条铁律）：
 * - 磁吸作用对象是「选区时长」，不是背景位置；进入吸附点 ± 范围才吸，平时跟手；
 * - 吸附范围 ≤ 间隔/2（超出自动收回）；
 * - 0 和总时长是物理边界，贴边不做吸附取整；
 * - 最短时长优先级最高。
 *
 * 草稿归会话（不写库）：确认时经命令 video:clip-confirm 一次性提交。
 * 面板由 nodeToolbar 的 video/clip 模式挂在底栏（不再是一条底栏动作），
 * 所以顶栏「剪辑时长」点下去就能看到它 —— 不必先去下拉里手动选「剪辑」。
 *
 * 拆分后：本文件只保留入口状态接线；界面在 video-clip-panel/ 的子组件，
 * 时间轴几何/拖拽/键盘/播放预览分别住在同目录的 use*.ts。
 */
import { useClipPanel } from './video-clip-panel/useClipPanel'
import VideoClipDock from './video-clip-panel/VideoClipDock.vue'
import VideoClipFilm from './video-clip-panel/VideoClipFilm.vue'
import VideoClipCaption from './video-clip-panel/VideoClipCaption.vue'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()

const {
  panelEl,
  visible,
  hasVideo,
  pending,
  prefs,
  range,
  startPct,
  endPct,
  lengthLabel,
  atLeft,
  atRight,
  labelBelow,
  captionLeftPx,
  playheadPct,
  duration,
  frames,
  frameIndices,
  isDragging,
  configOpen,
  onHandleDown,
  toggleSnap,
  toggleLoop,
  onConfirm,
  onCancel,
} = useClipPanel({
  nodeId: props.id,
  data: () => props.data,
})
</script>

<template>
  <div v-if="visible" ref="panelEl" class="vclip nodrag nopan nowheel" @dblclick.stop>
    <div v-if="!hasVideo" class="ntp-root vclip-empty">这里还没有视频，先上传一段再剪辑</div>

    <template v-else>
      <VideoClipDock
        v-model:config-open="configOpen"
        :pending="pending"
        :snap="prefs.snap"
        :loop="prefs.loop"
        @cancel="onCancel"
        @confirm="onConfirm"
        @toggle-snap="toggleSnap"
        @toggle-loop="toggleLoop"
      >
        <VideoClipFilm
          :frames="frames"
          :frame-indices="frameIndices"
          :start-pct="startPct"
          :end-pct="endPct"
          :at-left="atLeft"
          :at-right="atRight"
          :is-dragging="isDragging"
          :label-below="labelBelow"
          :length-label="lengthLabel"
          :playhead-pct="playheadPct"
          :range="range"
          :duration="duration"
          @handle-down="onHandleDown"
        />
      </VideoClipDock>

      <VideoClipCaption
        :label-below="labelBelow"
        :caption-left-px="captionLeftPx"
        :length-label="lengthLabel"
      />
    </template>
  </div>
</template>

<style scoped>
/**
 * 视觉与图片裁剪的状态栏同源（用户口径 2026-10-31）：
 * - 外壳 = 主题的 `.ntp-root` 胶囊（白底/深底、发丝边、10px 圆角、阴影都随亮暗主题变）；
 * - 按钮 = shadcn Button + 全局 .mck-toolbar-btn（尺寸/圆角/hover/激活态由全局样式定）；
 * - 只有胶片条本身保持深色 —— 它压的是视频画面，浅色底会把抽出来的帧吃掉。
 * 强调色一律取 --ui-accent，用户换主题色时选区和按钮一起变。
 */
.vclip {
  /* 只保留胶片条这一块的私有色：它必须压黑，才看得清帧和蓝色选区 */
  /* 主题色白名单: 胶片条压视频画面，必须保持黑底才能看清抽帧 */
  --vclip-film: #000;
  /* 胶片条恒定黑底，所以抽帧前的占位也固定用深灰：跟主题走会在暗色下闪出一排浅灰块 */
  /* 主题色白名单: 抽帧前的占位保持深灰，避免暗色主题下闪出浅灰块 */
  --vclip-frame-bg: #181b20;
  /* 主题色白名单: 胶片条内的帧底色同为固定深色 */
  --vclip-frame: #1d2128;
  /* 主题色白名单: 深色胶片条上的分隔线 */
  --vclip-divider: rgb(255 255 255 / 0.12);
  /* 主题色白名单: 选区外的遮罩 */
  --vclip-shade: rgb(0 0 0 / 0.5);
  /* 主题色白名单: 深色胶片条上的强对比文字 */
  --vclip-ink-strong: #fff;
  /* 主题色白名单: 深色胶片条上的手柄线 */
  --vclip-handle-line: rgb(255 255 255 / 0.9);
  /* 主题色白名单: 深色胶片条上的播放头光晕 */
  --vclip-playhead-glow: rgb(255 255 255 / 0.45);
  /* 主题色白名单: 深色胶片条上的时长胶囊底色 */
  --vclip-length-bg: rgb(23 24 27 / 0.94);
  --vclip-accent: var(--ui-accent, #0891b2);
  --vclip-accent-ring: var(--ui-accent, #0891b2);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: 560px;
  max-width: calc(100vw - 48px);
}

.vclip-empty {
  padding: 14px 16px;
  color: var(--ui-ink-dim, #6b7280);
  font-size: 12px;
}

</style>
