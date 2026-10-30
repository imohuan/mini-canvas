# SplitPane 分割面板

顶部预览区只有一个可拖的默认形态，用来随手调参数；下面按用法分开摆，每段都是能直接跑的完整配置。

## 左右分栏 · 均分

最常用的一档：两栏各占一半，两边都留最小宽度，谁也不会被拖没。双击分隔线回到 50%。

@@VUE@@
<script setup lang="ts">
import { SplitPane } from '@mini-canvas/ui-kit'
</script>

<template>
  <div class="sp-frame">
    <SplitPane :initial="0.5" :min-left="140" :min-right="140">
      <template #left>
        <div class="sp-pane">
          <span class="sp-pane__eyebrow">资源列表</span>
          <strong>左边内容</strong>
          <span class="sp-pane__hint">默认 50%，两边都不小于 140px</span>
        </div>
      </template>
      <template #right>
        <div class="sp-pane sp-pane--main">
          <span class="sp-pane__eyebrow">预览</span>
          <strong>右边内容</strong>
          <span class="sp-pane__hint">拖动中间细线改变比例</span>
        </div>
      </template>
    </SplitPane>
  </div>
</template>

<style scoped>
.sp-frame {
  height: 200px;
  overflow: hidden;
  border: 1px solid var(--mck-line);
  border-radius: 12px;
  background: var(--mck-panel);
}
.sp-frame :deep(.mck-split) { height: 100%; }
.sp-pane {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 3px;
  height: 100%;
  padding: 12px 16px;
  overflow: hidden;
}
.sp-pane--main { background: var(--mck-panel-soft); }
.sp-pane__eyebrow {
  color: var(--mck-ink-muted);
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.sp-pane strong { font-size: 13px; font-weight: 600; }
.sp-pane__hint { color: var(--mck-ink-muted); font-size: 11px; line-height: 1.6; }
</style>
@@ENDVUE@@

## 主次分栏 · 左侧更宽

左主右辅是编辑器最常见的样子：初始 70%，左侧最小 240px、右侧最小 160px。把分隔线往右拖到底，右侧会收成一栏，左侧占满。

@@VUE@@
<script setup lang="ts">
import { SplitPane } from '@mini-canvas/ui-kit'
</script>

<template>
  <div class="sp-frame">
    <SplitPane :initial="0.7" :min-left="240" :min-right="160">
      <template #left>
        <div class="sp-pane">
          <span class="sp-pane__eyebrow">画布</span>
          <strong>主区域</strong>
          <span class="sp-pane__hint">初始 70%，最小 240px</span>
        </div>
      </template>
      <template #right>
        <div class="sp-pane sp-pane--main">
          <span class="sp-pane__eyebrow">属性</span>
          <strong>侧栏</strong>
          <span class="sp-pane__hint">最小 160px，越界后收成一栏</span>
        </div>
      </template>
    </SplitPane>
  </div>
</template>

<style scoped>
.sp-frame {
  height: 200px;
  overflow: hidden;
  border: 1px solid var(--mck-line);
  border-radius: 12px;
  background: var(--mck-panel);
}
.sp-frame :deep(.mck-split) { height: 100%; }
.sp-pane {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 3px;
  height: 100%;
  padding: 12px 16px;
  overflow: hidden;
}
.sp-pane--main { background: var(--mck-panel-soft); }
.sp-pane__eyebrow {
  color: var(--mck-ink-muted);
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.sp-pane strong { font-size: 13px; font-weight: 600; }
.sp-pane__hint { color: var(--mck-ink-muted); font-size: 11px; line-height: 1.6; }
</style>
@@ENDVUE@@

## 上下分栏 · 纵向

`direction="vertical"` 把分割线转成横的，用上下拖动调高度。适合“上面预览、下面日志”这种堆叠布局。

@@VUE@@
<script setup lang="ts">
import { SplitPane } from '@mini-canvas/ui-kit'
</script>

<template>
  <div class="sp-frame">
    <SplitPane direction="vertical" :initial="0.6" :min-left="120" :min-right="80">
      <template #left>
        <div class="sp-pane">
          <span class="sp-pane__eyebrow">上方</span>
          <strong>预览区</strong>
          <span class="sp-pane__hint">初始 60%，最小 120px</span>
        </div>
      </template>
      <template #right>
        <div class="sp-pane sp-pane--main">
          <span class="sp-pane__eyebrow">下方</span>
          <strong>日志 / 文档</strong>
          <span class="sp-pane__hint">最小 80px，方向键上下微调</span>
        </div>
      </template>
    </SplitPane>
  </div>
</template>

<style scoped>
.sp-frame {
  height: 260px;
  overflow: hidden;
  border: 1px solid var(--mck-line);
  border-radius: 12px;
  background: var(--mck-panel);
}
.sp-frame :deep(.mck-split) { height: 100%; }
.sp-pane {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 3px;
  height: 100%;
  padding: 12px 16px;
  overflow: hidden;
}
.sp-pane--main { background: var(--mck-panel-soft); }
.sp-pane__eyebrow {
  color: var(--mck-ink-muted);
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.sp-pane strong { font-size: 13px; font-weight: 600; }
.sp-pane__hint { color: var(--mck-ink-muted); font-size: 11px; line-height: 1.6; }
</style>
@@ENDVUE@@

## 吸边 · 拖到最小尺寸就收成一栏

`snap` 是“越界多少像素后收边”。这里设成 24px，把分隔线拖过左边界 24px，左栏立刻收成 0，右栏占满；往回拖一点就恢复。

@@VUE@@
<script setup lang="ts">
import { SplitPane } from '@mini-canvas/ui-kit'
</script>

<template>
  <div class="sp-frame">
    <SplitPane :initial="0.5" :min-left="160" :min-right="160" :snap="24">
      <template #left>
        <div class="sp-pane">
          <span class="sp-pane__eyebrow">可收起</span>
          <strong>左栏</strong>
          <span class="sp-pane__hint">越界 24px 后收成 0</span>
        </div>
      </template>
      <template #right>
        <div class="sp-pane sp-pane--main">
          <span class="sp-pane__eyebrow">会占满</span>
          <strong>右栏</strong>
          <span class="sp-pane__hint">两边都能被吸走</span>
        </div>
      </template>
    </SplitPane>
  </div>
</template>

<style scoped>
.sp-frame {
  height: 200px;
  overflow: hidden;
  border: 1px solid var(--mck-line);
  border-radius: 12px;
  background: var(--mck-panel);
}
.sp-frame :deep(.mck-split) { height: 100%; }
.sp-pane {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 3px;
  height: 100%;
  padding: 12px 16px;
  overflow: hidden;
}
.sp-pane--main { background: var(--mck-panel-soft); }
.sp-pane__eyebrow {
  color: var(--mck-ink-muted);
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.sp-pane strong { font-size: 13px; font-weight: 600; }
.sp-pane__hint { color: var(--mck-ink-muted); font-size: 11px; line-height: 1.6; }
</style>
@@ENDVUE@@

## 嵌套 · 分栏里再分栏

外层左右、内层上下，两层都能单独拖，互不干扰。面板里的 `SplitPane` 会自动填满父级，不会被内容撑高。

@@VUE@@
<script setup lang="ts">
import { SplitPane } from '@mini-canvas/ui-kit'
</script>

<template>
  <div class="sp-frame sp-frame--tall">
    <SplitPane :initial="0.35" :min-left="140" :min-right="320">
      <template #left>
        <div class="sp-pane sp-pane--nested">
          <span class="sp-pane__eyebrow">侧栏</span>
          <strong>文件树</strong>
        </div>
      </template>
      <template #right>
        <SplitPane direction="vertical" :initial="0.6" :min-left="100" :min-right="80">
          <template #left>
            <div class="sp-pane">
              <span class="sp-pane__eyebrow">上</span>
              <strong>编辑区</strong>
            </div>
          </template>
          <template #right>
            <div class="sp-pane sp-pane--main">
              <span class="sp-pane__eyebrow">下</span>
              <strong>输出面板</strong>
            </div>
          </template>
        </SplitPane>
      </template>
    </SplitPane>
  </div>
</template>

<style scoped>
.sp-frame {
  height: 200px;
  overflow: hidden;
  border: 1px solid var(--mck-line);
  border-radius: 12px;
  background: var(--mck-panel);
}
.sp-frame--tall { height: 300px; }
.sp-frame :deep(.mck-split) { height: 100%; }
.sp-pane {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 3px;
  height: 100%;
  padding: 12px 16px;
  overflow: hidden;
}
.sp-pane--main { background: var(--mck-panel-soft); }
.sp-pane--nested { background: var(--mck-panel-soft); }
.sp-pane__eyebrow {
  color: var(--mck-ink-muted);
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.sp-pane strong { font-size: 13px; font-weight: 600; }
.sp-pane__hint { color: var(--mck-ink-muted); font-size: 11px; line-height: 1.6; }
</style>
@@ENDVUE@@

## 键盘操作

分隔线可以 Tab 聚焦：方向键每次移动 16px，Home 回到初始比例。

| 操作 | 结果 |
| --- | --- |
| 拖动分隔线 | 实时跟手，两栏都不小于最小值 |
| 越过最小值 + snap | 对应栏收成 0，另一栏占满 |
| 双击分隔线 | 回到 initial 比例 |
| 方向键 | 左右 / 上下键每次 16px |
| Home | 回到初始比例 |

| 属性 | 默认 | 说明 |
| --- | --- | --- |
| initial | 0.5 | 初始比例，0~1 |
| minLeft / minRight | 180 | 两栏最小尺寸，px |
| snap | 56 | 越过最小值多少 px 后吸边 |
| direction | horizontal | horizontal（左右）/ vertical（上下） |
| heightClass | 无 | 透传到根节点的类名 |

> 组件本身按内容高度自适应。要固定高度，像上面示例一样给外层加高度，再让 `.mck-split` 撑满即可。

