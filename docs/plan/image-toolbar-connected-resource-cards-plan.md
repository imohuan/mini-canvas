# 计划：图片节点底部工具栏展示「已连接资源卡片」

## 任务概述
实现 `packages/canvas-core/src/nodes/image/ImageBottomToolbar.vue:304` 处的 TODO：
> 根据输入端口链接到的资源，在输入框上方展示。只显示图片或视频资源，每个资源做成一个正方形卡片。

## 现状梳理
- `ImageBottomToolbar.vue` 通过 `useUpstreamResources(props.id)` 拿到当前节点输入端口（target handle）连到的所有上游资源。
- `useUpstreamResources.ts`（packages/canvas-core/src/composables/useUpstreamResources.ts）目前只识别两类：
  - **image**：上游节点有 `imageUrl`/`panoUrl` 的（nodeType 为 image/panorama 等）。
  - **text**：上游 nodeType === 'text' 的节点。
  - **video 目前被完全跳过**（视频节点字段是 `videoUrl`/`videoName`、nodeType='video'）。
- 工具栏现有 `connectedImages` computed 把 `UpstreamResource[]` 映射成给 ProseMirror 编辑器 `@` 菜单用的 `ResourceItem[]`（文本走 value 分支、图片走 url 分支 + onClick 全屏预览）。
- 需求点：在 `.input-area`（输入框上方，即第 304 行位置）展示一横排正方形缩略卡片，内容 = 输入端口连到的 **图片 + 视频** 资源（文本不占卡片位，仍保留在 @ 菜单里）。

## 要改的文件
1. `packages/canvas-core/src/composables/useUpstreamResources.ts` — 给资源增加 `video` 类型识别。
2. `packages/canvas-core/src/nodes/image/ImageBottomToolbar.vue` — 新增一个仅含 image+video 的卡片列表 computed + 在 `.input-area` 顶部渲染卡片行 + 样式。

## 详细步骤

### Step 1 扩展 useUpstreamResources 支持 video
- `UpstreamResource.kind` 增加 `'video'`。
- 在识别逻辑里，当上游 `nodeType === 'video'` 或存在 `videoUrl` 时，推送 `{ kind:'video', name: data.videoName || label || '视频', url: data.videoUrl, value:'' }`，并标记 seen 去重。
- 保持 image / text 行为不变。
- 改完跑该包的 lint/tsc（若有）确认类型正确。

### Step 2 ImageBottomToolbar.vue：卡片数据
- 新增 computed（从 `upstreamResources` 过滤出 kind === 'image' | 'video'），得到「连接的媒体资源卡」数组，每项含：
  - `kind`（'image' | 'video'）
  - `url`
  - `name`
- 由于是只读展示、不参与 @ 序列化，不复用 ResourceItem，用轻量结构即可（可复用现有 viewer 全屏预览逻辑）。

### Step 3 模板渲染卡片行
- 在 `.input-area` 内、`.editor-wrapper` 之前插入卡片容器（有媒体资源时显示）：
  - 每个资源一个正方形卡片，`object-fit: cover` 缩略图。
  - 视频卡右上角加小播放角标（区分视频）。
  - 无 url 或加载失败给占位。
  - 卡片数量多时横向可滚动。
- 点击卡片行为：图片/视频 → 复用现有全屏预览逻辑（图片放大查看、视频弹层播放）。（交互方案见下方待确认问题，默认先做纯展示 + 点击预览。）

### Step 4 样式
- 卡片行高度控制好，避免把紧凑面板（200px）的编辑器挤太狠；放缩略图横排，贴近描述为「每个资源一个正方形卡片」。
- 补齐深色/紧凑场景不影响现有布局。

### Step 5 验证 & 提交
- 手动/浏览器验证：图片上游显示图片卡、视频上游显示带角标的视频卡、文本上游不占卡片位但仍在 @ 菜单。
- 分别 commit（每个 Step 一个原子提交，message 用 `feat:`/`refactor:` 前缀）。

## 待确认问题（已确认）
1. 卡片点击行为 → **点击全屏预览**（图片看图 / 视频播放）。
2. 显示位置 → 就显示在第 304 行注释处、与 `.editor-wrapper` 同级（放其前面，输入区顶部），高 30px、间距 gap-2。

## 落地情况
- useUpstreamResources 增加 video 识别 ✅（commit 9bb2647）
- 卡片行展示（含 @ 菜单 video 分支 + 点击预览）✅（commit 027619a）
- vue-tsc：本改动文件无类型错误；ImageNodePlugin.ts 的 `filterSvg` 未使用报错为**预先存在**（与本次改动无关，line 668 被注释），未擅自改动该文件。

## 风险与注意
- 不动 `connectedImages`（@ 菜单用）现有行为，只新增卡片展示，最小改动。
- 面板固定高 200px，卡片行样式需谨慎，避免编辑器区域被压没。
