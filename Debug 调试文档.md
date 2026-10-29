调试脚本启动 "C:\Users\Administrator\Desktop\启动mini-canvas-server.ps1"
指定端口进行调试 "C:\Users\Administrator\Desktop\8060-mini-canvas.ps1"

插件开发进行实时调试 参考 docs/plugin-dev/10-debug-protocol.md
插件内部调试脚本可以复制脚本 D:\Code\Git\mini-canvas\packages\plugins\plugin-bottom-bar\scripts\watch.mjs

使用Chrome MCP（他在Status中进行查看 工具可用 如果失败的话请注意 使用Status重新获取一遍分类查看用法- 很多时候都是你忘记他的使用方法方式了 记住 使用失败一般都是使用的方式不对）

每一个Agent自己单开一个端口进行调试，因为我有很多Agent 都在进行同步的开发， 所以你这里调试的时候 需要实时修改你调试的网页标题 做一个区分
