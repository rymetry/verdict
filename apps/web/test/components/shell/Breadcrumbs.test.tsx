// Breadcrumbs の表示条件と Badge 反映を検証する。
import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { Breadcrumbs } from "@/components/shell/Breadcrumbs";

afterEach(() => cleanup());

describe("Breadcrumbs", () => {
  it("プロジェクトもブランチも run も無いときは何も描画しない (null)", () => {
    const { container } = render(<Breadcrumbs />);
    expect(container.firstChild).toBeNull();
  });

  it("nav の aria-label は Project context", () => {
    render(<Breadcrumbs projectName="acme" />);
    expect(screen.getByRole("navigation", { name: "Project context" })).toBeInTheDocument();
  });

  it("project のみの場合は project 名だけを表示する", () => {
    render(<Breadcrumbs projectName="acme-webapp" />);
    expect(screen.getByText("acme-webapp")).toBeInTheDocument();
    // run / branch は描画しない
    expect(screen.queryByText(/Run #/)).not.toBeInTheDocument();
  });

  it("空文字の projectName は表示しない (型は string でも空は欠落扱い)", () => {
    const { container } = render(<Breadcrumbs projectName="" />);
    expect(container.firstChild).toBeNull();
  });

  it("project + branch + run のフル構成を描画する", () => {
    render(
      <Breadcrumbs
        projectName="acme-webapp"
        branch="main"
        runId="4821"
        runStatus="failed"
      />
    );
    expect(screen.getByText("acme-webapp")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("Run #4821")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("RunStatus が変わると Badge ラベルも切り替わる", () => {
    const { rerender } = render(
      <Breadcrumbs runId="1" runStatus="passed" />
    );
    expect(screen.getByText("Passed")).toBeInTheDocument();

    rerender(<Breadcrumbs runId="1" runStatus="running" />);
    expect(screen.getByText("Running")).toBeInTheDocument();

    rerender(<Breadcrumbs runId="1" runStatus="error" />);
    expect(screen.getByText("Error")).toBeInTheDocument();
  });

  it("runStatus が無くても runId だけで表示できる", () => {
    render(<Breadcrumbs runId="42" />);
    expect(screen.getByText("Run #42")).toBeInTheDocument();
    expect(screen.queryByText(/Failed|Passed|Running/)).not.toBeInTheDocument();
  });

  it("branch のみが指定された場合は branch label だけを描画する", () => {
    render(<Breadcrumbs branch="feature/x" />);
    expect(screen.getByText("feature/x")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Project context" })).toBeInTheDocument();
  });

  it("project + branch (run なし) は両方を描画する", () => {
    render(<Breadcrumbs projectName="acme" branch="main" />);
    expect(screen.getByText("acme")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.queryByText(/Run #/)).not.toBeInTheDocument();
  });
});
