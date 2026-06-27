import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig(({ mode }) => {
  const isWebComponent = mode === 'webcomponent';
  const isWebComponentVue = mode === 'webcomponent-vue';

  return {
    define: isWebComponentVue ? {
      'process.env.NODE_ENV': JSON.stringify('production'),
    } : {},
    plugins: [
      !isWebComponent && vue({
        customElement: isWebComponentVue,
      }),
      dts({
        insertTypesEntry: true,
        include: ['src/**/*.ts', 'src/**/*.vue'],
        exclude: ['src/demo/**'],
      }),
    ].filter(Boolean),
    build: {
      lib: {
        entry: resolve(__dirname,
          isWebComponent ? 'src/web-component.ts' :
            isWebComponentVue ? 'src/web-component-vue.ts' :
              'src/index.ts'
        ),
        name: 'ProseMirrorEditor',
        formats: (isWebComponent || isWebComponentVue) ? ['iife'] : ['es', 'umd'],
        fileName: (format) => {
          if (isWebComponent) return 'prosemirror-editor.standalone.js';
          if (isWebComponentVue) return 'prosemirror-editor.vue.js';
          return `prosemirror-editor.${format}.js`;
        },
      },
      rollupOptions: {
        external: (isWebComponent || isWebComponentVue) ? [] : [],
        output: {
          globals: {},
          assetFileNames: (assetInfo) => {
            if (assetInfo.name === 'style.css') return 'style.css';
            return assetInfo.name || '';
          },
        },
      },
      cssCodeSplit: false,
    },
  };
});
