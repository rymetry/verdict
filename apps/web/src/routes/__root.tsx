// app-shell route。TopBar / ShellAlert / StatusBar を常時 mount し、
// `<Outlet />` 配下に persona view (qa/dev/qmo) を切り替える。
//
// γ (Issue #10) で App.tsx の責務を分割した:
//  - shell layout (TopBar + ShellAlert + StatusBar) → 本ファイル
//  - rerun mutation + activeRunQuery + healthQuery → 本ファイル (TopBar の入力に必要)
//  - QA / Developer / Insights view 本体 → src/routes/{qa,dev,qmo}.tsx
//
// 設計決定:
//  - persona は URL segment (`/qa` `/dev` `/qmo`) を Single Source of Truth とする。
//    store (β の persona-store) は廃止。`useLocation()` から派生させる。
//  - `r` キーボードショートカットは __root に集約。canRerun / rerun トリガが
//    TopBar と同じスコープに居るので、shortcut 配線は本ファイルが最も自然。
//  - useWorkbenchEvents は qa.tsx に閉じる。Phase 1 では RunConsole のみが consumer のため、
//    qa を離れた瞬間に WS をクローズしても情報損失はない。
import * as React from "react";
import { createRootRoute, Outlet, useLocation } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchHealth, fetchRun } from "@/api/client";
import { ShellAlert, StatusBar, TopBar } from "@/components/shell";
import { useCurrentProjectQuery } from "@/hooks/use-current-project-query";
import { useStartRunMutation } from "@/hooks/use-start-run-mutation";
import { deriveAgentState, deriveProjectDisplayName } from "@/lib/shell-derive";
import { formatMutationError } from "@/lib/mutation-error";
import { isPersonaView, type PersonaView } from "@/lib/persona-view";
import { useAppStore } from "@/store/app-store";
import { useRunStore } from "@/store/run-store";

// vite.config.ts の dev proxy 先と一致させているローカル Agent エンドポイント表示。
// Phase 1 はローカル固定。複数環境対応や /health からの動的取得は別 issue (η/Open Question 経路)。
const AGENT_ENDPOINT_DISPLAY = "127.0.0.1:4317";

/**
 * URL pathname の先頭 segment から PersonaView を派生する。
 *  - "/qa" "/qa/..." → "qa"
 *  - "/dev" "/dev/..." → "dev"
 *  - "/qmo" "/qmo/..." → "qmo"
 *  - 想定外パス (`/`, `/foo` 等) → null
 *
 * `/` (index) は indexRoute の loader が `/qa` に redirect するため通常 null は到達しない。
 * 念のため null 返却にして、TopBar 側は null 時に既定値 (qa) を表示する。
 */
export function pathnameToPersona(pathname: string): PersonaView | null {
  const seg = pathname.split("/")[1] ?? "";
  return isPersonaView(seg) ? seg : null;
}

/**
 * `r` ショートカットを発火させない要素か判定する。
 *  - <input> / <textarea> / contenteditable な要素にフォーカスがあるとき
 *  - 修飾キー (meta/ctrl/alt) との組み合わせのとき
 * 上記いずれかに該当する場合は通常のキー入力 / ブラウザショートカットを尊重する。
 */
