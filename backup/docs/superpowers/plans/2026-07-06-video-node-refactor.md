# 视频节点重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `目标 展示/视频节点重构` 的文档，把视频节点改成自定义 UI，并支持下载、全屏、裁剪、剪辑、截图生成新节点。

**Architecture:** 复用现有图片节点的 overlay 模式和 toolbar 命令注册方式。视频节点自身负责播放 UI、底部剪辑栏和截图；插件命令负责改 `_overlay` 状态、确认后创建新节点。避免新增依赖，真实转码不在本轮做，只保存裁剪/剪辑元数据并生成可继续操作的新视频节点。

**Tech Stack:** Vue 3、@vue-flow/core、canvas-core 插件系统、浏览器 video/canvas API、Playwright UI 验证。

---

## Files

- Modify: `D:/Code/GitTest/canvas-ai/mini-canvas/packages/canvas-core/src/types/CanvasNodeData.ts`
  - 给视频节点补充 `_videoCropRect`、`clipStart`、`clipEnd` 等最少字段。
- Modify: `D:/Code/GitTest/canvas-ai/mini-canvas/packages/canvas-core/src/nodes/Video/VideoNode.vue`
  - 自定义视频 UI、全屏层、截图、裁剪 overlay、剪辑底栏。
- Modify: `D:/Code/GitTest/canvas-ai/mini-canvas/packages/canvas-core/src/nodes/Video/VideoNodePlugin.ts`
  - 注册下载、全屏、裁剪/确认/取消、剪辑/确认/取消等命令。
- Create: `D:/Code/GitTest/canvas-ai/mini-canvas/packages/canvas-core/src/nodes/Video/VideoCropper.vue`
  - 复用图片裁剪交互，改为接收视频尺寸。
- Create: `D:/Code/GitTest/canvas-ai/mini-canvas/packages/canvas-core/src/nodes/Video/VideoClipToolbar.vue`
  - 底部剪辑状态栏。
- Create: `D:/Code/GitTest/canvas-ai/mini-canvas/packages/canvas-core/src/nodes/Video/videoNodeUtils.test.mjs`
  - 不加测试框架，用 node assert 跑纯逻辑测试。
- Create: `D:/Code/GitTest/canvas-ai/mini-canvas/packages/canvas-core/src/nodes/Video/videoNodeUtils.mjs`
  - 放可在 Node 里测试的时间格式、范围限制、节点数据生成逻辑。

## Tasks

### Task 1: 写纯逻辑失败测试

- [ ] 新建 `videoNodeUtils.test.mjs`，断言：时间格式、clip 范围限制、截图图片节点数据、裁剪/剪辑视频节点数据。
- [ ] 运行 `node packages/canvas-core/src/nodes/Video/videoNodeUtils.test.mjs`，预期失败，因为工具文件不存在。

### Task 2: 最小实现纯逻辑工具

- [ ] 新建 `videoNodeUtils.mjs`，只实现测试需要的函数。
- [ ] 运行同一个 node 测试，预期通过。

### Task 3: 改视频节点 UI

- [ ] `VideoNode.vue` 使用 `<video controls=false>`，自己渲染播放按钮、进度条、时间、截图按钮、下载按钮视觉位。
- [ ] 去掉中间播放按钮白底阴影。
- [ ] 支持 fullscreen 状态，通过 window 事件触发。

### Task 4: 裁剪和剪辑 overlay

- [ ] 增加 `VideoCropper.vue`，复用 ImageCropper 的交互和样式。
- [ ] 增加 `VideoClipToolbar.vue`，用底部栏选择 start/end，确认后触发命令。
- [ ] `VideoNode.vue` 根据 `_overlay._cropMode/_clipMode` 显示对应 UI。

### Task 5: 插件命令生成新节点

- [ ] `VideoNodePlugin.ts` 注册下载、全屏、裁剪、剪辑、确认、取消、截图命令。
- [ ] 截图用 canvas 抽当前帧，生成 image 节点。
- [ ] 裁剪/剪辑确认后生成 video 节点，保存元数据，不做浏览器端转码。

### Task 6: 验证

- [ ] 运行 `node packages/canvas-core/src/nodes/Video/videoNodeUtils.test.mjs`。
- [ ] 运行 `pnpm build`。
- [ ] 启动 Vite，用 Playwright 拖入/注入视频节点，检查：自定义控件出现、播放按钮无阴影、toolbar 命令可打开裁剪/剪辑/全屏、截图后新增图片节点。
