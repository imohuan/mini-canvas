/**
 * 回填解析 —— 把转录里的 **XML 引用元素** 还原成输入框的 chip 标签。
 *
 * 为什么单测：用户报过「编辑回填后标签变成一串文字」。根因就在这个函数 ——
 * 它原来只认旧格式 `@[kind:name](value)`，新格式 <ref … /> 没被解析，原样落成文字。
 */
import { describe, expect, it } from "vitest"
import { parsePlainTextToContent } from "../useEditor.ts"
import { registeredItem } from "../useEditor.ts"

const resourceNodes = (text: string) =>
  parsePlainTextToContent(text, undefined).filter((n) => n.type && n.type.name === "resource")

describe("parsePlainTextToContent：XML 引用元素 → chip", () => {
  it("资产：还原成 resource 节点，refValue 是本机绝对路径", () => {
    const xml = '<ref type="asset" name="图片 18.png" path="D:/a/b.png" />'
    const nodes = resourceNodes(xml)
    expect(nodes).toHaveLength(1)
    expect(nodes[0].attrs.refKind).toBe("asset")
    expect(nodes[0].attrs.refValue).toBe("D:/a/b.png")
    expect(nodes[0].attrs.name).toBe("图片 18.png")
  })

  it("节点：canvasId + nodeId 拼回定位", () => {
    const nodes = resourceNodes('<ref type="node" name="花海" canvasId="c1" nodeId="35" />')
    expect(nodes[0].attrs.refKind).toBe("node")
    expect(nodes[0].attrs.refValue).toBe("c1#35")
  })

  it("MCP：无 path 也还原（不依赖 resolver）", () => {
    const nodes = resourceNodes('<ref type="mcp" name="canvas" />')
    expect(nodes).toHaveLength(1)
    expect(nodes[0].attrs.name).toBe("canvas")
  })

  it("标记与文字混排：文字保留、标记变 chip", () => {
    const content = parsePlainTextToContent('<ref type="mcp" name="canvas" /> 介绍一下这个', undefined)
    const kinds = content.map((n) => (n.type ? n.type.name : "text"))
    expect(kinds).toContain("resource")
    expect(content.map((n) => n.text || "").join("")).toContain("介绍一下这个")
  })

  it("多个标记都还原", () => {
    const nodes = resourceNodes('<ref type="mcp" name="a" /> <ref type="asset" name="b" path="/x.png" />')
    expect(nodes).toHaveLength(2)
  })

  /**
   * 用户报过：回填出来的标签是「下划线文字」样式，与右键插入的标签（带图标 chip）不一样。
   * 根因：item 没带 renderEditor，toDOM 走了默认分支。这里钉住「一定有 renderEditor」。
   */
  it("回填的每一项都带 renderEditor（否则退化成 @名字 下划线样式）", () => {
    for (const xml of [
      '<ref type="asset" name="图.png" path="/x.png" />',
      '<ref type="node" name="节点" canvasId="c" nodeId="1" />',
      '<ref type="skill" name="archify" path="/s/SKILL.md" />',
      '<ref type="mcp" name="canvas" />',
    ]) {
      const nodes = resourceNodes(xml)
      expect(nodes, xml).toHaveLength(1)
      // toDOM 从注册表按 id 取 item —— 注册表必须存着一份带 renderEditor 的
      const item = registeredItem(nodes[0].attrs.id)
      expect(typeof item?.renderEditor, xml).toBe("function")
    }
  })
})
