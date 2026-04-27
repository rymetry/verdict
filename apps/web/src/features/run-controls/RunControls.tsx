// QA View 中央列の上半分: spec path / grep / Run ボタン。
// δ (Issue #11) で routes/qa.tsx 内の inline 定義を `apps/web/src/features/run-controls/` へ抽出した。
// ε (Issue #12) の Developer View からも同一コンポーネントを mount できる構造を意図している。
//
// silent failure ガード:
//  - mutation.error は React Query が保持し、UI banner で表示 (formatMutationError 経由)
//  - mutation 自体は useStartRunMutation 内で console.error 済 (defense-in-depth)
//  - 入力編集で前回 error を reset し、stale error の固着を避ける
import * as React from "react";
import type { ProjectSummary, RunRequest } from "@pwqa/shared";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useStartRunMutation } from "@/hooks/use-start-run-mutation";
import { formatMutationError } from "@/lib/mutation-error";

interface RunControlsProps {
  /** 現在開いているプロジェクト。null の間は controls を disabled 表示にする。 */
  project: ProjectSummary | null;
}

export function RunControls({ project }: RunControlsProps): React.ReactElement {
  const [specPath, setSpecPath] = React.useState("");
  const [grep, setGrep] = React.useState("");

  // useStartRunMutation は呼び出し毎に独立した React Query mutation instance を作る (別の error /
  // pending state を持つ)。__root の rerun mutation と本コンポーネントの form submit mutation が
  // 別 banner に流れるよう、ここで独立 instance を取得する。
  const startMutation = useStartRunMutation();

  const errorMessage = startMutation.error
    ? formatMutationError(startMutation.error, "Failed to start run")
    : null;

  // 入力編集で前回 error を解除する (dismiss UX dead-end 回避)。
  function clearErrorOnEdit(): void {
    if (startMutation.error) {
      startMutation.reset();
    }
  }

  if (!project) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Run controls</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[var(--ink-3)]">プロジェクトを開くと実行できます。</p>
        </CardContent>
      </Card>
    );
  }

  const blocked = project.blockingExecution;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    // 上の `if (!project) return <Card>...` 分岐で project は実行時には non-null。
    // しかし TypeScript は handleSubmit closure に対して narrow を保てないため、
    // 明示的に invariant ガードを置く。null 到達は invariant 違反なので silent return せず log する。
    if (project === null) {
      // eslint-disable-next-line no-console -- 到達不能経路を本番でも検知
      console.error("[RunControls] handleSubmit reached with project=null (invariant violation)");
      return;
    }
    const request: RunRequest = {
      projectId: project.id,
      specPath: specPath.trim() || undefined,
      grep: grep.trim() || undefined,
      headed: false
    };
    startMutation.mutate(request);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Run controls</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="spec-path">Spec path (relative; optional)</Label>
            <Input
              id="spec-path"
              placeholder="tests/auth.spec.ts"
              value={specPath}
              onChange={(event) => {
                setSpecPath(event.target.value);
                clearErrorOnEdit();
              }}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="grep">Grep pattern (optional)</Label>
            <Input
              id="grep"
              placeholder="@smoke"
              value={grep}
              onChange={(event) => {
                setGrep(event.target.value);
                clearErrorOnEdit();
              }}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="flex justify-end pt-1">
            <Button type="submit" disabled={blocked || startMutation.isPending}>
              {startMutation.isPending ? "Starting…" : "Run Playwright"}
            </Button>
          </div>
        </form>
        {blocked ? (
          <Alert variant="warning" className="mt-3">
            <AlertTitle>実行ブロック中</AlertTitle>
            <AlertDescription>
              Package manager の状態がユーザー解決を要求しています。
            </AlertDescription>
          </Alert>
        ) : null}
        {errorMessage ? (
          <Alert variant="destructive" className="mt-3">
            <AlertTitle>起動失敗</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}
