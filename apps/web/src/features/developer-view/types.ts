// Developer View で使う型 + Phase 1.2 移行用 label 定数。
//
// なぜ sample data から分離したか (R1 silent-failure-hunter I-1):
//  - sample-data は test fixture であり、`apps/web/test/_fixtures/` に置くのが project の慣習。
//  - production bundle に sample data が同梱されたまま残ると、Phase 1.2 で
//    `data ?? SAMPLE_*` のような silent fallback が誤って書かれた時に、本物の API 障害が
//    架空データで隠蔽される silent failure リスクがある。
//  - 型 + label 定数のみ production code 側に残し、SAMPLE_* は test fixture 側に隔離する。
//
// Phase 1.2 で実データに接続する際の置換ポイント:
//  - FileTree: GET /projects/:projectId/inventory + run context から関連 spec / Page Object / Fixture を導出
//  - Source/Diff/Terminal: GET /runs/:runId 経由の source + simple-git diff + WebSocket stdout/stderr
//  - Locator: ts-morph (PLAN.v2 §24, Phase 5/7) ベースの解析 or `playwright test --debug` 出力
//  - Console: WebSocket `run.stdout/stderr` ストリーム (run-console と同じ event source を再利用予定)
//  - RunMetadata: GET /runs/:runId (既存 endpoint)

export interface FileTreeGroup {
  /** ディレクトリ名 (見出し用)。trailing slash は表示時に付与する */
  readonly path: string;
  readonly items: ReadonlyArray<FileTreeItem>;
}

export interface FileTreeItem {
  readonly name: string;
  /** 現在 active な file (failure 中の spec など) を強調表示する */
  readonly current?: boolean;
  /** 失敗状態 (spec ファイル) */
  readonly failed?: boolean;
  /** Page Object / Fixture / Config 等の補足ラベル */
  readonly annotation?: string;
}

export interface SourceLine {
  /** 行番号表示 (- / + は diff 用なので string) */
  readonly lineNo: string;
  /** プレーンテキスト (シンタックスハイライトは Phase 1.2 で Monaco に委譲) */
  readonly text: string;
  readonly state?: "fail" | "added" | "removed";
}

export interface LocatorRow {
  readonly key: string;
  readonly value: string;
  readonly status?: "ok" | "miss";
}

/**
 * Locator inspector の入力。expression と検証 row 群を 1 単位として扱う named type。
 * inline anonymous shape を使うと `SAMPLE_LOCATOR` の構造と暗黙に drift しうるため named 化。
 */
export interface LocatorState {
  readonly expression: string;
  readonly rows: ReadonlyArray<LocatorRow>;
}

export interface ConsoleEntry {
  readonly timestamp: string;
  readonly level: "info" | "warn" | "error";
  readonly message: string;
}

/**
 * Run metadata 1 行 = (key, value) のペア。配列で順序を保つ。
 * Phase 1.2 で commit hash の link 化等で項目が拡張する場合は、object 化を検討する。
 */
export type RunMetadataRow = readonly [string, string];

/**
 * Phase 1.2 接続予定 badge の文言。
 * 実データに切り替えた際に必ず削除すべき UI 文字列を 1 箇所に集約し、
 * 全 badge が外れたかを grep で確認できるようにするための定数。
 *
 * Phase 1.2 で sample data を削除する際もこの const は最後まで残し、
 * 全 placeholder badge が外れたことを確認してから削除する。
 */
export const PHASE_1_2_PLACEHOLDER_LABEL = "Phase 1.2 で接続予定";

/**
 * Developer View 内で使用する UI 文言。文言を変える際の grep 起点として 1 箇所に集約する。
 * 同じ "ソース" が CardTitle (sourceTabs) と Tab (source) に登場するが、
 * test では `getByRole("tab", { name })` で scope を限定して ambiguous match を避ける。
 */
export const DEVELOPER_VIEW_LABELS = {
  fileTree: "関連ファイル",
  sourceTabs: "ソース",
  inspector: "検証",
  source: "ソース",
  diff: "差分",
  terminal: "ターミナル",
  locator: "Locator (失敗時の状態)",
  console: "Console (失敗中の出力)",
  runMetadata: "Run メタデータ"
} as const;

export type DeveloperViewLabel = keyof typeof DEVELOPER_VIEW_LABELS;
