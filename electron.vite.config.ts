import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import license from 'rollup-plugin-license';
import solid from 'vite-plugin-solid';
import { appVersion, gitBuild } from './appVersion.ts';

const root = import.meta.dirname;
const shared = { '@shared': resolve(root, 'src/shared') };
const build = { __APP_VERSION__: JSON.stringify(appVersion(root)), __APP_BUILD__: JSON.stringify(gitBuild(root)) };
const bundledLicenses = (bundle: string) => license({
  thirdParty: {
    allow: { test: '(MIT OR ISC OR 0BSD OR BSD-2-Clause OR BSD-3-Clause OR Apache-2.0)', failOnUnlicensed: true, failOnViolation: true },
    output: { file: resolve(root, `out/licenses/npm-${bundle}.txt`) },
  },
});

export default defineConfig(({ command }) => {
  const define = { ...build, __DEV_BUILD__: JSON.stringify(command === 'serve') };
  const resolveShared = { alias: shared, conditions: ['cujuju-source'] };
  const externalizeDeps = { exclude: ['@cujuju/electron-notices'] };
  return {
    main: { plugins: [bundledLicenses('main')], resolve: resolveShared, define, build: { externalizeDeps } },
    preload: {
      plugins: [bundledLicenses('preload')], resolve: resolveShared, define,
      build: { externalizeDeps, rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } },
    },
    renderer: {
      plugins: [solid(), bundledLicenses('renderer')], define,
      resolve: { alias: { ...shared, '@': resolve(root, 'src/renderer/src') }, dedupe: ['solid-js'] },
      server: { fs: { allow: [root, resolve(root, '../solidjs-toolkit')] } },
      build: { rollupOptions: { input: {
        index: resolve(root, 'src/renderer/index.html'), notice: resolve(root, 'src/renderer/notice.html'),
      } } },
    },
  };
});
