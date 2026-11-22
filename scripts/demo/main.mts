import { launchDemo } from './launch.mts';
import { captureScreenshots } from './screenshots.mts';
import { smoke } from './smoke.mts';

const [arg, theme] = process.argv.slice(2);
if (arg === '--smoke') {
  console.log(`smoke: ok, opened ${(await smoke()).join(', ')}`);
} else if (arg === '--screenshots') {
  for (const path of await captureScreenshots(theme)) console.log(`screenshot: ${path}`);
} else {
  const app = await launchDemo({ theme: arg });
  console.log(`demo: fake rclone at ${app.daemon.endpoint}`);
  const close = () => { void app.close().catch((error) => { console.error(error); process.exitCode = 1; }); };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  await app.exited;
  process.removeListener('SIGINT', close);
  process.removeListener('SIGTERM', close);
  await app.close();
}
