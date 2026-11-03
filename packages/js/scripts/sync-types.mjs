#!/usr/bin/env node
/**
 * Vendors the public types of pletopay.js (the checkout popup script) into src/pletopay-types.ts, so
 * the loader's `PletopayClient` is exactly what the served script implements.
 *
 *   node packages/js/scripts/sync-types.mjs           copy from ../pletopay-checkout/sdk/src/types.ts (or PLETOPAY_JS_TYPES_PATH)
 *   node packages/js/scripts/sync-types.mjs --check   fail when stale
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source =
  process.env.PLETOPAY_JS_TYPES_PATH ??
  resolve(here, '..', '..', '..', '..', 'pletopay-checkout', 'sdk', 'src', 'types.ts');
const target = resolve(here, '..', 'src', 'pletopay-types.ts');
const check = process.argv.includes('--check');
const header = `// Vendored from the pletopay.js source (pletopay-checkout/sdk/src/types.ts) by scripts/sync-types.mjs.\n// Do not edit: run \`pnpm sync:types\`.\n\n`;

if (!existsSync(source)) {
  if (check && existsSync(target)) {
    console.log(`types: source ${source} not found; keeping the committed copy`);
    process.exit(0);
  }
  console.error(`types: source not found at ${source} (set PLETOPAY_JS_TYPES_PATH)`);
  process.exit(1);
}
const next = header + readFileSync(source, 'utf8');
const current = existsSync(target) ? readFileSync(target, 'utf8') : null;
if (check) {
  if (current !== next) {
    console.error('types: packages/js/src/pletopay-types.ts is stale. Run `pnpm sync:types` and commit the result.');
    process.exit(1);
  }
  console.log('types: up to date');
} else if (current === next) {
  console.log('types: already up to date');
} else {
  writeFileSync(target, next);
  console.log('types: wrote packages/js/src/pletopay-types.ts');
}
