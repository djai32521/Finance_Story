/**
 * Browser-safe Node.js filesystem accessor.
 * Uses `process.getBuiltinModule('node:fs')` in Node v22+ so Vite/Rollup browser
 * bundles never encounter a static `import 'node:fs'` dependency.
 */

export interface MinimalFs {
  existsSync(p: string): boolean;
  readFileSync(p: string, encoding: 'utf8'): string;
  writeFileSync(p: string, data: string, encoding: 'utf8'): void;
}

export function getNodeFs(): MinimalFs | null {
  if (
    typeof process !== 'undefined' &&
    typeof (process as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule ===
      'function'
  ) {
    return (process as { getBuiltinModule: (id: string) => MinimalFs }).getBuiltinModule('node:fs');
  }
  return null;
}
