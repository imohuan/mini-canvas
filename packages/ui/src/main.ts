import { createApp } from "vue";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import App from "./App.vue";

createApp(App).mount("#app");

window.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === "D") {
    debugger;
  }
});
