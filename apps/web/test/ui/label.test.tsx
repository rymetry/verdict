// Label primitive のスモークテスト。htmlFor が <label> 標準として機能することを pin する
// (a11y 上、Input と Label を結ぶ最小契約)。
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

describe("Label", () => {
  it("htmlFor で input と関連付けられる", () => {
    render(
      <>
        <Label htmlFor="foo">プロジェクト</Label>
        <Input id="foo" />
      </>
    );
    const input = screen.getByLabelText("プロジェクト");
    expect(input).toBeInstanceOf(HTMLInputElement);
  });

  it("text-ink-2 トークンを採用する", () => {
    render(<Label data-testid="l">name</Label>);
    expect(screen.getByTestId("l").className).toMatch(/text-\[var\(--ink-2\)\]/);
  });
});
