# Agent 引用标记与模式提示词（设计 / 计划）

> 2026-10-05。起因：用户指出当前「技能引用 = 把 SKILL.md 全文贴进每一条消息」不可取——
> 引用几次上下文就爆、内容完全重复。改成「只给钥匙、不给内容」的**引用标记**，
> 并把「全能创作 / 剧本创编」从装饰开关变成**两套系统提示词**。

## 一、要解决的问题

1. **引用方式错了**：`buildUserMessages` 把 `skills:[…]` 对应的 SKILL.md 全文拼进 `[use_skills]` 前缀块。
   同一技能引用 N 次 = 贴 N 遍全文。
2. **引用没有单一真相**：技能/MCP 走「特殊属性」，标签序列化成 `@名字 `，删掉标签引用也不失效。
3. **模式下拉是死开关**：`genMode`（全能创作/剧本创编）只在本地状态里，从不发给后端，也不影响任何行为。
4. **节点不能被 @**：@ 菜单只有技能/MCP。

## 二、引用标记（唯一格式）

输入框里始终是**一段纯文本**，引用就是文本里的标记：

```
@[skill:archify](/abs/path/skills/archify/SKILL.md)   技能（带说明书路径）
@[mcp:smart]                                           MCP 服务（无地址）
@[node:角色立绘](default#n_12)                          节点（画布 id # 节点 id）
```

- **纯模块**：`prosemirror-editor-bundle/src/referenceMarkup.ts`（格式 + 解析 + 编解码，零 DOM/Vue，11 条测试）。
- 发送只发 `{ text, provider, modelId, images }`；**不再发** `skills` / `mcpServers` 字段，
  由后端从正文解析。删掉标记 → 引用当场消失。

## 三、后台转化（只给钥匙，不给内容）

后端解析正文里的标记，按 kind 分流：

| kind | 后端动作 |
|------|----------|
| skill | 不贴正文。只写一句「本技能生效，说明在 `<路径>`，需要时自己 `read_file`」。系统能读本地文件——懒读。 |
| mcp | 收敛本次要连的服务（写进 `prefs.mcpServers`，走既有的 `subsetMcp` 临时过滤）。 |
| node | 不贴内容。给出**画布 id + 节点 id**，引导模型用**内置画布 MCP** 自己去查。读取工具先留接口（用户后台在更新，`canvas.get` 现在可拉全量）。 |

**内置画布 MCP**：cloud-server 启动时把自身的画布 MCP 端点写进 Agent 的 `system_config.yaml`
（默认携带、用户零配置）。当前已配置的 `smart` 保留。

## 四、编辑器改动（prosemirror-editor-bundle）

1. `ResourceItem` 增加 `ref?: { kind; name; value? }`；`getPlainText()` 对带 `ref` 的标签输出标记文本（不再是 `@名字`）。
2. schema 的 `resource` 节点增加 `refKind` / `refValue` 两个可选 attrs；`toDOM` 原样透传给 `data-*`。
3. @ 菜单：查询词实时过滤（已有），**显示前 5 条**（新增上限）。
4. 标签可点：`onClick` 已支持；节点标签用它聚焦画布（已有 `viewport.setCenter`）。

## 五、模式提示词（两套，后台 KV 存）

- 存储：KV `config` 域，key `agent-prompts`，值 = `PromptSet[]`（用现成的 KV/storeAdapter，与设置同一条路）。
- 结构：`{ id, name, text, builtin? }`。
- 规则：两个默认（全能创作 / 剧本创编）`builtin: true`，**不可删**；用户自建可增删改查。
- 发送：按当前模式把该模式的 `text` 作为**系统提示词**发给后端（后端不为「模式」新增概念）。
- 设置页：新增「系统提示词」列表页（改名/编辑/删除/新增；内置项隐藏删除按钮）。

## 六、改动清单（已实现）

| 文件 | 改动 |
|------|------|
| `prosemirror-editor-bundle/src/referenceMarkup.ts` | 新增（已完成 + 11 测试） |
| `prosemirror-editor-bundle/src/types.ts` | `ResourceItem.ref` |
| `prosemirror-editor-bundle/src/mentionFilter.ts` | 新增（前 5 条纯函数 + 5 测试） |
| `prosemirror-editor-bundle/src/useEditor.ts` | attrs、getPlainText/剪贴板输出标记、组合正则反序列化、前 5 条 |
| `plugin-agent/src/agentResources.ts` | 技能/MCP 带 `ref`；新增 `nodeResources` |
| `plugin-agent/src/components/AgentConversation.vue` | 节点 @ 候选（订阅 doc）+ 点标签聚焦 + 模式接后台清单 |
| `plugin-agent/src/agentService.ts` | 去掉 skills/mcpServers 发送；提示词列表 CRUD；模式=会话级 |
| `plugin-agent/src/components/settings/PromptPage.vue` | 改成列表 CRUD（内置不可删） |
| `cloud-server/src/agent/referenceMarkup.ts` | 新增（后端侧解析 + 引导块，独立一份） |
| `cloud-server/src/agent/runtime.ts` | buildUserMessages 只给引导块（懒读技能/引导查节点）；转录存可读文本 |
| `cloud-server/src/agent/config.ts` | 提示词 KV 读写 + 内置画布 MCP 自注册 |
| `cloud-server/src/routes/agent.ts` | `GET/PUT /api/agent/prompts` |
| `cloud-server/src/server.ts` | 启动时把画布 MCP 写进 Agent 清单（`builtinCanvasMcp` 开关） |

