# plugin-auto-save

## 一句话

每 1000ms 轮询脏位，脏了就调 save.flush()。一个 72 行的薄适配包，职责单一。

## 清单

| 项 | 值 |
|---|---|
| 包名 | @mini-canvas/plugin-auto-save |
| 身份 | 未声明 miniCanvas 字段（既非 builtin 也非 installable，按运行环境选装） |
| 源码文件 | 3 个（plugin / engine / index） |
| 测试文件 | 2 个，8 个用例 |
| 包依赖的其他插件 | 无 |

## 跨包 import

| 目标 | 入口 | 是否公开出口 | 证据 |
|---|---|---|---|
| canvas-base | Context / PluginModule | 是 | src/autoSavePlugin.ts:15 |
| canvas-data | 类型 SaveService / DocService | 是 | 同上:16 |
| 其他插件 | 无 | — | 全 src 无 plugin- import |

没有 L3 硬耦合。

## 运行时协作

| 依赖 | 方式 | 必需/可选 | 证据 |
|---|---|---|---|
| save | inject + get，flush/isDirty | 必需 | src/autoSavePlugin.ts:20、37、44-45 |
| doc | inject + get，subscribe 置脏 | 必需 | 同上:20、38、50 |
| auto-save 服务 | ctx.inject('auto-save', service) | 对外提供 | 同上:62 |
| 定时器 | setInterval(1000) | — | src/autoSaveEngine.ts:48-55 |

它与宿主 SaveService 的分工写在注释里：宿主负责 hidden/pagehide 即时 flush 与 set 防抖（src/autoSavePlugin.ts:7-11），本包只补周期兜底。这是一条清晰的契约，没有复制宿主逻辑。

风险在于 apply 里写死了 interval = 1000（src/autoSavePlugin.ts:39），既不读 Config 也不暴露设置项。服务接口暴露了 readonly interval（同文件:33），但用户无法调整。

## 全局与宿主粘连

| 对象 | 用途 | 风险 | 证据 |
|---|---|---|---|
| setInterval | 周期轮询 | 低，dispose 清理 | src/autoSaveEngine.ts:53、94-97 |
| 无 window/document/localStorage | — | 无 | 本包 src 检索为空 |

## 内部职责与风险

引擎与插件入口分离干净。一个细节：tick 先把 dirty 置 false 再 await flush（src/autoSaveEngine.ts:67-73），如果 flush 抛错，脏位已经丢了，下一周期不会重试。注释说“落盘期间若又有新变更则保持脏”，但没有处理失败重试。这属于可靠性问题，不是耦合问题。

## 单独装卸判断

可独立装卸。不装时宿主仍有 set 防抖与 hidden/pagehide flush，只是少了周期兜底。装了不会改变别人行为，只多一个服务名 auto-save。

## 建议改法

1. 最小改动：flush 失败时恢复 dirty = true，保证下周期重试。
2. 把 interval 提成 Config（number，默认 1000），与其它插件的设置面板保持一致。
3. 验证：补一条“flush reject 后下一 tick 仍会重试”的引擎测试；现有测试只覆盖成功路径。

## 待验证

- 成品 UI 的 APP_PLUGINS 不含本包（packages/ui/src/assembly.ts:81-83 注释）。云端清单由 packages/cloud-server/src/static.ts:431-437 扫描插件目录生成，是否包含本包取决于部署目录里有没有它的构建产物；本次未核对实际部署目录。

