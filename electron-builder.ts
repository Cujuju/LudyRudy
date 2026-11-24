import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Arch, type Configuration } from 'electron-builder';
import { appVersion } from './appVersion.ts';
import { linuxAppImageName } from './scripts/releaseShared.mts';
import { APP_ID, APP_NAME } from './src/shared/app.ts';

const rcloneResources = (platform: string) => [
  { from: `resources/bin/${platform}-\${arch}`, to: 'bin', filter: ['rclone', 'rclone.exe', 'COPYING'] },
];

const config: Configuration = {
  appId: APP_ID,
  productName: APP_NAME,
  extraMetadata: { version: appVersion(import.meta.dirname) },
  directories: { output: 'dist', buildResources: 'resources' },
  files: ['out/main/**', 'out/preload/**', 'out/renderer/**', 'package.json'],
  extraResources: [
    { from: 'resources', to: '.', filter: ['icon.png', 'icon.ico'] },
    { from: 'out/licenses', to: 'licenses' },
    { from: '../solidjs-toolkit/LICENSE', to: 'licenses/solidjs-toolkit.txt' },
    { from: 'src/renderer/src/assets/providers', to: 'licenses/providers', filter: ['README.md', 'LICENSE-dashboard-icons.txt'] },
  ],
  beforePack(context) {
    const platform = context.electronPlatformName;
    const target = `${platform}-${Arch[context.arch]}`;
    const dir = join(import.meta.dirname, 'resources/bin', target);
    for (const file of [platform === 'win32' ? 'rclone.exe' : 'rclone', 'COPYING']) {
      if (!existsSync(join(dir, file))) throw new Error(`Missing ${target}/${file}. Run pnpm rclone:fetch ${target}.`);
    }
  },
  mac: {
    artifactName: '${productName}-${version}-${arch}-mac.${ext}',
    extraResources: rcloneResources('darwin'),
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] },
    ],
    icon: 'resources/icon-1024.png',
    category: 'public.app-category.utilities',
    identity: '-',
    hardenedRuntime: false,
  },
  dmg: { artifactName: '${productName}-${version}-${arch}.${ext}' },
  win: {
    extraResources: rcloneResources('win32'),
    target: [{ target: 'nsis', arch: 'x64' }],
    icon: 'resources/icon.ico',
    extraFiles: [
      { from: 'resources/ludyRudy.VisualElementsManifest.xml', to: 'ludyRudy.VisualElementsManifest.xml' },
      { from: 'resources/tiles', to: 'tiles' },
    ],
  },
  nsis: {
    // No spaces: GitHub renames spaced uploads, and the update manifest names the file as built.
    artifactName: '${productName}-Setup-${version}.${ext}',
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    runAfterFinish: true,
  },
  linux: {
    extraResources: rcloneResources('linux'),
    target: [{ target: 'AppImage', arch: 'x64' }],
    artifactName: linuxAppImageName('${version}'),
    icon: 'resources/icon-1024.png',
    category: 'Utility',
    // Keep Chromium sandboxing enabled in the AppImage desktop entry.
    executableArgs: [],
  },
};

export default config;
