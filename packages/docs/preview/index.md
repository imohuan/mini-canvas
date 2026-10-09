# 组件预览台

这一页专门用来试组件。上面嵌的每一个都是**真在跑的组件**，不是图片。

## 内联预览

<ComponentPreview name="DemoCounter" title="示例：计数器" />

<ComponentPreview title="当场传入的组件">
  <p>这里可以放任何能在页面上渲染的内容，比如一个你自己的组件。</p>
</ComponentPreview>

## 整页预览（iframe）

把已经跑起来的应用整页嵌进来。默认指向本地画布应用，没起服务时这里是空白的 —— 这是正常的。

<ComponentPreviewFrame
  title="画布应用（需要本地已启动）"
  src="http://localhost:5288/"
  :height="420"
/>

## 想加自己的组件

见 [怎么预览组件](/guide/component-preview)，往登记表加一条即可。
