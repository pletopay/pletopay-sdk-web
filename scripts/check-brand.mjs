#!/usr/bin/env node
/**
 * The brand is written "Pletopay". Only the protocol headers keep the capital P
 * (X-PletoPay-Signature, X-PletoPay-Event-ID, PletoPay-Version, …). Merchants never see our
 * banking partner's name either. This check runs over the source, tests, examples and docs.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const roots = [
  'src',
  'test',
  'examples',
  'scripts',
  'README.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'package.json',
];
const skip = new Set(['node_modules', 'dist', 'scripts/check-brand.mjs']);
const skipDirs = new Set(['node_modules', 'dist', '.nuxt', '.output', '.next']);
const rules = [
  [/PletoPay(?!-)/, 'misspells the brand (write "Pletopay"; only the PletoPay-* protocol headers keep the capital P)'],
  [/9ja ?pay/i, 'names the banking partner (merchants work with Pletopay)'],
];

function entry(path) {
  return path.split('/').pop();
}

function* walk(path) {
  const rel = relative(root, path);
  if (skip.has(rel)) return;
  const st = statSync(path, { throwIfNoEntry: false });
  if (!st) return;
  if (st.isDirectory()) {
    if (skipDirs.has(entry(path))) return;
    for (const entry of readdirSync(path)) yield* walk(join(path, entry));
  } else if (/\.(ts|tsx|vue|mjs|js|json|md|yaml|yml)$/.test(path)) {
    yield path;
  }
}

const problems = [];
for (const r of roots) {
  for (const file of walk(resolve(root, r))) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const [re, why] of rules) {
        if (re.test(line)) problems.push(`${relative(root, file)}:${i + 1}: ${why}\n    ${line.trim()}`);
      }
    });
  }
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('brand: ok');
