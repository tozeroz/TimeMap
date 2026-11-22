import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { unlinkSync } from 'node:fs'
const outfile='tests/.build/direct-messages.mjs'
await build({entryPoints:['tests/direct-messages.test.ts'],outfile,bundle:true,platform:'node',format:'esm',loader:{'.sql':'text'},
  define:{'import.meta.url':'"file:///direct-messages-test"'},banner:{js:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"}})
try{process.exitCode=spawnSync(process.execPath,[outfile],{stdio:'inherit'}).status??1}finally{unlinkSync(outfile)}
