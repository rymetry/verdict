// `GET /api/projects/current` の TanStack Query 共通フック。
// __root.tsx (TopBar の breadcrumb / StatusBar の表示用) と routes/qa.tsx (Run controls の有効化判定)
// で同じ queryKey / queryFn を二重定義していた DRY 違反を解消するために抽出した。
// 実 fetch は React Query 側で queryKey 単位に dedupe されるため、片方が忘れて queryKey や queryFn を
// ズラした場合の silent regression を型レベル + コードパス単一化で防ぐのが本フックの役割。
//
// silent failure 防衛: 呼び出し側は `query.data ?? null` のみ参照しており、
// `query.error` を明示的に surface していない。これは Phase 1 の意図 (project 未オープン時と
// fetch 失敗時を区別せず "プロジェクト未選択 UI" を見せる) だが、サーバ落ちなどを sysadmin が
// 観測できないと診断不能。defense-in-depth として hook 内で console.error を出す。
import { useEffect } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { ProjectSummary } from "@pwqa/shared";

import { fetchCurrentProject } from "@/api/client";

export function useCurrentProjectQuery(): UseQueryResult<ProjectSummary | null, Error> {
  const query = useQuery({
    queryKey: ["projects", "current"],
    queryFn: fetchCurrentProject
  });

  // React Query v5 は useQuery レベルの `onError` callback を廃止した。
  // 代替として error 状態を effect で観察し、production でも console.error する。
  // status === "error" が立ったタイミングで一度だけ log するため依存に error を入れる。
  useEffect(() => {
    if (query.status === "error" && query.error) {
      // eslint-disable-next-line no-console -- project 取得失敗を本番でも痕跡を残す
      console.error("[useCurrentProjectQuery] fetchCurrentProject failed", query.error);
    }
  }, [query.status, query.error]);

  return query;
}
