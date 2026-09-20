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

/** 两个入口都用同一套打包约定（见文件头注释） */
const COMMON = {
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
      "import { createRequire as __campusCreateRequire } from 'node:module';",
      // fastify 依赖链里有 CJS 包（avvio 等），打进 ESM 产物后它们的 require() 会走
      // esbuild 的 shim，而 shim 默认抛 "Dynamic require of ... is not supported"。
      // 在文件最前面提供真正的 require 即可让 shim 走通（这是 esbuild 官方推荐的 ESM banner 写法）。
      'const require = __campusCreateRequire(import.meta.url);',
    ].join('\n'),
  },
  metafile: true,
}

const TARGETS = [
  {
    entryPoints: ['src/index.ts'],
    outfile: 'dist/index.mjs',
    bannerNote: '// Campus 后端 —— 由 server/build.mjs 生成，请勿手改（改源码后重新构建）',
  },
  {
    entryPoints: ['src/seed-entry.ts'],
    outfile: 'dist/seed.mjs',
    bannerNote: '// Campus seed CLI —— 由 server/build.mjs 生成，请勿手改',
  },
  {
    entryPoints: ['src/admin-entry.ts'],
    outfile: 'dist/admin.mjs',
    bannerNote: '// Campus 运维 CLI（造账号等）—— 由 server/build.mjs 生成，请勿手改',
  },
]

const built = []

for (const t of TARGETS) {
  const result = await build({
    ...COMMON,
    entryPoints: t.entryPoints,
    outfile: t.outfile,
    banner: { js: [t.bannerNote, COMMON.banner.js].join('\n') },
  })
  const out = statSync(t.outfile)
  const inputs = Object.keys(result.metafile.inputs).length
  console.log(`[build] ${t.outfile}  ${(out.size / 1024).toFixed(1)} KB  (${inputs} inputs bundled)`)
  built.push(t.outfile)
}

// 冒烟：真的把产物加载一次。缺这一步会让「构建成功但线上起不来」的问题漏到部署后才暴露
// —— 本项目的 "Dynamic require of node:events" 就是这么被发现的。
const { spawnSync } = await import('node:child_process')

// 1) API 产物：import 一次即可（入口是 conditional 的，import 不会启动监听）
const smokeApi = spawnSync(
  process.execPath,
  ['--input-type=module', '-e', `await import('${new URL('./dist/index.mjs', import.meta.url).href}')`],
  { encoding: 'utf8' },
)
if (smokeApi.status !== 0) {
  console.error('[build] 冒烟失败：API 产物无法被 Node 加载')
  console.error(smokeApi.stderr?.slice(0, 2000) ?? '')
  process.exit(1)
}

// 2) seed 产物：它是 CLI（import 就会执行 main），所以直接跑一次并**故意不设 DATABASE_URL**，
//    期望它自己报"缺少 DATABASE_URL"并以 2 退出 —— 这同时证明了产物可加载、CLI 参数解析可用、
//    且不会在没有目标库的情况下误改数据。
const smokeSeed = spawnSync(process.execPath, ['dist/seed.mjs'], {
  encoding: 'utf8',
  env: { ...process.env, DATABASE_URL: '' },
})
const seedOut = `${smokeSeed.stdout ?? ''}${smokeSeed.stderr ?? ''}`
if (smokeSeed.status !== 2 || !seedOut.includes('缺少 DATABASE_URL')) {
  console.error('[build] 冒烟失败：seed 产物行为不符合预期')
  console.error(seedOut.slice(0, 2000))
  process.exit(1)
}

// 3) admin 产物：同样是 CLI，无 DATABASE_URL 时应自行拒绝（退出码 2）
const smokeAdmin = spawnSync(process.execPath, ['dist/admin.mjs', 'list-users'], {
  encoding: 'utf8',
  env: { ...process.env, DATABASE_URL: '' },
})
const adminOut = `${smokeAdmin.stdout ?? ''}${smokeAdmin.stderr ?? ''}`
if (smokeAdmin.status !== 2 || !adminOut.includes('缺少 DATABASE_URL')) {
  console.error('[build] 冒烟失败：admin 产物行为不符合预期')
  console.error(adminOut.slice(0, 2000))
  process.exit(1)
}

console.log(
  '[build] 冒烟通过：API 产物可被 Node 加载；seed/admin CLI 在无 DATABASE_URL 时按预期拒绝执行',
)
