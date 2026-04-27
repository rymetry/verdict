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

import { fetchCurrentProject, fetchHealth, fetchRun } from "@/api/client";
import { ShellAlert, StatusBar, TopBar } from "@/components/shell";
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

  const persona = pathnameToPersona(location.pathname) ?? "qa";

  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
    refetchInterval: 5_000
  });

  const currentProjectQuery = useQuery({
    queryKey: ["projects", "current"],
    queryFn: fetchCurrentProject
  });

  // active run のメタ (status / 完了時刻 等) を取得し、TopBar の status badge に反映する。
  // - queryFn は activeRunId が string であることを enabled でゲートしてから呼ぶ。
  //   TanStack v5 内部で enabled は信頼できるが、defense-in-depth として queryFn 内でも
  //   type guard を入れ、万一 enabled が破られた場合は silent return ではなく throw して可視化する。
  // - refetchInterval は run 中 (running / queued) は 2 秒、それ以外は止める。
  const activeRunQuery = useQuery({
    queryKey: ["runs", activeRunId],
    queryFn: () => {
      if (typeof activeRunId !== "string" || activeRunId.length === 0) {
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
      if (!canRerun || lastRequest === null) {
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

  function dismissActiveRunError(): void {
    const dismissedId = activeRunId;
    if (dismissedId) {
      // in-flight refetch があれば cancel してから cache を消す (race 対策)
      void queryClient.cancelQueries({ queryKey: ["runs", dismissedId], exact: true });
    }
    clearActiveRun();
    if (dismissedId) {
      queryClient.removeQueries({ queryKey: ["runs", dismissedId], exact: true });
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
