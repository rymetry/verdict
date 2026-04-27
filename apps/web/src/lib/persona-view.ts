// Persona view (qa / dev / qmo) の値域とガード。
// γ (Issue #10) で persona の真の所在は URL segment へ移行した。
// store を介さず URL から派生させるため、値域定義はここに集約し、
// router / URL parse / Tabs 値検証など複数経路で共有する。
//
// 履歴: β 段階では `apps/web/src/store/persona-store.ts` に同等定数を持っていたが、
// γ で persona-store を廃止したため lib に昇格させた。

/** Workbench がサポートする persona view の値域 (URL segment と一致) */
export const PERSONA_VIEWS = ["qa", "dev", "qmo"] as const;
export type PersonaView = (typeof PERSONA_VIEWS)[number];

/**
 * PersonaView の値域 guard。
 * Radix Tabs の onValueChange が流す任意 string を狭めるなど、
 * URL / DOM など信頼境界外の値を受け取る経路で使う。
 */
export function isPersonaView(value: unknown): value is PersonaView {
  return (
    typeof value === "string" &&
    (PERSONA_VIEWS as ReadonlyArray<string>).includes(value)
  );
}
