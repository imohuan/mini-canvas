# 视频片段条 Demo

一个独立的小页面，用来演示视频剪辑条：底部铺满视频抽出来的帧，蓝色边框可以拖动选片段，右边的磁铁控制整秒吸附，循环控制区间循环播放。

## 打开

页面本身是单文件，可以直接双击打开：

```
packages/ui/public/video-clip-demo.html
```

浏览器对 `file://` 页面的存储有限制。要保证「刷新后还能继续用」，请用本地服务打开：

```powershell
node docs/demo/video-clip/demo-server.mjs
```

再访问 http://127.0.0.1:5333/

可选参数：`node docs/demo/video-clip/demo-server.mjs 5400` 换端口。

## 怎么用

- 点「选择视频」或把视频拖进画面。
- 视频最多留在本机浏览器的 IndexedDB 里，刷新后自动恢复；片段范围和两个开关存在 localStorage。
- 拖选区左右两端改片段，拖中间整段平移；点胶片空白处跳转播放位置。
- 页面底部可以切换两种样式：原来的「细边」，以及「胶囊」——蓝色圆角框，左右两只蓝色耳朵贴在外侧，可以伸出胶片范围拖动。
- 磁铁亮起：端点吸附整秒。
- 循环亮起：只播放选中片段，到终点回到起点；关闭后播到终点就停。
- 播放时胶片上的白线就是当前时间；按空格也能播放/暂停。
- 拖动选区时时间线会暂时隐藏，松手后重新显示。

## 实现参考

抽帧和区间计算参考了项目里的旧版 `packages/canvas-core/src/nodes/Video/VideoClipToolbar.vue`，以及现行插件里的 `packages/plugins/plugin-node-video/src/VideoClipPanel.vue`。本 demo 不依赖这些包，方便单独打开和修改。
