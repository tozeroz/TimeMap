import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { unlinkSync } from 'node:fs'

const outfile = 'tests/.build/publish-policy.mjs'
await build({ entryPoints: ['tests/publish-v1.test.ts'], outfile,
  bundle: true, platform: 'node', format: 'esm', loader: { '.sql': 'text' },
  define: { 'import.meta.url': '"file:///publish-policy-test"' },
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
})
try {
  const result = spawnSync(process.execPath, [outfile], { stdio: 'inherit' })
  process.exitCode = result.status ?? 1
} finally {
  unlinkSync(outfile)
}
