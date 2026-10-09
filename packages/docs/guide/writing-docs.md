# 怎么写文档

写文档就是**新建一个 .md 文件**，写点文字，放在对应目录里。就这样。

## 一篇文档的最小样子

下面这几行，存成 guide/hello.md，就是一个新页面：

```md
# 你好

这是正文。可以随便写中文、写表格、写代码。
```

标题层级用 # 、## 、### ，右边会自动生成目录。

## 页面之间怎么跳

用链接。链接写文件路径（不用写 .md 后缀）：

```md
想装插件看[这里](/plugins/)。
```

## 在文档里直接写组件

这是重点之一：MD 文件里可以直接使用 Vue 组件，不用先 import。

```md
# 我的页面

下面直接放一个真实组件：

<ComponentPreview name="DemoCounter" />
```

效果（这里真的在跑）：

<ComponentPreview name="DemoCounter" />

名字 DemoCounter 从哪来？看下一节 [怎么预览组件](/guide/component-preview)。

## 想快速加一个页面

1. 在 packages/docs/guide/ 下新建 xxx.md。
2. 写内容。
3. 想让它在左边菜单出现，就到 .vitepress/config.ts 的 sidebar 里加一行。
