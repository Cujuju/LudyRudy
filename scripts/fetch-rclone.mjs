import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const VERSION = '1.76.0';
const COPYING_SHA256 = '8cd2e9e750b90a04b7d82dbbca3930c696ae0309d7c10464f90a44f45754cd04';
const COPYING_URL = `https://raw.githubusercontent.com/rclone/rclone/v${VERSION}/COPYING`;
const targets = { 'darwin-arm64': 'osx-arm64', 'darwin-x64': 'osx-amd64', 'win32-x64': 'windows-amd64', 'linux-x64': 'linux-amd64' };
const target = process.argv[2] ?? `${process.platform}-${process.arch}`;
if (process.argv.length > 3 || (target !== 'all' && !Object.hasOwn(targets, target))) {
  throw new Error(`Usage: pnpm rclone:fetch [${Object.keys(targets).join('|')}|all]`);
}

const origin = `https://downloads.rclone.org/v${VERSION}/`;
const out = resolve(import.meta.dirname, '../resources/bin');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const download = async (name, url = new URL(name, origin)) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Download failed for ${name}: HTTP ${response.status}`);
  return response;
};
const checksums = await (await download('SHA256SUMS')).text();
let taggedLicense;
async function sourceLicense() {
  if (taggedLicense) return taggedLicense;
  // Binary release archives may omit COPYING. Use the checksummed license from the same tag.
  const data = Buffer.from(await (await download('COPYING', COPYING_URL)).arrayBuffer());
  if (sha256(data) !== COPYING_SHA256) throw new Error('SHA256 mismatch for rclone COPYING.');
  taggedLicense = data;
  return data;
}
await mkdir(out, { recursive: true });
const scratch = await mkdtemp(join(out, '.fetch-'));
try {
  for (const key of target === 'all' ? Object.keys(targets) : [target]) {
    const name = `rclone-v${VERSION}-${targets[key]}`;
    const zip = `${name}.zip`;
    const expected = checksums.split(/\r?\n/).map((line) => /^([a-f0-9]{64})\s+\*?(\S+)$/.exec(line))
      .find((match) => match?.[2] === zip)?.[1];
    if (!expected) throw new Error(`Missing SHA256 for ${zip}`);
    const archive = Buffer.from(await (await download(zip)).arrayBuffer());
    if (sha256(archive) !== expected) throw new Error(`SHA256 mismatch for ${zip}`);

    const archivePath = join(scratch, zip);
    await writeFile(archivePath, archive);
    const dir = join(out, key);
    const binary = key.startsWith('win32-') ? 'rclone.exe' : 'rclone';
    const windows = process.platform === 'win32';
    const extractor = windows ? 'tar.exe' : 'unzip';
    const members = execFileSync(extractor, [windows ? '-tf' : '-Z1', archivePath], { encoding: 'utf8' }).split(/\r?\n/);
    const extract = (file) => {
      const member = `${name}/${file}`;
      const data = execFileSync(extractor, windows ? ['-xOf', archivePath, member] : ['-p', archivePath, member], { maxBuffer: Infinity });
      if (!data.length) throw new Error(`Empty archive entry: ${member}`);
      return data;
    };
    const binaryData = extract(binary);
    const licenseData = members.includes(`${name}/COPYING`) ? extract('COPYING') : await sourceLicense();
    const files = [{ file: 'COPYING', data: licenseData }, { file: binary, data: binaryData }];
    await mkdir(dir, { recursive: true });
    for (const { file, data } of files) {
      const staged = join(scratch, randomUUID());
      await writeFile(staged, data, { mode: file === binary ? 0o755 : 0o644 });
      await rename(staged, join(dir, file));
    }
    console.log(`rclone v${VERSION}: verified and extracted ${key}`);
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}
