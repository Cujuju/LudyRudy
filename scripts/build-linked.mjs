// Linked packages expose declarations from their own builds. Keep the sibling workspace read-only.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const pkg = readJson(resolve(root, 'package.json'));
for (const [name, spec] of Object.entries(pkg.dependencies)) {
  if (!spec.startsWith('link:')) continue;
  const dir = resolve(root, spec.slice('link:'.length));
  const linked = readJson(resolve(dir, 'package.json'));
  const declarations = Object.values(linked.exports ?? {}).map((entry) => entry?.types).filter(Boolean);
  if (linked.types) declarations.push(linked.types);
  if (declarations.some((file) => !existsSync(resolve(dir, file)))) {
    throw new Error(`Build ${name} first with pnpm --dir "${dir}" run build.`);
  }
  console.log(`build-linked: ${name} declarations available`);
}