function shouldIgnoreShortcut(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return true;
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

function RootLayout(): React.ReactElement {
  const queryClient = useQueryClient();
  const location = useLocation();

  const activeRunId = useRunStore((s) => s.activeRunId);
  const lastRequest = useRunStore((s) => s.lastRequest);
  const clearActiveRun = useRunStore((s) => s.clearActive);

  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);

  // PERSONA segment が pathname から取れない場合は QA を見せる (画面の「無 persona 状態」を作らない)。
  // 通常 indexRoute の redirect (routes/index.tsx の beforeLoad → "/qa") が `/` を捕捉するため、
  // ここに来るのは catch-all 等で想定外パスが __root に流れた時のみ。silent fallback は
  // デバッグ性を損ねるため warning する。
  // 注意: `!== "/"` ガードは indexRoute redirect の解決前 frame で warn が誤発火しないため。
  // routes/index.tsx の redirect 先 ("/qa") を変更した場合、この `/` ガードは見直し対象 (記録漏れ防止)。
  const personaFromPath = pathnameToPersona(location.pathname);
  if (personaFromPath === null && location.pathname !== "/") {
    // eslint-disable-next-line no-console -- 想定外パスは本番でも痕跡を残す (route 設定の漏れ検知)
    console.warn(`[RootLayout] pathname '${location.pathname}' not mapped to a persona — falling back to qa`);
  }
  const persona = personaFromPath ?? "qa";

  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
    refetchInterval: 5_000
  });

  // health が落ちたとき UI には agentState=unreachable で見えるが、サーバ側では
  // Agent process の死亡を即知りたい。defense-in-depth として error は console.error する。
  // refetchInterval で 5 秒ごとに同じ error が発火するため、error message を memoize して
  // 同一 message が連続したら抑制する (log 洪水防止)。
  const lastHealthErrorRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (healthQuery.status === "error" && healthQuery.error) {
      const msg = healthQuery.error.message;
      if (lastHealthErrorRef.current !== msg) {
        lastHealthErrorRef.current = msg;
        // eslint-disable-next-line no-console -- agent 死亡を本番でも痕跡を残す
        console.error("[RootLayout] healthQuery failed", healthQuery.error);
      }
    } else if (healthQuery.status === "success") {
      // 復活したら次回失敗で再 log するためリセット
      lastHealthErrorRef.current = null;
    }
  }, [healthQuery.status, healthQuery.error]);

  const currentProjectQuery = useCurrentProjectQuery();

  // active run のメタ (status / 完了時刻 等) を取得し、TopBar の status badge に反映する。
  // - queryFn は activeRunId が string であることを enabled でゲートしてから呼ぶ。
  //   TanStack v5 内部で enabled は信頼できるが、defense-in-depth として queryFn 内でも
  //   type guard を入れ、万一 enabled が破られた場合は silent return ではなく throw して可視化する。
  //   throw は React Query の error state へ流れて UI banner で見えるが、production 環境の
  //   診断のためには console.error も別経路で残す (silent failure 防衛 + invariant 違反の追跡)。
  // - refetchInterval は run 中 (running / queued) は 2 秒、それ以外は止める。
  const activeRunQuery = useQuery({
    queryKey: ["runs", activeRunId],
    queryFn: () => {
      if (typeof activeRunId !== "string" || activeRunId.length === 0) {
        // invariant: enabled=false で queryFn は呼ばれない契約。ここに来たら React Query
        // 内部の enabled 評価がズレた / 値域違反のいずれか。本番でも痕跡を残す。
        // eslint-disable-next-line no-console -- invariant 違反は production でも検知したい
        console.error("[RootLayout] activeRunQuery invariant: queryFn called with invalid activeRunId");
        throw new Error("activeRunQuery: activeRunId が不正なまま queryFn が呼ばれた");
      }
      return fetchRun(activeRunId);
    },
    enabled: typeof activeRunId === "string" && activeRunId.length > 0,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "running" || status === "queued" ? 2_000 : false;
    }
  });
  const activeRun = activeRunQuery.data ?? null;

  const project = currentProjectQuery.data ?? null;
  const projectDisplayName = project ? deriveProjectDisplayName(project.rootPath) : null;
  const agentState = deriveAgentState(healthQuery.data, healthQuery.error);

  // shell 上の "再実行" は最後に投入した RunRequest を再送する。
  // running 中は disabled (RerunButton 側でも isRunning 表示)。
  // Phase 1 では server に専用 rerun endpoint を持たないため client で lastRequest を保持して再送する。
  const rerunMutation = useStartRunMutation();

  const isActiveRunRunning = activeRun?.status === "running" || activeRun?.status === "queued";
  const canRerun = lastRequest !== null && !rerunMutation.isPending && !isActiveRunRunning;

  // mutation のエラーを UI banner に反映する文字列。
  // - dismiss は `rerunMutation.reset()` で React Query 側 error を直接クリアする。
  //   独自に dismiss state を持つと caller (mutate) と responder (dismiss) で
  //   error 状態の source-of-truth が分裂し、retry / 同種エラー再発時に silent regression を起こす。
  // - 失敗回数が変わるたびに ShellAlert を再 mount するため `key={failureCount}` を付与し、
  //   role="alert" の re-announce + 視覚フィードバック (フリッカー) を効かせる。
  const rerunErrorMessage = rerunMutation.error
    ? formatMutationError(rerunMutation.error, "再実行に失敗しました")
    : null;

  // active run 取得失敗の通知。
  // dismiss は **active run の追跡を停止** する設計:
  //   `refetch()` だと server がまだ落ちている場合 banner が即座に再表示され UX dead-end になる。
  //   `removeQueries` だけでも `enabled=true` のまま即時 refetch されて同じ問題が起きる。
  //   `clearActive()` で activeRunId を null にすれば query は disabled になり banner も消える
  //   (= ユーザが「この run はもう追わなくて良い」と意思表示する dismiss セマンティクス)。
  const activeRunErrorMessage = activeRunQuery.error
    ? formatMutationError(
        activeRunQuery.error,
        `Run #${activeRunId ?? "?"} の状態取得に失敗しました`
      )
    : null;

  // canRerun / lastRequest / mutation が変わるたびに最新値をハンドラから参照できるよう ref で保持する。
  // useEffect の依存配列に値を入れると key listener を頻繁に再 attach することになり、本物のキー入力
  // イベントを取りこぼす race を生む。ref 経路ならハンドラ identity は固定で、最新値だけ closure 越しに見える。
  // ref の更新は `useEffect` で行う: render 中の direct assignment は StrictMode で副作用 anti-pattern に
  // 該当する (二重呼び出し下で意図しない closure を残す)。
  const triggerRerunRef = React.useRef<() => void>(() => {});
  React.useEffect(() => {
    triggerRerunRef.current = () => {
      // canRerun=false は通常のガード (実行中 / lastRequest=null) で silent OK。
      // しかし canRerun=true && lastRequest=null は invariant 違反 (`canRerun` の組み立てが壊れている)。
      // ボタン経路 (handleRerun 下方) と同じ警告を出して、キーボード経路と挙動を対称にする。
      if (!canRerun) return;
      if (lastRequest === null) {
        // eslint-disable-next-line no-console -- invariant 違反は production でも検知したい
        console.error("[RootLayout] keyboard rerun: lastRequest=null with canRerun=true");
        return;
      }
      rerunMutation.mutate(lastRequest);
    };
  });

  // `r` キーボードショートカット。listener は __root のライフサイクルに固定する。
  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== "r" && event.key !== "R") return;
      if (shouldIgnoreShortcut(event)) return;
      // ブラウザ標準動作 (例: Cmd-R reload は metaKey で既に除外済) とは別に、
      // input でないテキストエリアでの "r" 入力もここに来ない設計のため preventDefault は不要。
      triggerRerunRef.current();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function handleRerun(): void {
    if (lastRequest === null) {
      // canRerun=false で disabled になっている前提。invariant 違反だが、
      // event handler 内 throw は React Error Boundary に拾われず production で silent
      // (window.onerror 経由) になりうる。安全な no-op + console.error で可視化する。
      // eslint-disable-next-line no-console -- invariant 違反は production でも検知したい
      console.error("[RootLayout] RerunButton.onRerun: lastRequest=null with canRerun=true");
      return;
    }
    rerunMutation.mutate(lastRequest);
  }

  async function dismissActiveRunError(): Promise<void> {
    // 全体を try/catch で包むのは「ShellAlert.onDismiss が `() => void` 型で受け取るため
    // async 関数が返す Promise の rejection は unhandledrejection に流れる」点を防衛するため。
    // 現状 clearActiveRun / removeQueries は同期的に throw しないが、将来仕様変更で throw
    // 経路が増えても silent rejection を window.onunhandledrejection に流さない。
    try {
      const dismissedId = activeRunId;
      if (dismissedId) {
        // in-flight refetch があれば **完了を await** してから cache を消す (race 対策)。
        // ここを `void cancelQueries(...)` にしていた頃は cancel が完了する前に removeQueries が走り、
        // 直後に解決した queryFn が cache を再 populate して banner が再表示される race を起こしうる。
        // 内側の try/catch でログを出すのは silent failure 防衛: cancel が rejection で終わっても
        // dismiss 経路は続行 (clearActive + removeQueries は副作用が少ない) する。
        try {
          await queryClient.cancelQueries({ queryKey: ["runs", dismissedId], exact: true });
        } catch (error) {
          // eslint-disable-next-line no-console -- cancel rejection は本番でも痕跡を残す
          console.error("[RootLayout] cancelQueries failed during dismiss", error);
        }
      }
      clearActiveRun();
      if (dismissedId) {
        queryClient.removeQueries({ queryKey: ["runs", dismissedId], exact: true });
      }
    } catch (error) {
      // 想定外の同期 throw (clearActive 等の将来変更 / store 内部例外) を unhandledrejection
      // に流さず可視化する。silent failure 防衛 + UI 遷移は continue する。
      // eslint-disable-next-line no-console -- dismiss 経路の想定外失敗を本番でも痕跡を残す
      console.error("[RootLayout] dismissActiveRunError unexpected failure", error);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg-0)] text-[var(--ink-0)]">
      <TopBar
        projectName={projectDisplayName}
        activeRunId={activeRunId}
        activeRunStatus={activeRun?.status ?? null}
        persona={persona}
        theme={theme}
        onThemeChange={setTheme}
        canRerun={canRerun}
        isRunning={rerunMutation.isPending || isActiveRunRunning}
        onRerun={handleRerun}
      />

      {rerunErrorMessage ? (
        <ShellAlert
          // 失敗回数が変わるたびに DOM を再 mount し、role="alert" を再 announce + 視覚フリッカーを起こす
          key={`rerun-${rerunMutation.failureCount}`}
          message={rerunErrorMessage}
          onDismiss={() => rerunMutation.reset()}
        />
      ) : null}
      {activeRunErrorMessage ? (
        <ShellAlert
          key={`active-run-${activeRunQuery.failureCount}`}
          message={activeRunErrorMessage}
          onDismiss={dismissActiveRunError}
        />
      ) : null}

      <main className="shell flex-1">
        <Outlet />
      </main>

      <StatusBar
        agentState={agentState}
        agentVersion={healthQuery.data?.version}
        agentEndpoint={AGENT_ENDPOINT_DISPLAY}
        projectName={projectDisplayName}
        packageManager={project?.packageManager.name ?? null}
        activeRunId={activeRunId}
      />
    </div>
  );
}

export const rootRoute = createRootRoute({
  component: RootLayout
});
