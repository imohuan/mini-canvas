# 拖线吸附命中 —— 修复与最终结论

## 需求（用户口径）
拖线连接时只有两处可建线：**吸附区(端口外吸附带)** 与 **节点卡片区**；其它空白不建。
- 鼠标进吸附区 → 连接线端点吸到该端口(可见吸附)。
- 鼠标在节点卡片上 → 松手可连。
- 只对"当前拖拽方向对应的可连接端口"有效(forward=目标输入口，reverse=目标输出口)。

## 诊断过程（前几轮走偏记录）
1. 最初以为是"前后端吸附几何重复、归属不清"→ 尝试把吸附判定改成真实 DOM 探针(elementsFromPoint)，
   让 BaseNode/MovingHandle 上报，render 只校验落边 —— commit 555bece..72de349。
2. DOM 探针方案在真实运行不可靠且把"线端吸到端口"这一视觉行为弄丢了，用户反馈依然无吸附。
3. **结论：不推翻后端几何。** 几何 resolveFeedback 本就是"吸附带+body+校验+锚点"完整语义、可单测，
   是 v1 同款；真正的缺陷是**默认参数让吸附带不可命中 + 命中后线端没吸到端口**，与"归属"无关。
   故 revert 回几何方案(3b97b4a)，只修两处真 bug。

## 真正修复（两处）
- **portZoneWidth 默认 0→86**（canvasHostCore DEFAULT_HANDLE_VISUAL + theme DEFAULT_THEME_HANDLE）：
  后端吸附带宽 = cfg.width ?? handleRadius(=portZoneWidth)。原默认 0 → 吸附带宽 0 → hitTest 永不命中，
  日志恒 `body`、吸附永不触发。86 才使吸附带真实存在可命中。（历史 commit 0e87391 曾故意设 0）
- **线端吸附**：resolveAtClient 原来丢弃 resolveFeedback.end(端口锚点)，dragFlowPoint 恒为鼠标点，
  即使命中吸附带连接线也不吸到端口 → 无可见吸附效果。现改为：命中**合法 snap** 时用 res.end(锚点) 作临时线端点；
  body/空白仍跟鼠标(body 松手仍可连)。commit 10e818f。

## 命中/连边逻辑（几何，CanvasHost resolveAtClient→resolveFeedback）
- forward(从 source 拖)：只建目标节点左侧(target 输入)吸附带 → 命中该带校验类型/容量，valid 则 hover.zone=snap + 线端吸锚点；落卡片 body 亦合法可连。
- reverse(从 target 拖)：镜像到对方 source(输出)侧。
- drop(松手)：resolveAtClient → decideDropFromHover → checkConnection → commitEdge(幂等防双建)。

## 验证
- canvas-render typecheck 通过；vitest 89 passed。
- plugin-theme-default typecheck 通过。
- 运行级手动确认（浏览器/dev server，本机无法跑 UI）：
  - 拖 A.source → B 输入吸附带：线端吸到 B 输入口 → 松手建边(zone=snap)。
  - 拖 A.source → B 卡片中段：跟鼠标，松手建边(zone=body)。
  - 拖到空白：松手不建。
