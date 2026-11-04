const fs=require('fs');
const pc='packages/plugins/plugin-theme-components/src';
for(const f of ['components/settings/settings/SettingsContent.vue','components/settings/PluginSettingsContent.vue','components/settings/ThemeSizeField.vue','components/settings/ThemeRadiusField.vue','components/settings/ThemeFontField.vue']){
  const p=pc+'/'+f; let t=fs.readFileSync(p,'utf8');
  const rel=f.split('/').length>2?'../../composables/useUiComponentOutside':'../composables/useUiComponentOutside';
  t=t.replace("from '@mini-canvas/theme-contract'","from '"+rel+"'");
  fs.writeFileSync(p,t);
}
const idx='packages/theme-contract/src/index.ts';
let s=fs.readFileSync(idx,'utf8');
s=s.replace('export {\n  setSettingsUiCatalog,\n  useUiComponentOutside,\n} from "./useUiComponentOutside";\n','');
fs.writeFileSync(idx,s);
console.log('ok');
