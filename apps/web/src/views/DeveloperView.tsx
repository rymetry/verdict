/**
 * Developer View — Phase 1 では static placeholder。
 * Phase 1.2+ で代表 failure を選択 → コードビューア / Locator inspector / Console
 * / Run metadata を実データに繋ぎ込み。
 */
export function DeveloperView() {
  return (
    <div className="view view-dev">
      <section className="col" aria-label="関連ファイル">
        <div className="col-header">
          <div className="col-title">関連ファイル</div>
          <div className="col-counter">—</div>
        </div>
        <div className="col-body" style={{ padding: 16 }}>
          <PlaceholderCard
            title="関連ファイル"
            note="失敗テストに関与する spec / page object / fixture / config を表示。"
            phase="Phase 1.2"
          />
        </div>
      </section>

      <section className="col" aria-label="ソース / 差分 / ターミナル">
        <div className="col-header">
          <div className="col-title">ソース</div>
          <div className="col-counter">—</div>
        </div>
        <div className="col-body" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <PlaceholderCard
            title="ソースビューア"
            note="行番号付き表示、失敗行ハイライト、Git diff (前回 passing run との差分)、ターミナル出力タブ。"
            phase="Phase 1.2"
          />
          <PlaceholderCard
            title="再実行コマンド"
            note="PackageManagerDetector が解決した正規コマンドを 1 行で表示し、コピー可能。"
            phase="Phase 1 (QA View で実装済み)"
          />
        </div>
      </section>

      <aside className="col" aria-label="検証">
        <div className="col-header">
          <div className="col-title">検証</div>
          <div className="col-counter">—</div>
        </div>
        <div className="col-body" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <PlaceholderCard
            title="Locator inspector"
            note="失敗時点の DOM スナップショットから locator 解決状態 (visible / enabled / matched) を抽出。"
            phase="Phase 1.2"
          />
          <PlaceholderCard
            title="Console / Network"
            note="ブラウザの console と失敗時のネットワークリクエストを並行表示 (failed requests を強調)。"
            phase="Phase 1.2"
          />
          <PlaceholderCard
            title="Run メタデータ"
            note="Run ID / Branch / Commit / OS / Browser / Worker などの実行コンテキスト。"
            phase="Phase 1 (QA View 経由で取得可能)"
          />
        </div>
      </aside>
    </div>
  );
}

interface PlaceholderCardProps {
  title: string;
  note: string;
  phase: string;
}

function PlaceholderCard({ title, note, phase }: PlaceholderCardProps) {
  return (
    <div className="locator-card">
      <h4>{title}</h4>
      <div>
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, color: "var(--ink-1)" }}>{note}</p>
        <p
          style={{
            margin: "10px 0 0",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "3px 9px",
            border: "1px solid color-mix(in oklch, var(--accent) 40%, transparent)",
            borderRadius: 999,
            background: "var(--accent-soft)",
            color: "var(--accent)",
            fontFamily: "var(--mono)",
            fontSize: 11
          }}
        >
          {phase}
        </p>
      </div>
    </div>
  );
}
