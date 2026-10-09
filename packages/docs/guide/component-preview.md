# 怎么预览组件

文档里能跑**真实的 Vue 组件**。有两种方式，按组件能不能单独跑选。

## 方式一：直接内联（组件能单独跑）

用 ComponentPreview。两种写法都能用：

**写法 A：按名字取**（先在登记表里登记，页面写名字就行）

```md
<ComponentPreview name="DemoCounter" />
```

<ComponentPreview name="DemoCounter" />

**写法 B：当场塞组件**（本页用 script setup 定义好，直接放进去）

```md
<ComponentPreview title="我的组件">
  <MyComp />
</ComponentPreview>
```

### 名字从哪来：登记表

打开 .vitepress/theme/preview-registry.ts，加一条：

```ts
import MyPanel from '@mini-canvas/plugin-xxx/src/components/MyPanel.vue'

export const previewRegistry = {
  MyPanel: {
    component: MyPanel,
    title: '我的面板',
    description: '说明文字',
  },
}
```

登记之后，任何 MD 页面写 <ComponentPreview name="MyPanel" /> 都能打开它 ——
这也正是「插件页里点开看这个插件注册的 UI」的实现方式。

## 方式二：整页 iframe（组件要完整宿主才能跑）

有些界面（比如画布本体）离不开整个应用。这种用 ComponentPreviewFrame 把跑起来的页面嵌进来：

```md
<ComponentPreviewFrame
  title="画布应用"
  src="http://localhost:5288/"
  :height="520"
/>
```

src 指向一个能访问的地址；height 是预览区高度（像素）。

## 用哪种？

| 情况 | 用哪个 |
| --- | --- |
| 组件自己能渲染、不依赖画布上下文 | ComponentPreview |
| 必须整个应用跑起来才有画面 | ComponentPreviewFrame |

## 注意事项

- 内联预览跑在浏览器里，本页已经用 ClientOnly 包好，构建时不会报「没有 document」。
- 如果预览区是空的，先看是不是组件拿不到它需要的 ctx —— 那就改用 iframe 方式。
