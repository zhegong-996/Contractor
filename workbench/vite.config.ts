import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { extractStyle } from '@ant-design/static-style-extract';
import { ConfigProvider } from 'antd';
import { createElement } from 'react';
import { workbenchTheme } from './src/components/theme.ts';

const antStyles = 'virtual:workbench-antd.css';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [
    react(), tailwindcss(),
    {
      name: 'workbench-antd-styles',
      resolveId: id => id === antStyles ? '\0' + id : undefined,
      // The workbench serves only same-origin styles. Compile the selected component styles during build.
      load: id => id === '\0' + antStyles ? extractStyle({
        includes: ['Alert', 'Avatar', 'Breadcrumb', 'Button', 'Card', 'Drawer', 'Empty', 'Input', 'Layout', 'Menu', 'Modal',
          'Tag', 'Pagination', 'Select', 'Spin', 'Table', 'Tabs', 'Tooltip', 'Upload'],
        customTheme: node => createElement(ConfigProvider, { theme: workbenchTheme }, node),
      }) : undefined,
    },
    {
      name: 'vendored-component-licenses',
      generateBundle() {
        const notices = [
          ['Octop — consultation member picker and speaker attribution', 'octop-MIT.txt'],
          ['@ant-design/icons-svg — 4.6.0, upstream MIT notice', 'ant-design-icons-MIT.txt'],
          ['is-mobile — 5.0.0, MIT notice from the published npm README', 'is-mobile-MIT.txt'],
        ];
        const terms = notices.map(([title, file]) => title + '\n'
          + readFileSync(new URL('../licenses/' + file, import.meta.url), 'utf8'));
        this.emitFile({ type: 'asset', fileName: 'component-licenses.txt', source: [
          'Contractor\n' + readFileSync(new URL('../LICENSE', import.meta.url), 'utf8'), ...terms,
        ].join('\n') });
      },
    },
  ],
  build: {
    outDir: fileURLToPath(new URL('../dist/workbench', import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
    license: { fileName: 'browser-dependency-licenses.txt' },
    rolldownOptions: { output: {
      codeSplitting: { groups: [{ name: 'react-runtime', test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/ }] },
      postBanner: '/* Third-party licenses: /licenses/components and /licenses/browser-dependencies */',
    } },
  },
});
