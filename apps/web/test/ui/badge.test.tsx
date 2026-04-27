// Badge primitive のステータス variant テスト (色相分離が壊れていないこと)
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Badge } from "@/components/ui/badge";

describe("<Badge />", () => {
  it("pass variant は --pass 系のクラスを持つ", () => {
    render(<Badge variant="pass">合格</Badge>);
    const badge = screen.getByText("合格");
    expect(badge).toHaveClass("bg-[var(--pass-soft)]");
    expect(badge).toHaveClass("text-[var(--pass)]");
  });

  it("fail variant は --fail 系のクラスを持つ", () => {
    render(<Badge variant="fail">失敗</Badge>);
    const badge = screen.getByText("失敗");
    expect(badge).toHaveClass("bg-[var(--fail-soft)]");
  });

  it("flaky variant は --flaky 系のクラスを持つ", () => {
    render(<Badge variant="flaky">flaky</Badge>);
    const badge = screen.getByText("flaky");
    expect(badge).toHaveClass("bg-[var(--flaky-soft)]");
  });

  it("variant 未指定時は default のクラスが付く", () => {
    render(<Badge>中立</Badge>);
    const badge = screen.getByText("中立");
    expect(badge).toHaveClass("bg-[var(--bg-2)]");
  });
});
