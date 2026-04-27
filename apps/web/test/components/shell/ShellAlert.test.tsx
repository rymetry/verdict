// ShellAlert のレンダリングと dismiss 操作を検証する。
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ShellAlert } from "@/components/shell/ShellAlert";

afterEach(() => cleanup());

describe("ShellAlert", () => {
  it("role=alert + メッセージ本文を描画する", () => {
    render(<ShellAlert message="再実行に失敗しました" />);
    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent("再実行に失敗しました");
  });

  it("onDismiss が無い場合は閉じるボタンを描画しない", () => {
    render(<ShellAlert message="error" />);
    expect(screen.queryByRole("button", { name: "通知を閉じる" })).not.toBeInTheDocument();
  });

  it("onDismiss が指定されたら閉じるボタンを描画してクリックで呼ばれる", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<ShellAlert message="error" onDismiss={onDismiss} />);
    const closeBtn = screen.getByRole("button", { name: "通知を閉じる" });
    expect(closeBtn).toBeInTheDocument();
    await user.click(closeBtn);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