## 六·一、验证结果（2026-10-05）

- `prosemirror-editor-bundle`：16/16（referenceMarkup 11 + mentionFilter 5）、`vue-tsc` 干净。
- `plugin-agent`：46/46、`tsc` 干净。
- `cloud-server`：327/327（含新增 referenceMarkup 9 + agentPrompts 6）、`tsc` 干净。
- `packages/ui`：83/83。
- 浏览器端到端（`packages/ui/e2e/reference-probe.mjs`）：@ 菜单出现「节点」分组、模式胶囊读到后台
  「全能创作」。
- 真服务（`cloud-server serve`，隔离数据目录）：`system_config.yaml` 自动多出 `canvas` 服务
  （`http://127.0.0.1:<port>/mcp`）；`GET /api/agent/prompts` 返回两条内置。

## 六·二、留的接口（用户后台在更新）

节点读取没有新增工具。现在的口径是「标记里给画布 id + 节点 id，让模型用画布 MCP 自己去查」，
当前画布 MCP 的 `canvas.get` 可拉全量；等后台出了「按 id 取单节点」的工具，引导语不用改
（它只说“用画布 MCP 查”，不绑具体工具名）。

## 八、code review 结论与修复（2026-10-05）

按 `code-review` 技能跑了两轴并行审查（Standards / Spec）。

**Spec 轴抓到的真 bug（已修）**：
1. `useEditor.insertResource` 建节点时没写 `refKind/refValue` —— 「右键 → 引用到 Agent」
   走的正是这个入口，标签会退化成 `@名字`，后端解析不出引用。
2. 画布 id 不一致：`agentService` 里会话 / 消息恒用常量 `CANVAS_ID='default'`，
   而节点标记里的画布 id 来自 URL 的实时值 —— URL 画布 ≠ default 时，模型按标记查节点会查错。
   已统一走 `canvasId()`（实时值优先）。

**Standards 轴抓到的违规（已修）**：
3. `PromptPage.vue` 引入绿色（`--ui-ok`）—— 违反 ui-style-guide §2.1「只青/琥珀/红」；改用强调色。
4. `pp-row` 裸 `<div @click>` 缺 `role/tabindex`，且嵌了真 `<button>` —— 违反 §5②；
   改成 `role=list/listitem` + 行内真按钮。
5. Duplicated Code：两条插入路径各抄一份建节点代码 → 抽 `buildResourceNode()`。
6. 死代码：`SessionPrefs.skills` / `runtime.readSkill` / `config.readSkillFile` / `server.ts`
   接线 / `agentApi` 的 `skills` 载荷 —— 技能改懒读后已无消费者，删除。
7. 死代码：`toggleSkill/toggleMcp/activeSkills/activeMcp`（旧开关模型的残留，现以正文标记为唯一真相）
   与 `syncRefsFromText` —— 删除。

**审查指出、一并修的竞态 / 语义问题**：
8. `withSystemPrompt` 是「换 → 建会话 → 还原」，并发 `createSession` 会互相覆盖 AGENTS.md；
   加互斥锁（持有到还原）。新增 `agentPromptLock.test.ts` 2 条守护。
9. 改了模式**正文**后同一会话不生效（SDK 把系统提示词钉在会话上）：记「建会话时用的正文」，
   发送前比对，不一致就开新会话（`ensurePromptFresh`）—— 于是「改提示词 → 下一句就生效」。

## 七、验证

- `pnpm -C packages/prosemirror-editor-bundle test`（16 条：referenceMarkup 11 + mentionFilter 5）
- `pnpm -C packages/plugins/plugin-agent test` + `typecheck`（51 条）
- `pnpm -C packages/cloud-server test` + `typecheck`（330 条）
- `pnpm -C packages/ui test`（85 条）
- 浏览器探针 `packages/ui/e2e/reference-probe.mjs`：@ 菜单出「节点」分组、模式胶囊读后台清单。
