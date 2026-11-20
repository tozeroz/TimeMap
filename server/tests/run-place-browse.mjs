import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { unlinkSync } from 'node:fs'

const outfile = 'tests/.build/place-browse.mjs'
await build({ entryPoints: ['tests/place-browse.test.ts'], outfile,
  bundle: true, platform: 'node', format: 'esm', loader: { '.sql': 'text' },
  define: { 'import.meta.url': '"file:///place-browse-test"' },
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
})
try {
  const result = spawnSync(process.execPath, [outfile], { stdio: 'inherit' })
  process.exitCode = result.status ?? 1
} finally {
  unlinkSync(outfile)
}
