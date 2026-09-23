/**
 * 下载打包 APK 所需的最小 Android SDK 组件。
 *
 * 为什么自己下：这台机器没有 Android SDK，而 PowerShell 的 .NET HTTP 栈在这里
 * 连不通（node 的 fetch 正常）。所以用 node 下 zip，再用 Expand-Archive 解压。
 *
 * 产物：.android-sdk/{platform-tools,platforms/android-36,build-tools/36.0.0}
 * 用法：node tools/fetch-android-sdk.mjs
 */
import { createWriteStream } from 'node:fs'
import { mkdir, writeFile, stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'

const SDK_DIR = path.resolve('.android-sdk')
const ZIP_DIR = path.join(SDK_DIR, '_zips')
const REPO_XML = 'https://dl.google.com/android/repository/repository2-3.xml'
/** XML 里的 <url> 是相对文件名，统一拼在这个前缀上 */
const REPO_BASE = 'https://dl.google.com/android/repository/'

/** 需要的组件（对应 variables.gradle 的 compileSdkVersion / targetSdkVersion 36） */
const WANTED = [
  { path: 'platform-tools', label: 'platform-tools' },
  { path: 'platforms;android-36', label: 'platforms/android-36' },
  { path: 'build-tools;36.0.0', label: 'build-tools/36.0.0' },
]

async function fetchText(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return await res.text()
}

/**
 * 从 repository2-3.xml 里挑出每个组件对应的 windows zip 地址。
 *
 * 每个组件是一个 <remotePackage path="..."> 块，块内 <archives> 下有多个 <archive>，
 * 各自带 <host-os>（windows / macosx / linux）与 <complete><url>文件名</url>。
 * platform 这类与系统无关的包没有 <host-os>，此时直接取第一个。
 */
function pickUrls(xml) {
  const found = new Map()
  const blocks = xml.split('<remotePackage ')
  for (const block of blocks.slice(1)) {
    const pathMatch = block.match(/path="([^"]+)"/)
    if (!pathMatch) continue
    const pkgPath = pathMatch[1]
    if (!WANTED.some((w) => w.path === pkgPath)) continue

    const archives = [...block.matchAll(/<archive>([\s\S]*?)<\/archive>/g)].map((m) => m[1])
    const parse = (chunk) => {
      const url = chunk.match(/<url>([^<]+)<\/url>/)?.[1]
      const os = chunk.match(/<host-os>([^<]+)<\/host-os>/)?.[1] ?? null
      return url ? { url: REPO_BASE + url, os } : null
    }
    const parsed = archives.map(parse).filter(Boolean)
    const chosen = parsed.find((a) => a.os === 'windows') ?? parsed.find((a) => a.os === null) ?? parsed[0]
    if (chosen) found.set(pkgPath, chosen.url)
  }
  return found
}

async function download(url, destFile) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(destFile))
  const s = await stat(destFile)
  return s.size
}

await mkdir(ZIP_DIR, { recursive: true })

console.log('拉取 SDK 组件清单…')
const xml = await fetchText(REPO_XML)
const urls = pickUrls(xml)
for (const w of WANTED) {
  if (!urls.has(w.path)) console.warn(`  ! 清单里没找到 ${w.path}`)
  else console.log(`  ${w.path} → ${urls.get(w.path)}`)
}

const manifest = []
for (const w of WANTED) {
  const url = urls.get(w.path)
  if (!url) continue
  const fileName = url.split('/').pop()
  const dest = path.join(ZIP_DIR, fileName)
  process.stdout.write(`下载 ${fileName} … `)
  const size = await download(url, dest)
  console.log(`${(size / 1024 / 1024).toFixed(1)} MB`)
  manifest.push({ label: w.label, zip: dest })
}

await writeFile(
  path.join(SDK_DIR, 'download-manifest.json'),
  JSON.stringify({ sdkDir: SDK_DIR, zipDir: ZIP_DIR, items: manifest }, null, 2),
)
console.log('\n下载完成，清单写入 .android-sdk/download-manifest.json')
