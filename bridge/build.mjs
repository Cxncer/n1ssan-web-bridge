import { build } from 'esbuild'

await build({
  entryPoints: ['bridge/server.ts'],
  outfile: 'runtime/bridge/server.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  packages: 'external',
  sourcemap: false,
  minify: false,
})

console.log('Production Bridge bundle created.')
