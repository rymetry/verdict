// QA / Developer / Insights の表示ペルソナを保持する小さな store。
// - β (Issue #9) 時点では in-memory のみ。永続化はあえて行わない:
//   γ (Issue #10) で TanStack Router を導入すると persona は URL segment に移行するため、
//   localStorage 経路と URL 経路で二重 source of truth になる事態を避ける。
// - app-store と分離する理由: theme と persona は更新頻度・購読粒度が異なり、
//   selector subscribe の最適化単位を崩したくないため (η の SRP 方針を踏襲)。
import { create } from "zustand";
import { devtools } from "zustand/middleware";

import { isDev } from "./env";

/** Workbench がサポートする persona view の値域 */
export const PERSONA_VIEWS = ["qa", "dev", "qmo"] as const;
export type PersonaView = (typeof PERSONA_VIEWS)[number];

/** PersonaView の値域 guard (URL 由来の値検証などにも使う) */
export function isPersonaView(value: unknown): value is PersonaView {
  return (
    typeof value === "string" &&
    (PERSONA_VIEWS as ReadonlyArray<string>).includes(value)
  );
}

interface PersonaState {
  persona: PersonaView;
  setPersona: (next: PersonaView) => void;
}

export const usePersonaStore = create<PersonaState>()(
  devtools(
    (set) => ({
      persona: "qa",
      setPersona: (next) => {
        set({ persona: next }, false, "persona/setPersona");
      }
    }),
    { name: "PersonaStore", enabled: isDev }
  )
);
