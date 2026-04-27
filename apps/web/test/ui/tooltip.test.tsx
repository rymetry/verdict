// Tooltip primitive スモークテスト。
// Radix Portal は jsdom で完全には再現できないため、import の健全性と
// Trigger の DOM レンダリングだけを確認する最小限のテスト。
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip";

describe("<Tooltip />", () => {
  it("Trigger が描画され、ボタンとしてアクセスできる", () => {
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button">トリガ</button>
          </TooltipTrigger>
          <TooltipContent>本文</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
    expect(screen.getByRole("button", { name: "トリガ" })).toBeInTheDocument();
  });
});
