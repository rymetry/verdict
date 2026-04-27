// StatusBar の Agent 接続状態色 / プロジェクト表示 / キーボードヒントを検証する。
import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import { StatusBar } from "@/components/shell/StatusBar";

afterEach(() => cleanup());

describe("StatusBar", () => {
  it("aria-label=セッションステータス を持つ", () => {
    render(<StatusBar agentState="reachable" />);
    expect(
      screen.getByRole("contentinfo", { name: "セッションステータス" })
    ).toBeInTheDocument();
  });

  it("agentState に応じて dot に data-agent-state 属性 + 対応トークン class を反映する", () => {
    const { rerender } = render(
      <StatusBar agentState="reachable" agentVersion="0.1.0" />
    );
    const dotReachable = screen.getByTestId("agent-status-dot");
    expect(dotReachable).toHaveAttribute("data-agent-state", "reachable");
    expect(dotReachable.className).toMatch(/bg-\[var\(--pass\)\]/);
    expect(dotReachable.className).toMatch(/var\(--pass-soft\)/);

    rerender(<StatusBar agentState="degraded" />);
    const dotDegraded = screen.getByTestId("agent-status-dot");
    expect(dotDegraded).toHaveAttribute("data-agent-state", "degraded");
    expect(dotDegraded.className).toMatch(/bg-\[var\(--flaky\)\]/);

    rerender(<StatusBar agentState="unreachable" />);
    const dotUnreachable = screen.getByTestId("agent-status-dot");
    expect(dotUnreachable).toHaveAttribute("data-agent-state", "unreachable");
    expect(dotUnreachable.className).toMatch(/bg-\[var\(--fail\)\]/);

    rerender(<StatusBar agentState="pending" />);
    const dotPending = screen.getByTestId("agent-status-dot");
    expect(dotPending).toHaveAttribute("data-agent-state", "pending");
    expect(dotPending.className).toMatch(/bg-\[var\(--skip\)\]/);
  });

  it("agentVersion を Agent v<version> として表示する", () => {
    render(<StatusBar agentState="reachable" agentVersion="1.2.3" />);
    expect(screen.getByText(/Agent v1\.2\.3/)).toBeInTheDocument();
  });

  it("agentVersion 未指定時は 'Agent —' フォールバック", () => {
    render(<StatusBar agentState="pending" />);
    expect(screen.getByText("Agent —")).toBeInTheDocument();
  });

  it("project と package manager を 'project · {name} · {pm}' で表示する", () => {
    render(
      <StatusBar
        agentState="reachable"
        projectName="acme"
        packageManager="pnpm"
      />
    );
    expect(screen.getByText(/project · acme · pnpm/)).toBeInTheDocument();
  });

  it("project 未オープン時は project セグメントを描画しない", () => {
    render(<StatusBar agentState="pending" />);
    expect(screen.queryByText(/project ·/)).not.toBeInTheDocument();
  });

  it("activeRunId があれば 'run · #<id>' を表示する", () => {
    render(<StatusBar agentState="reachable" activeRunId="abc-123" />);
    expect(screen.getByText(/run · #abc-123/)).toBeInTheDocument();
  });

  it("activeRunId が null なら run セグメントを描画しない", () => {
    render(<StatusBar agentState="reachable" activeRunId={null} />);
    expect(screen.queryByText(/run ·/)).not.toBeInTheDocument();
  });

  it("4 つのキーボードヒントを描画する", () => {
    render(<StatusBar agentState="reachable" />);
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByText("開く")).toBeInTheDocument();
    expect(within(footer).getByText("再実行")).toBeInTheDocument();
    expect(within(footer).getByText("次/前")).toBeInTheDocument();
    expect(within(footer).getByText("ショートカット一覧")).toBeInTheDocument();
  });
});
