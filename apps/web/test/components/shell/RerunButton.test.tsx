// RerunButton の disabled 条件と onRerun 呼び出しを検証する。
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RerunButton } from "@/components/shell/RerunButton";

afterEach(() => cleanup());

describe("RerunButton", () => {
  it("canRerun=false なら disabled", () => {
    render(<RerunButton canRerun={false} onRerun={vi.fn()} />);
    expect(screen.getByRole("button", { name: /再実行/ })).toBeDisabled();
  });

  it("canRerun=true なら有効", () => {
    render(<RerunButton canRerun onRerun={vi.fn()} />);
    expect(screen.getByRole("button", { name: /再実行/ })).toBeEnabled();
  });

  it("isRunning=true なら disabled かつ ラベルが '実行中…'", () => {
    render(<RerunButton canRerun isRunning onRerun={vi.fn()} />);
    const btn = screen.getByRole("button", { name: /実行中/ });
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent("実行中…");
  });

  it("クリックで onRerun が呼ばれる", async () => {
    const user = userEvent.setup();
    const onRerun = vi.fn();
    render(<RerunButton canRerun onRerun={onRerun} />);
    await user.click(screen.getByRole("button", { name: /再実行/ }));
    expect(onRerun).toHaveBeenCalledTimes(1);
  });

  it("disabled 状態ではクリックしても onRerun が呼ばれない", async () => {
    const user = userEvent.setup();
    const onRerun = vi.fn();
    render(<RerunButton canRerun={false} onRerun={onRerun} />);
    await user.click(screen.getByRole("button", { name: /再実行/ }));
    expect(onRerun).not.toHaveBeenCalled();
  });
});
