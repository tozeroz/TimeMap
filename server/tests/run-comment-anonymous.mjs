import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { unlinkSync } from 'node:fs'

const outfile = 'tests/.build/comment-anonymous.mjs'
await build({ entryPoints: ['tests/comment-anonymous.test.ts'], outfile,
  bundle: true, platform: 'node', format: 'esm', loader: { '.sql': 'text' },
  define: { 'import.meta.url': '"file:///comment-anonymous-test"' },
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
})
try {
  const result = spawnSync(process.execPath, [outfile], { stdio: 'inherit' })
  process.exitCode = result.status ?? 1
} finally {
  unlinkSync(outfile)
}
