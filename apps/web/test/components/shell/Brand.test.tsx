// Brand の表示・aria 属性・version 注入を検証する。
import { describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";

import { Brand } from "@/components/shell/Brand";

afterEach(() => cleanup());

describe("Brand", () => {
  it("ブランド名を表示する", () => {
    render(<Brand version="9.9.9" />);
    expect(screen.getByText("Playwright Workbench")).toBeInTheDocument();
  });

  it("version prop が与えられたら brand-sub に反映する", () => {
    render(<Brand version="9.9.9" environmentLabel="ci" />);
    expect(screen.getByText(/v9\.9\.9/)).toBeInTheDocument();
    expect(screen.getByText(/ci/)).toBeInTheDocument();
  });

  it("ブランドマーク P は装飾扱いで aria-hidden", () => {
    render(<Brand version="0.1.0" />);
    const mark = screen.getByText("P");
    expect(mark).toHaveAttribute("aria-hidden", "true");
  });

  it("__APP_VERSION__ が注入されている場合は default として使われる", () => {
    // vite-env.d.ts で declare const __APP_VERSION__: string が宣言される。
    // vitest 実行時は vite が値を埋めないため、test/setup.ts で globalThis.__APP_VERSION__ を定義する。
    render(<Brand />);
    // __APP_VERSION__ は package.json の version と一致するため、文字列 "v" の prefix だけ確認
    expect(screen.getByText(/^v/)).toBeInTheDocument();
  });
});
