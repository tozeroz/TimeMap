import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { unlinkSync } from 'node:fs'

await build({ entryPoints: ['tests/feed-avatar.test.ts'], outfile: 'tests/.build/feed-avatar.mjs',
  bundle: true, platform: 'node', format: 'esm', loader: { '.sql': 'text' },
  define: { 'import.meta.env': '{}', 'import.meta.url': '"file:///feed-avatar-test"' },
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
})
const result = spawnSync(process.execPath, ['tests/.build/feed-avatar.mjs'], { stdio: 'inherit' })
unlinkSync('tests/.build/feed-avatar.mjs')
process.exitCode = result.status ?? 1
