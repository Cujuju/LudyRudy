import { resolve } from 'node:path';
import { defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared'), '@': resolve('src/renderer/src') } },
  environments: { ssr: { resolve: { conditions: ['cujuju-source', ...defaultServerConditions] } } },
  test: { include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'appVersion.test.ts'], environment: 'node' },
});
