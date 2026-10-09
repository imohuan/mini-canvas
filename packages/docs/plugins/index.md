<script setup>
import { data } from '../.vitepress/data/plugins.data.ts'
</script>

# 插件功能

下面是本仓库里所有插件**声明的样子**。这份列表不是手写的 ——
它在构建时扫每个插件的 package.json，所以**装一个新插件，这里自动多一项**。

<PluginCapabilityTable :plugins="data.plugins" />

::: tip 想看「真正注册了什么」
上面是**静态声明**（插件叫什么、有没有前端半/后台半、要什么权限）。
插件在运行期真正注册的能力（槽位 / 路由 / 存储 / 定时 / MCP / Agent）
要到 [运行时能力](/plugins/runtime-capabilities) 看。
:::

## 字段说明

| 标记 | 意思 |
| --- | --- |
| 自带 | 跟着应用一起启动，用户卸不掉 |
| 可安装 | 用户可以在「插件管理」里自己装、自己卸 |
| 有后台 | 这个插件还有一半跑在后台（外挂产物，或内置的后台半） |
| 独立产物 | 有单独的产物文件，能经插件管理从清单加载 |
| 权限 | 后台插件声明的权限（如 net、store） |

## 怎么加一行

新插件的 package.json 里声明这两个字段，它就会自动出现在上面：

```json
{
  "miniCanvas": {
    "title": "我的插件",
    "description": "一句话说明它是干什么的",
    "pluginName": "my-plugin",
    "installable": true
  }
}
```

自带插件写 "builtin": true。
