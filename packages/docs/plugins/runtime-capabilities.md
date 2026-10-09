# 运行时能力

静态声明只说明「这个插件是什么」。插件**真正注册了什么**只有后台知道，
所以这一页从后台接口读取，边看边刷新。

<RuntimeCapabilities endpoint="/api/plugins/capabilities" />

::: info 接口还没通？
没通的时候这一页只会显示一句提示，不会报错。等后台把接口接上，内容会自动出现。
接口形状见 RuntimeCapabilities.vue 顶部注释。
:::

## 这页以后能长成什么样

- 每装一个插件，这里立刻多出它注册的槽位、路由、定时任务、MCP 工具、Agent 中间件。
- 给每一行配一个「打开看看」，点开就是对应的组件预览（见 [组件预览](/preview/)）。

## 后台要怎么配合

按约定提供 GET /api/plugins/capabilities，返回：

```json
{
  "groups": [
    {
      "id": "routes",
      "label": "路由",
      "description": "插件往后台加的接口",
      "items": [{ "plugin": "showcase", "name": "GET /api/showcase/hello" }]
    }
  ]
}
```

分组和条目全部来自后台，文档页不写死 —— 加一个能力不用改文档。
