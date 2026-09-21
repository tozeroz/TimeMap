import { probeImage } from "../src/imageProbe"

const cases = []

// 1) 合法 PNG（手写最小结构：签名 + IHDR(13) + IDAT + IEND）
function png(w, h) {
  const sig = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])
  const ihdr = Buffer.alloc(25)
  ihdr.writeUInt32BE(13, 0)
  ihdr.write("IHDR", 4, "ascii")
  ihdr.writeUInt32BE(w, 8)
  ihdr.writeUInt32BE(h, 12)
  ihdr[16] = 8; ihdr[17] = 6; ihdr[18] = 0; ihdr[19] = 0; ihdr[20] = 0
  // CRC 占位（结构校验不查 CRC）
  ihdr.writeUInt32BE(0, 21)
  const idat = Buffer.alloc(12)
  idat.writeUInt32BE(0, 0); idat.write("IDAT", 4, "ascii"); idat.writeUInt32BE(0, 8)
  const iend = Buffer.alloc(12)
  iend.writeUInt32BE(0, 0); iend.write("IEND", 4, "ascii"); iend.writeUInt32BE(0, 8)
  return Buffer.concat([sig, ihdr, idat, iend])
}
cases.push({ name: "合法 PNG 1920x1080", buf: png(1920, 1080), expect: "ok" })
cases.push({ name: "PNG 尺寸非法 0x0", buf: png(0, 0), expect: "err" })

// 2) 合法 JPEG（SOI + APP0 + SOF0 + EOI）
function jpeg(w, h) {
  const app0 = Buffer.alloc(18)
  app0.writeUInt16BE(0xffe0, 0); app0.writeUInt16BE(16, 2); app0.write("JFIF\0", 4, "ascii")
  const sof = Buffer.alloc(19)
  sof.writeUInt16BE(0xffc0, 0); sof.writeUInt16BE(17, 2); sof[4] = 8
  sof.writeUInt16BE(h, 5); sof.writeUInt16BE(w, 7); sof[9] = 3
  return Buffer.concat([Buffer.from([0xff,0xd8]), app0, sof, Buffer.from([0xff,0xd9])])
}
cases.push({ name: "合法 JPEG 800x600", buf: jpeg(800, 600), expect: "ok" })

// 3) 伪造：文本改名 .jpg
cases.push({ name: "文本内容伪装成 .jpg", buf: Buffer.from("this is definitely not an image at all, just text"), expect: "err" })
// 4) 伪造：PNG 签名 + 垃圾
cases.push({ name: "PNG 签名 + 垃圾数据", buf: Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), Buffer.alloc(60, 0x41)]), expect: "err" })
// 5) 截断的 JPEG（去掉 EOI）
cases.push({ name: "截断的 JPEG（无 EOI）", buf: jpeg(800, 600).subarray(0, jpeg(800, 600).length - 2), expect: "err" })
// 6) SVG
cases.push({ name: "SVG", buf: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"), expect: "err" })
// 7) GIF（不支持）
cases.push({ name: "GIF", buf: Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(20)]), expect: "err" })
// 8) ELF 可执行文件头
cases.push({ name: "ELF 可执行文件", buf: Buffer.concat([Buffer.from([0x7f,0x45,0x4c,0x46]), Buffer.alloc(40)]), expect: "err" })
// 9) 空
cases.push({ name: "空内容", buf: Buffer.alloc(0), expect: "err" })

let fail = 0
for (const c of cases) {
  const r = probeImage(new Uint8Array(c.buf))
  const got = r.ok ? "ok" : "err"
  const mark = got === c.expect ? "PASS" : "FAIL"
  if (got !== c.expect) fail = 1
  const detail = r.ok ? `${r.mime} ${r.width}x${r.height}` : r.reason
  console.log(`  ${mark} ${c.name} → ${got} (${detail})`)
}
console.log(fail === 0 ? "\nIMAGE_PROBE_UNIT PASS" : "\nIMAGE_PROBE_UNIT FAIL")
process.exit(fail)
