/// <reference types="vite/client" />

// Vite の `define` で注入する build-time 定数。
// `declare global { var ... }` を使うことで:
//  - `globalThis.__APP_VERSION__` への代入が型安全になる (test/setup.ts の polyfill 経路)
//  - 通常コードからは読み取り専用の `__APP_VERSION__` 識別子として参照できる
//
// 値は package.json の version から文字列リテラルとして埋め込まれる (vite.config.ts 参照)。
// 本番ビルド外 (vitest 等) では test/setup.ts が "0.0.0-test" を仕込む。
declare global {
  // eslint-disable-next-line no-var -- globalThis プロパティ拡張のため var が必要
  var __APP_VERSION__: string;
}

export {};
