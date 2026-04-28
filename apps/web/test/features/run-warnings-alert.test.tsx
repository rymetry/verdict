import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";

import { RunWarningsAlert } from "@/features/run-console/RunWarningsAlert";

afterEach(() => {
  cleanup();
});

describe("RunWarningsAlert", () => {
  it("warnings が空なら描画しない", () => {
    const { container } = render(<RunWarningsAlert warnings={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("複数の warning をすべて表示する", () => {
    render(
      <RunWarningsAlert
        warnings={[
          "stdout log write failed; websocket stream was still delivered. code=ENOSPC; failures=1",
          "report read failed; summary unavailable. code=ENOENT"
        ]}
      />
    );

    expect(screen.getByText("Run warnings")).toBeInTheDocument();
    expect(screen.getByText(/stdout log write failed/)).toBeInTheDocument();
    expect(screen.getByText(/report read failed/)).toBeInTheDocument();
  });

  it("同一文言の warning も重複として表示する", () => {
    render(<RunWarningsAlert warnings={["same warning", "same warning"]} />);

    expect(screen.getAllByText("same warning")).toHaveLength(2);
  });
});
