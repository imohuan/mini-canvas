# 音频节点

> `@plume-canvas/plugin-node-audio` - v0.1.5

音频节点：波形进度条 + 拖拽 seek + 播放动画.

## 功能说明

@plume-canvas/plugin-node-audio —— 音频节点：波形（主题色进度）+ 拖拽 seek + 播放动画。
**只导出插件本身**。波形计算 / 播放换算 / 浏览器加工 / ops 都是**内部实现**：
别的插件若要协作，走服务与注册场（`ctx.get('audio')` / `ctx.get('doc')`）。
本插件对外的面：
  · 插件：`nodeAudioPlugin`（装配清单里装它即可）
  · 类型：`AUDIO_NODE_TYPE`（= 'audio'，web2api 的底栏动作按它对齐）
  · 配置：模块级 `Config`（内核按名登记进设置面板，无需导出）
/

## 注册项

### 声明的依赖 (export const inject)

- `'doc'`

## 安装

```bash
npm i @plume-canvas/plugin-node-audio
```

本插件随 plume-canvas 主程序自动安装；也可通过插件管理页手动装卸。
