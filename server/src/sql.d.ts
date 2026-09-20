/**
 * esbuild 用 `.sql` 的 text loader 把 SQL 内联成字符串（见 build.mjs）。
 * TypeScript 需要这条声明才知道 import 出来的是 string。
 */
declare module '*.sql' {
  const content: string
  export default content
}
