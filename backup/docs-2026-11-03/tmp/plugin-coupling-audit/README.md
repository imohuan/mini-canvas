# 插件耦合体检（2026-10-18）

只看证据，不改业务代码。目标是把 36 个插件的耦合拆成可比较的三类：包依赖、运行时协作、内部实现粘连；另附成品壳的 4 个接缝文件。

## 统一判据

| 级别 | 含义 | 例子 |
|---|---|---|
| L3 硬耦合 | 源码直接 import 另一个插件的内部模块，或写死对方的实现细节 | 节点包 import `plugin-bottom-bar/src/...` 的内部表 |
| L2 契约耦合 | 通过服务名、注册场、插件 `inject` 协作，但依赖名字或时序 | `ctx.get('nodeBar')`、`export const inject = ['doc']` |
| L1 宿主耦合 | 依赖宿主 DOM、全局变量、固定存储键、固定 HTTP 路径 | `document.querySelector(...)`、`localStorage` 键 |
| L0 独立 | 只依赖 kernel / canvas-data / canvas-render 的公开出口 | 只 import `@mini-canvas/canvas-base` |

耦合不必然是坏事。文档会把「合理的公开协作」与「应当收口的粘连」分开，并给出迁移顺序。

## 每个插件的记录项

1. 包清单依赖、`miniCanvas` 身份（builtin / installable）、源码文件数、测试文件数。
2. 源码里的跨包 import，按目标包分组，标出是否公开出口。
3. 运行时协作：`inject`、`ctx.get`、`ctx.tryGet`、`ctx.provide`、注册场键、事件名。
4. 全局/DOM 粘连：`window`、`document`、`localStorage`、固定 URL、定时器、DOM 选择器。
5. 内部职责是否混装（例如一个节点包同时做编辑器、裁剪、上传、任务调度）。
6. 单独安装/卸载的风险，以及可执行的拆分、换契约、补测试建议。

## 证据规则

- 代码检索走 `codegraph`；`rg` 只用于补充全局文本事实，不替代 codegraph。
- 每条重要结论附 `file:line`；没有证据的推断标成「待验证」。
- 只读调查，不修改 `packages/**`。最终只新增本目录文档。

## 交付结构

- `README.md`：判据、方法、限制。
- `coupling-matrix.md`：36 个插件总表与风险分。
- `plugins/<plugin>.md`：逐插件证据与改法。
- `report.md`：跨插件共性、根因、分阶段整改建议。

