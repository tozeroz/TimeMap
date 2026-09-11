// 校验 ~/.dsh/settings.yaml 是否仍是合法 YAML，并回显关键字段。
const YAML_DIR = 'C:/Users/zjx230494186/.dsh/profiles/web/node_modules/yaml'
const { parse } = await import(`file:///${YAML_DIR}/dist/index.js`)

const { readFileSync } = await import('node:fs')
const path = 'C:/Users/zjx230494186/.dsh/settings.yaml'
const text = readFileSync(path, 'utf8')

let doc
try {
  doc = parse(text)
  console.log('✅ YAML 解析成功')
} catch (error) {
  console.log('❌ YAML 解析失败：', error.message)
  process.exit(1)
}

const de = doc.deepseekeyes ?? {}
console.log('deepseekeyes:')
for (const [k, v] of Object.entries(de)) console.log(`  ${k} = ${JSON.stringify(v)}`)

const providers = Object.keys(doc['llm-pi-ai']?.providers ?? {})
console.log('llm-pi-ai providers:', providers.join(', '))
console.log('agent-default-model:', JSON.stringify(doc['agent-default-model']))
console.log('顶层键数量:', Object.keys(doc).length)
