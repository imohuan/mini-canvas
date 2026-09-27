# 02: 修正作者 SDK 节点字段透传与包内类型入口

**What to build:** 插件作者通过节点声明 helper 注册节点时，所有被类型允许的字段都能到达画布节点定义；SDK 自己的类型引用也能稳定解析。

**Blocked by:** None (can start immediately)

**Status:** done (commit e129d76)

- [x] defineNode 透传所有 NodeRegisterDef 支持的字段，包括当前类型能力、连接声明、区域和创建行为。
- [x] 插件提交无效字段时仍由现有类型/运行时校验明确处理，不静默吞掉。
- [x] SDK 源码内部不通过自身 package name 导入自身类型。
- [x] 通过一个只导入作者 SDK 的插件 fixture，验证字段从声明到注册表的可见行为。
- [x] 保留现有 define* 导出，不在此任务删除未经评估的公开类型。
