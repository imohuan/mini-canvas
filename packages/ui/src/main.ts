import { createApp } from "vue";
import "./app.css";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import Root from "./Root.vue";
import { exposeSharedGlobals } from "./sharedGlobals";
import { exposePluginReloader } from "./pluginReload";
import { exposeSharedKvEvents } from "./composables/kvEvents";
import { router } from "./router";

// 先挂共享运行时全局（Vue / MiniCanvasCore / …），再挂载应用 ——
// 外部 UMD 插件（经「插件管理」安装）靠这些全局取依赖，必须在它们加载前就位。
exposeSharedGlobals();

// 共享 KV 实时通道：全应用（含外部插件 bundle）只开**一条** /api/kv/events。
// 不挂这个，首页/画布/插件各自 new EventSource，几条长连接就把浏览器对单个域名的
// 并发额度（6 条）占满，普通请求全部排队 —— 用户看到的是"网页卡住"。
exposeSharedKvEvents();

// 开发便利：把"重装插件"挂成 window 函数（改完插件产物后一句 window.MiniCanvasPlugin.reload('style-library') 生效）。
// 函数内部调用时才去取 window.MiniCanvasUI，所以这里宿主还没起也没关系。
//
// 想"自动监听、产物一变就重装"：去 设置 → 热重载 里登记链接（见 ui/hotReloadPlugin.ts）——
// 那边支持**多条、跨源**的链接，比在这里写死一条同源地址更通用。
exposePluginReloader();

createApp(Root).use(router).mount("#app");

window.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === "D") {
    debugger;
  }
});

