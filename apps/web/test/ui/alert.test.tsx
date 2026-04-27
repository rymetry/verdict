// Alert primitive のテスト。Phase 1 では PM 検出失敗 / Run ブロック警告などで使う重要 UI。
// variant ごとに class が反映されること、role="alert" が付くこと (a11y) を保証する。
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

describe("<Alert />", () => {
  it("default variant + role=alert を持つ", () => {
    render(
      <Alert>
        <AlertTitle>通知</AlertTitle>
        <AlertDescription>本文</AlertDescription>
      </Alert>
    );
    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(screen.getByText("通知")).toBeInTheDocument();
    expect(screen.getByText("本文")).toBeInTheDocument();
  });

  it("info variant は --info-soft 系のクラスを持つ", () => {
    render(<Alert variant="info">情報</Alert>);
    expect(screen.getByRole("alert")).toHaveClass("bg-[var(--info-soft)]");
  });

  it("warning variant は --flaky-soft 系 (黄系) のクラスを持つ", () => {
    render(<Alert variant="warning">注意</Alert>);
    expect(screen.getByRole("alert")).toHaveClass("bg-[var(--flaky-soft)]");
  });

  it("destructive variant は --fail-soft 系のクラスを持つ", () => {
    render(<Alert variant="destructive">エラー</Alert>);
    expect(screen.getByRole("alert")).toHaveClass("bg-[var(--fail-soft)]");
  });
});
