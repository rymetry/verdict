// Button primitive の振る舞いテスト
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Button, buttonVariants } from "@/components/ui/button";

describe("<Button />", () => {
  it("デフォルト variant でレンダリングできる", () => {
    render(<Button>再実行</Button>);
    const button = screen.getByRole("button", { name: "再実行" });
    expect(button).toBeInTheDocument();
    expect(button).toHaveClass("bg-[var(--cta)]");
  });

  it("outline variant では cta 背景が付かない", () => {
    render(<Button variant="outline">キャンセル</Button>);
    const button = screen.getByRole("button", { name: "キャンセル" });
    expect(button).not.toHaveClass("bg-[var(--cta)]");
    expect(button).toHaveClass("border");
  });

  it("disabled 属性でクリックが発火しない", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        無効
      </Button>
    );
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("クリック時に onClick が呼ばれる", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>実行</Button>);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("size variant が h-* クラスへ反映される", () => {
    render(<Button size="lg">大</Button>);
    expect(screen.getByRole("button")).toHaveClass("h-10");
  });

  it("size=icon で正方形クラスが付く", () => {
    render(<Button size="icon" aria-label="icon" />);
    expect(screen.getByRole("button")).toHaveClass("w-9");
    expect(screen.getByRole("button")).toHaveClass("h-9");
  });

  it("variant=link はテキストリンクスタイル", () => {
    render(<Button variant="link">詳細</Button>);
    expect(screen.getByRole("button")).toHaveClass("text-[var(--accent)]");
  });

  it("buttonVariants() がクラス文字列を返す", () => {
    const cls = buttonVariants({ variant: "destructive", size: "sm" });
    expect(cls).toContain("bg-[var(--fail)]");
    expect(cls).toContain("h-8");
  });

  it("asChild=true で渡した <a> が button スタイルを引き継ぐ (Slot 経路)", () => {
    render(
      <Button asChild>
        <a href="/x">リンク</a>
      </Button>
    );
    const link = screen.getByRole("link", { name: "リンク" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveClass("bg-[var(--cta)]");
  });
});
