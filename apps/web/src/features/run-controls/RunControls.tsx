// QA View 中央列の上半分: spec path / grep / Run ボタン。
// δ (Issue #11) で qa.tsx 内のローカル component を `apps/web/src/features/run-controls/` へ抽出
// (β で TODO marker を残していた箇所、ε の Developer View からも独立 mount できるよう features 化する)。
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

  // form submit 経路の useStartRunMutation は __root の rerun mutation と別 instance を取得する。
  // banner 表示先を独立させるため。
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
    if (!project) return;
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
