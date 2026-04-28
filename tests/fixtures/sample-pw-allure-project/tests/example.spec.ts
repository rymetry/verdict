import { test, expect } from "@playwright/test";

// T201 fixture: passing + failing の両方を含めることで、Phase 1.2 の
// AllureReportProvider / Quality Gate / known-issues / failure review
// 各機能を validate する基礎 dataset を提供する。
// failing test を残すのは意図的: T204 の HTML 生成 / T205 の Quality Gate
// 動作確認 / T207 の QMO summary における failure 表現を検証するため。

test("passes a trivial assertion @smoke", async () => {
  expect(1 + 1).toBe(2);
});

test("fails a trivial assertion (intentional, for quality-gate validation)", async () => {
  // この test は **意図的に failing**。Workbench の Phase 1.2 機能群
  // (Allure Quality Gate, failure review, known-issues) の動作検証で
  // 「実際の failed test result」を提供する役割を持つ。
  // Phase 1.2 完了後は known-issues.json に登録するか、別 spec に分離する
  // 判断を Phase 1.2 締め時点で行う (T201 設計メモ参照)。
  expect(1 + 1).toBe(3);
});
