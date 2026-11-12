# Vue 组件打包为 Web Component 的完整过程

![截图说明](./截图说明.png)

## 1. 项目初始化

创建了独立的打包项目 `prosemirror-editor-bundle`，使用 Vite + pnpm 作为构建工具。

**关键配置：**

- 使用 `vite-plugin-dts` 生成 TypeScript 类型定义
- 配置 library 模式支持多种输出格式

## 2. 第一次尝试：Vue 运行时打包（UMD）

**做法：**

- 将 Vue 组件和 Vue 运行时一起打包成 UMD 格式
- 配置 Vite 的 library 模式，输出 ES 和 UMD 两种格式

**遇到的问题：**

- 重复的 default 导出错误：同时使用了 `export { default }` 和 `export default {}`
- package.json 中 exports 字段的 types 条件位置警告

**解决方案：**

- 删除重复的 `export { default }` 导出
- 将 types 条件放在 import/require 之前

**结果：**

- 成功打包出 412KB 的 ES 模块和 260KB 的 UMD 模块
- 但这种方式仍然依赖 Vue 运行时，不是真正的独立使用

## 3. 第二次尝试：真正的 Web Component

**意识到的问题：**
用户指出 UMD 版本仍然需要引入 Vue 库，不是真正的独立使用。真正的独立应该是原生 Web Component。

**做法：**
创建 `web-component.ts` 文件，使用原生 JavaScript 实现：

- 继承 `HTMLElement` 创建自定义元素类
- 使用 `attachShadow` 创建 Shadow DOM
- 直接使用 ProseMirror API，不依赖 Vue
- 通过 `customElements.define()` 注册自定义元素

**核心实现：**

- Schema 定义：复用原组件的 ProseMirror Schema
- 状态管理：用类的私有属性替代 Vue 的响应式
- 事件处理：用 `CustomEvent` 替代 Vue 的 emit
- 生命周期：用 Web Component 的 `connectedCallback`/`disconnectedCallback` 替代 Vue 的生命周期钩子

## 4. 样式问题

**遇到的问题：**
第一版 Web Component 打包后，页面显示空白，样式完全丢失。

**原因分析：**
Shadow DOM 是隔离的，外部 CSS 文件无法影响 Shadow DOM 内部的元素。

**解决方案：**
将所有样式内联到 Shadow DOM 的 `<style>` 标签中：

- 读取原始 `style.css` 的所有样式规则
- 在 `render()` 方法中创建 `<style>` 元素
- 将样式字符串直接写入 `style.textContent`
- 简化样式选择器（去掉 `.prose-mirror-editor` 前缀，因为已经在 Shadow DOM 内部）

## 5. 构建配置优化

**做法：**
修改 `vite.config.ts` 支持两种构建模式：

- 默认模式：打包 Vue 组件版本（ES + UMD）
- webcomponent 模式：打包 Web Component 版本（IIFE）

**配置关键点：**

- 使用 `mode` 参数区分构建目标
- Web Component 模式不加载 Vue 插件
- 输出格式为 IIFE（立即执行函数），包含所有依赖

**package.json 脚本：**

- `build`: 打包 Vue 组件版本
- `build:standalone`: 打包 Web Component 版本
- `build:all`: 同时打包两个版本

## 6. 最终成果

**生成的文件：**

- `prosemirror-editor.standalone.js` (213KB) - 完全独立的 Web Component
- 无需任何外部依赖，包含 ProseMirror 所有功能

**使用方式：**
只需引入一个 JS 文件，然后使用 `<prosemirror-editor>` 标签，通过原生 DOM API 操作：

- `editor.setValue()` 设置内容
- `editor.setResources()` 设置资源列表
- `editor.addEventListener('change')` 监听变化

## 7. 示例链接问题

**问题：**
示例中使用的 `via.placeholder.com` 和 `w3schools.com` 链接无法访问。

**解决：**
替换为 `picsum.photos` 随机图片服务，提供可访问的示例资源。

## 总结

从 Vue 组件到 Web Component 的关键转变：

1. 从框架依赖到原生 API
2. 从外部样式到内联样式
3. 从 Vue 响应式到原生事件系统
4. 从组件生命周期到 Web Component 生命周期

最大的挑战是 Shadow DOM 的样式隔离问题，解决方案是将所有样式内联化。
