/**
 * 构建并运行 `tests/shutdown-race.test.ts`。
 *
 * 为什么需要一个构建步骤（而不是 `node --experimental-strip-types` 直接跑）：
 *   db.ts 通过 `import x from './migrations/001_init.sql'` 内联迁移 SQL，
 *   而 Node 的类型擦除**不认识 .sql 扩展名**（实测报 ERR_UNKNOWN_FILE_EXTENSION）。
 *   本项目的既定做法就是用 esbuild 把 .sql 以 text loader 内联 —— 这里沿用**同一套
 *   打包约定**（见 build.mjs 的 COMMON），以保证"测试里跑的 db.ts"与"线上跑的"是同一份语义。
 *
 * 另一个刻意的点：`packages: 'bundle'` 会把 pg 也打进同一个产物。
 *   由于 db.ts 与测试代码共享**同一份被内联的 pg 模块实例**，
 *   测试里对 `pg.Pool.prototype.query` 装的探针才能作用到 db.ts 用的那个 Pool 上。
 *   若改成 external，两边会各自加载一份 pg，探针就失效了（测试会静默失去判别力）。
 */
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'

mkdirSync('tests/.build', { recursive: true })

await build({
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  packages: 'bundle',
  sourcemap: false,
  minify: false,
  legalComments: 'none',
  loader: { '.sql': 'text' },
  banner: {
    js: [
      "import { createRequire as __campusCreateRequire } from 'node:module';",
      'const require = __campusCreateRequire(import.meta.url);',
    ].join('\n'),
  },
  entryPoints: ['tests/shutdown-race.test.ts'],
  outfile: 'tests/.build/shutdown-race.mjs',
})

const r = spawnSync(process.execPath, ['tests/.build/shutdown-race.mjs'], {
  stdio: 'inherit',
  env: process.env,
})

// 产物是中间物，跑完就清掉（避免被误当成源码提交）
rmSync('tests/.build', { recursive: true, force: true })

process.exit(r.status ?? 1)
