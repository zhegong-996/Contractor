import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { extractStyle } from '@ant-design/static-style-extract';
import { ConfigProvider, theme } from 'antd';
import { createElement } from 'react';
import { workbenchTheme, themeFor, palettes } from './src/components/theme.ts';

const antStyles = 'virtual:workbench-antd.css';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [
    react(), tailwindcss(),
    {
      name: 'workbench-antd-styles',
      resolveId: id => id === antStyles ? '\0' + id : undefined,
      // The workbench serves only same-origin styles. Compile the selected component styles during build.
      load(id) {
        if (id !== '\0' + antStyles) return;
        const includes = ['Alert', 'Avatar', 'Breadcrumb', 'Button', 'Card', 'Drawer', 'Empty', 'Input', 'Layout', 'Menu', 'Modal',
          'Tag', 'Pagination', 'Select', 'Spin', 'Table', 'Tabs', 'Tooltip', 'Upload'] as const;
        const styles = (config: typeof workbenchTheme) => extractStyle({
          includes: [...includes], customTheme: node => createElement(ConfigProvider, { theme: config }, node),
        });
        // Ant uses the same selectors in both schemes. Only emit its token overrides a second time.
        const dark = styles({ ...themeFor('dark'), algorithm: theme.darkAlgorithm, zeroRuntime: true });
        const colors = Object.entries(palettes.dark).map(([key, value]) => '--scheme-' + key + ':' + value).join(';');
        return styles(workbenchTheme) + '@media (prefers-color-scheme:dark){:root{' + colors + '}' + dark + '}';
      },
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
