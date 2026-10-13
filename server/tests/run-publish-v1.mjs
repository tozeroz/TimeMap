import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
await build({ entryPoints:['tests/publish-v1.test.ts'], outfile:'tests/.build/publish-v1.mjs',bundle:true,define:{'import.meta.url':'"file:///publish-test-import"'},platform:'node',format:'esm',loader:{'.sql':'text'},banner:{js:"import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"} })
const result=spawnSync(process.execPath,['tests/.build/publish-v1.mjs'],{stdio:'inherit'})
process.exitCode=result.status??1
