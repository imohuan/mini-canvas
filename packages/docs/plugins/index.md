<script setup>
import { data } from '../.vitepress/data/plugins.data.ts'
</script>

# 插件列表

这一分类回答两个问题：**这台画布上装了哪些插件**、**每个插件是什么**。

## 清单与快照

| 页面 | 内容 |
| --- | --- |
| 插件总览（本页，下方表格） | 全部插件的声明（构建时自动扫出，装新插件自动多一行） |
| [活快照（这台画布）](/plugins/live) | **运行中画布的真实注册情况**：谁注册了什么、提供了哪些服务（真数据） |

## 全部插件的声明

下面这份**不是手写的** —— 构建时扫每个插件的 package.json，
所以装一个新插件，这里自动多一行。

<PluginCapabilityTable :plugins="data.plugins" />

### 字段说明

| 标记 | 意思 |
| --- | --- |
| 自带 | 跟着应用一起启动，用户卸不掉 |
| 可安装 | 用户可以在「插件管理」里自己装、自己卸 |
| 有后台 | 这个插件还有一半跑在后台 |
| 独立产物 | 有单独的产物文件，能经插件管理从清单加载 |
| 权限 | 后台插件声明的权限 |

## 核心插件详解

| 页面 | 讲什么 |
| --- | --- |
| [默认主题 theme-default](/plugins/theme-default) | 节点/连线/背景长什么样；怎么换皮 |
| [渲染宿主 canvas-render](/plugins/canvas-render) | 画布怎么被装配起来；它注入的三件服务 |

## 前后端对接插件

这两个插件负责把画布连上 cloud-server：

| 页面 | 讲什么 |
| --- | --- |
| [Agent 插件](/cloud-server/bridge-agent) | 画布内 AI 对话：会话/流式回答/引用节点/审批 |
| [Cloud Client 插件](/cloud-server/bridge-cloud-client) | 存档同步/动作清单/生成任务/历史（一行界面都不画的数据桥） |
