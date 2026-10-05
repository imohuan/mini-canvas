import { createApp } from "vue";
import "./app.css";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import Root from "./Root.vue";
import { exposeSharedGlobals } from "./sharedGlobals";
import { router } from "./router";

// 先挂共享运行时全局（Vue / MiniCanvasCore / …），再挂载应用 ——
// 外部 UMD 插件（经「插件管理」安装）靠这些全局取依赖，必须在它们加载前就位。
exposeSharedGlobals();

createApp(Root).use(router).mount("#app");

window.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === "D") {
    debugger;
  }
});
