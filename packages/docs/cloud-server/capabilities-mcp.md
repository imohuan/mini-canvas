# 能力详解 · mcp：给 AI 加工具

**一句话定位**：`ctx.mcp.tool(def)` 让插件给 AI 注册一个可调用的 MCP 工具 —— AI 客户端连上 cloud-server 的 `/mcp` 就能用；插件卸载，工具即摘。

## 这篇能让你做什么

- 给 AI 加一个「查天气」「算配额」「调你自己的业务」的工具；
- 明白参数为什么是简表而不是 zod；
- 知道怎么验证工具真的出现在 AI 客户端里。

## 完整代码

```js
// 文件：<数据根>/server-plugins/demo-mcp.js
// 格式：自包含单文件后台插件
// 作用：注册一个 AI 可调用的加法工具 + 一条查看路由

export const name = 'demo-mcp'

export function apply(ctx) {
  ctx.mcp.tool({
    name: 'demo.add',                              // ① 工具名：建议「插件名.动作」防撞名
    description: '把两个数相加（demo 插件注册的演示工具）',   // ② 写好这句 AI 才知道何时用
    input: { a: 'number', b: 'number' },            // ③ 参数简表：参数名 → 类型
    required: ['a', 'b'],                           // ④ 必填参数（缺省全可选）
    handler: (args) => ({ sum: args.a + args.b }),  // ⑤ 收校验后的参数，返回可 JSON 化的值
  });

  // 顺手给运维一条查询路由（不是 MCP，普通 HTTP）
  ctx.routes.get('/api/demo-mcp/status', (c) => c.json({ ok: true, tool: 'demo.add' }));
}
```

验证：服务启动后，把 `http://127.0.0.1:8865/mcp` 配给 AI 客户端（如 Claude Desktop、Cursor），工具清单里会出现 `demo.add`；也可以 `npx mini-canvas-cloud list-tools` 看内置工具（插件注册的在运行期动态合入）。

## 每一步在干什么

- **③ 参数为什么是简表**：外挂插件是 data: URL 装载的**单文件**，引不了 zod 依赖（data: URL 没有相对解析）。所以框架收一个「参数名 → 类型」的朴素简表（只支持 `string` / `number` / `boolean` 三种），再由宿主翻译成 MCP SDK 认识的 zod schema。绝大多数工具够用；复杂 schema 走宿主内置工具。
- **② description 是写给 AI 看的**：AI 靠这句话决定什么时候调你的工具。写「做什么、什么时候用、参数含义」，别写「强大灵活」。
- **① 工具名建议带插件前缀**：注册场（`server/mcp-tool`）按 name 为 key，撞名会互相覆盖。统一 `插件名.动作` 形式（showcase.add、demo.add）。
- **⑤ 卸载即摘**：工具登记进注册场、条目归注册方插件；MCP server 是**每请求新建**的（stateless），每次建时现读注册场 —— 所以卸载插件后，AI 客户端下一次请求就拿不到这个工具了。

## 源码出处

| 这篇里的说法 | 真实文件 | 真实行为 |
| --- | --- | --- |
| 简表类型限制 | `packages/cloud-server/src/serverFramework/mcp.ts` 的 `McpParamType` | `'string' | 'number' | 'boolean'` 三种 |
| 工具声明形状 | 同上 `McpToolDef` | name / description / input? / required? / handler |
| 注册落点 | 同上 `createMcpRegistrar` | `field.add(def.name, def, { id: scopeName })` |
| 为什么不用 zod | 同上文件头「形状为什么这么简单」 | data: URL 插件引不了依赖，收简表由宿主翻译 |
| 每请求现读注册场 | 同上文件头「回收」段 + `listPluginMcpTools` | MCP server stateless，建时现取最新集合 |
| 内置工具清单 | `packages/cloud-server/src/mcp/server.ts` 的 `TOOL_LIST` | CLI `list-tools` 打印的就是它 |

## 常见坑

1. **input 类型写了别的**：只认 string / number / boolean，写 object / array 不会被校验也不会报 schema —— 参数实际是简表声明的形状校验，别依赖复杂校验。
2. **工具名撞名**：注册场按 name 为 key，同名互相覆盖。带插件前缀。
3. **handler 返回 Promise**：可以 —— 框架 await 它（AI 调用本来就是异步的）。
4. **以为卸载后 AI 还能调**：MCP server 每请求现读注册场，卸载即摘。要下线工具就卸插件，或改 handler 内部逻辑。
