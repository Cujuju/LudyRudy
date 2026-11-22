import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Cdp, freePort } from './cdp.mts';
import { DEMO_WINDOW } from './fixtures.mts';
import { launchDemo } from './launch.mts';
import { openPage, PAGES } from './pages.mts';

const OUTPUT = resolve(import.meta.dirname, '../../out/screenshots');
const VIEWPORT = { ...DEMO_WINDOW, deviceScaleFactor: 1, mobile: false };

export async function captureScreenshots(theme?: string) {
  const port = await freePort();
  const app = await launchDemo({ theme, debuggingPort: port });
  const files: string[] = [];
  let page: Cdp | undefined;
  try {
    page = await Cdp.mainWindow(port, app.exitReason);
    await page.send('Emulation.setDeviceMetricsOverride', VIEWPORT);
    await mkdir(OUTPUT, { recursive: true });
    for (const label of PAGES) {
      await openPage(page, label, app.exitReason);
      await page.eval('document.fonts.ready.then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))');
      const { data } = await page.send<{ data: string }>('Page.captureScreenshot', {
        format: 'png', clip: { x: 0, y: 0, ...DEMO_WINDOW, scale: 1 }, captureBeyondViewport: true,
      });
      const path = resolve(OUTPUT, `${label.toLowerCase()}.png`);
      await writeFile(path, Buffer.from(data, 'base64'));
      files.push(path);
    }
    return files;
  } finally {
    page?.close();
    await app.close();
  }
}
