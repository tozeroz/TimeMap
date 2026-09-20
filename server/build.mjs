/**
 * 把后端打成**单文件** dist/index.mjs。
 *
 * 为什么这么做（M1 设计的部署形态）：
 *   服务器只有 396MB 内存、20GB 磁盘，且明确「不在服务器上跑构建」。
 *   esbuild 把 fastify + pg + SQL 全部内联进一个 .mjs，
 *   服务器上因此**不需要 node_modules**，部署就是「传一个文件 + 重启服务」。
 *
 * 维护性约定（M2/M3 加依赖时遵守）：
 *   1. 依赖必须是纯 JS（不允许需要 node-gyp 编译的包，例如 pg-native）；
 *   2. 只走 `dependencies`；`devDependencies` 不进包；
 *   3. SQL/文本资源用 loader 内联（见 .sql=text），不要运行时读目录；
 *   4. 打包后跑一次 `node dist/index.mjs` 冒烟验证，别只看构建成功。
 */
import { build } from 'esbuild'
import { rmSync, statSync } from 'node:fs'

rmSync('dist', { recursive: true, force: true })

const result = await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.mjs',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  // 单文件自包含：所有依赖都打进来，服务器不需要 node_modules
  packages: 'bundle',
  sourcemap: false,
  minify: false, // 保留可读性，便于线上排障（396MB 机器也不缺这点磁盘）
  legalComments: 'none',
  loader: { '.sql': 'text' },
  banner: {
    js: [
      '// Campus 后端 M1 —— 由 server/build.mjs 生成，请勿手改（改源码后重新构建）',
      // fastify 依赖链里有 CJS 包（avvio 等），打进 ESM 产物后它们的 require() 会走
      // esbuild 的 shim，而 shim 默认抛 "Dynamic require of ... is not supported"。
      // 在文件最前面提供真正的 require 即可让 shim 走通（这是 esbuild 官方推荐的 ESM banner 写法）。
      "import { createRequire as __campusCreateRequire } from 'node:module';",
      'const require = __campusCreateRequire(import.meta.url);',
    ].join('\n'),
  },
  metafile: true,
})

const out = statSync('dist/index.mjs')
const inputs = Object.keys(result.metafile.inputs).length
console.log(`[build] dist/index.mjs  ${(out.size / 1024).toFixed(1)} KB  (${inputs} inputs bundled)`)

// 冒烟：真的把产物 import 一次。缺这一步会让「构建成功但线上起不来」的问题漏到部署后才暴露
// —— 本项目的 "Dynamic require of node:events" 就是这么被发现的。
const { spawnSync } = await import('node:child_process')
const smoke = spawnSync(
  process.execPath,
  ['--input-type=module', '-e', `await import('${new URL('./dist/index.mjs', import.meta.url).href}')`],
  { encoding: 'utf8' },
)
if (smoke.status !== 0) {
  console.error('[build] 冒烟失败：产物无法被 Node 加载')
  console.error(smoke.stderr?.slice(0, 2000) ?? '')
  process.exit(1)
}
console.log('[build] 冒烟通过：产物可被 Node 正常加载')
