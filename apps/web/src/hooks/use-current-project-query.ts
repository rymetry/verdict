// `GET /api/projects/current` の TanStack Query 共通フック。
// __root.tsx (TopBar の breadcrumb / StatusBar の表示用) と routes/qa.tsx (Run controls の有効化判定)
// で同じ queryKey / queryFn を二重定義していた DRY 違反を解消するために抽出した。
// 実 fetch は React Query 側で queryKey 単位に dedupe されるため、片方が忘れて queryKey や queryFn を
// ズラした場合の silent regression を型レベル + コードパス単一化で防ぐのが本フックの役割。
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { ProjectSummary } from "@pwqa/shared";

import { fetchCurrentProject } from "@/api/client";

export function useCurrentProjectQuery(): UseQueryResult<ProjectSummary | null, Error> {
  return useQuery({
    queryKey: ["projects", "current"],
    queryFn: fetchCurrentProject
  });
}
