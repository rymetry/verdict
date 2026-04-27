/// <reference types="vite/client" />

// Vite の `define` で注入する build-time 定数。
// 値は package.json の version から文字列リテラルとして埋め込まれる (vite.config.ts 参照)。
// Chrome の brand-sub 表示で利用する。
declare const __APP_VERSION__: string;
