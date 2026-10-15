<script setup>
import { data } from '../../.vitepress/data/parsed.data.ts'
</script>

# 插件解析

这一组回答的问题是：**这个插件到底给画布加了什么能力，我该怎么用。**

每篇是"一个插件 = 一个总览页 + 每一类能力一页"的结构（和[默认主题组件](/plugins/theme-components)同一套做法）：

- **总览** —— 身份与依赖、全部落点表（每行链到对应子页）、注意事项；
- **子页** —— 服务（每个函数的参数/返回值/怎么调）、节点类型、命令、底栏动作、`ui` 目录组件、设置项……

左栏「插件」下按插件一一罗列。下面这份清单是**构建时扫目录生成**的，加一个插件目录就自动多一行。

## 已解析的插件

<table>
  <thead>
    <tr><th>插件</th><th>子页</th></tr>
  </thead>
  <tbody>
    <tr v-for="p in data" :key="p.dir">
      <td><a :href="p.link">{{ p.title }}</a></td>
      <td>
        <template v-for="(s, i) in p.pages" :key="s.link">
          <span v-if="i > 0"> · </span><a :href="s.link">{{ s.text }}</a>
        </template>
      </td>
    </tr>
  </tbody>
</table>

> 解析由**源码**写成，不是照抄旧文档。插件改了要同步改对应页。

## 在画布里亲眼见这些组件

装了 **组件展厅**（theme-gallery，**可装卸件**：到「设置 → 插件 → 本地清单」点安装）的画布，
左下角有一个"组件展厅"按钮 —— 点开是一个浮层，把默认主题的每个组件**真的渲染出来**。
源码 `packages/plugins/plugin-theme-gallery/`。

