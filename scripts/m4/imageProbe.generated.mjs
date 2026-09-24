// src/imageProbe.ts
var err = (reason) => ({ ok: false, reason });
var MAX_PIXELS = 4e7;
function checkDimensions(kind, width, height) {
  if (width <= 0 || height <= 0) return err(`${kind} \u5C3A\u5BF8\u975E\u6CD5\uFF08${width}x${height}\uFF09`);
  if (width > 2e4 || height > 2e4) return err(`${kind} \u5355\u8FB9\u5C3A\u5BF8\u8FC7\u5927\uFF08${width}x${height}\uFF09`);
  if (width * height > MAX_PIXELS) {
    return err(`${kind} \u50CF\u7D20\u603B\u91CF\u8FC7\u5927\uFF08${width}x${height} = ${width * height} \u50CF\u7D20\uFF0C\u4E0A\u9650 ${MAX_PIXELS}\uFF09`);
  }
  return null;
}
var PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];
function startsWith(buf, sig, at = 0) {
  if (buf.length < at + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (buf[at + i] !== sig[i]) return false;
  return true;
}
var be16 = (b, o) => b[o] << 8 | b[o + 1];
var be32 = (b, o) => (b[o] << 24 | b[o + 1] << 16 | b[o + 2] << 8 | b[o + 3]) >>> 0;
function probePng(b) {
  if (b.length < 33) return err("PNG \u592A\u77ED\uFF0C\u8FDE\u5934\u90E8\u90FD\u4E0D\u5B8C\u6574");
  if (!startsWith(b, PNG_SIG)) return err("PNG \u7B7E\u540D\u4E0D\u5339\u914D");
  const len = be32(b, 8);
  const type = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (type !== "IHDR") return err(`PNG \u7B2C\u4E00\u4E2A chunk \u4E0D\u662F IHDR\uFF08\u662F ${type}\uFF09`);
  if (len !== 13) return err(`PNG IHDR \u957F\u5EA6\u5F02\u5E38\uFF08${len}\uFF09`);
  const width = be32(b, 16);
  const height = be32(b, 20);
  const bad = checkDimensions("PNG", width, height);
  if (bad) return bad;
  return { ok: true, mime: "image/png", width, height };
}
function probeJpeg(b) {
  if (b.length < 4) return err("JPEG \u592A\u77ED");
  if (!(b[0] === 255 && b[1] === 216)) return err("JPEG SOI \u6807\u8BB0\u4E0D\u5339\u914D");
  if (!(b[b.length - 2] === 255 && b[b.length - 1] === 217)) {
    return err("JPEG \u7F3A\u5C11 EOI \u7ED3\u675F\u6807\u8BB0\uFF08\u53EF\u80FD\u88AB\u622A\u65AD\uFF09");
  }
  let o = 2;
  while (o + 3 < b.length) {
    if (b[o] !== 255) return err(`JPEG \u6BB5\u6807\u8BB0\u9519\u4F4D @${o}`);
    const marker = b[o + 1];
    if (marker === 255) {
      o += 1;
      continue;
    }
    if (marker === 216 || marker === 1 || marker >= 208 && marker <= 215) {
      o += 2;
      continue;
    }
    const segLen = be16(b, o + 2);
    if (segLen < 2) return err(`JPEG \u6BB5\u957F\u5EA6\u975E\u6CD5 @${o}`);
    const isSof = marker >= 192 && marker <= 207 && marker !== 196 && marker !== 200 && marker !== 204;
    if (isSof) {
      if (o + 9 >= b.length) return err("JPEG SOF \u6BB5\u4E0D\u5B8C\u6574");
      const height = be16(b, o + 5);
      const width = be16(b, o + 7);
      const bad = checkDimensions("JPEG", width, height);
      if (bad) return bad;
      return { ok: true, mime: "image/jpeg", width, height };
    }
    o += 2 + segLen;
  }
  return err("JPEG \u6CA1\u6709\u627E\u5230 SOF \u5E27\uFF08\u53EF\u80FD\u4E0D\u662F\u771F\u56FE\uFF09");
}
function probeWebp(b) {
  if (b.length < 30) return err("WebP \u592A\u77ED");
  if (!startsWith(b, [82, 73, 70, 70])) return err("WebP \u7F3A\u5C11 RIFF \u5934");
  if (String.fromCharCode(b[8], b[9], b[10], b[11]) !== "WEBP") return err("WebP \u7F3A\u5C11 WEBP \u6807\u8BC6");
  const riffSize = b[4] | b[5] << 8 | b[6] << 16 | b[7] << 24;
  if (riffSize + 8 > b.length) return err("WebP \u58F0\u660E\u957F\u5EA6\u8D85\u8FC7\u5B9E\u9645\u5B57\u8282\u6570\uFF08\u88AB\u622A\u65AD\uFF09");
  const fourcc = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (fourcc === "VP8 ") {
    const i = 26;
    if (b.length < i + 4) return err("WebP VP8 \u5934\u4E0D\u5B8C\u6574");
    if (!(b[i + 3] === 157 && b[i + 4] === 1 && b[i + 5] === 42)) {
      return err("WebP VP8 \u5173\u952E\u5E27\u8D77\u59CB\u7801\u4E0D\u5339\u914D");
    }
    const w = ((b[i + 6] | b[i + 7] << 8) & 16383) >>> 0;
    const h = ((b[i + 8] | b[i + 9] << 8) & 16383) >>> 0;
    {
      const bad = checkDimensions("WebP", w, h);
      if (bad) return bad;
    }
    return { ok: true, mime: "image/webp", width: w, height: h };
  }
  if (fourcc === "VP8L") {
    if (b.length < 25) return err("WebP VP8L \u5934\u4E0D\u5B8C\u6574");
    if (b[20] !== 47) return err("WebP VP8L \u7B7E\u540D\u4E0D\u5339\u914D");
    const bits = b[21] | b[22] << 8 | b[23] << 16 | b[24] << 24;
    const w = (bits & 16383) + 1;
    const h = (bits >> 14 & 16383) + 1;
    {
      const bad = checkDimensions("WebP", w, h);
      if (bad) return bad;
    }
    return { ok: true, mime: "image/webp", width: w, height: h };
  }
  if (fourcc === "VP8X") {
    if (b.length < 30) return err("WebP VP8X \u5934\u4E0D\u5B8C\u6574");
    const w = (b[24] | b[25] << 8 | b[26] << 16) + 1;
    const h = (b[27] | b[28] << 8 | b[29] << 16) + 1;
    {
      const bad = checkDimensions("WebP", w, h);
      if (bad) return bad;
    }
    return { ok: true, mime: "image/webp", width: w, height: h };
  }
  return err(`WebP \u5B50\u683C\u5F0F\u4E0D\u652F\u6301\uFF08${fourcc}\uFF09`);
}
function probeImage(buf) {
  if (buf.length < 12) return err("\u5185\u5BB9\u592A\u77ED\uFF0C\u4E0D\u53EF\u80FD\u662F\u6709\u6548\u56FE\u7247");
  if (startsWith(buf, PNG_SIG)) return probePng(buf);
  if (buf[0] === 255 && buf[1] === 216) return probeJpeg(buf);
  if (startsWith(buf, [82, 73, 70, 70])) return probeWebp(buf);
  const head = Buffer.from(buf.subarray(0, Math.min(buf.length, 200))).toString("utf8").trimStart();
  if (head.startsWith("<svg") || head.startsWith("<?xml")) return err("SVG/XML \u4E0D\u5141\u8BB8\u4E0A\u4F20\uFF08\u53EF\u80FD\u662F\u811A\u672C\u8F7D\u4F53\uFF09");
  return err("\u4E0D\u8BA4\u8BC6\u7684\u6587\u4EF6\u7C7B\u578B\uFF08\u53EA\u63A5\u53D7 jpeg/png/webp\uFF09");
}
export {
  probeImage
};
