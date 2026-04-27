// app-shell 表示派生ロジックの単体テスト。副作用なしの純粋関数。
import { describe, expect, it } from "vitest";
import type { HealthResponse } from "@pwqa/shared";

import { deriveAgentState, deriveProjectDisplayName } from "@/lib/shell-derive";

function makeHealth(ok: boolean, version: string = "0.1.0"): HealthResponse {
  return {
    ok,
    service: "playwright-workbench-agent",
    version,
    timestamp: "2026-04-28T00:00:00Z"
  };
}

describe("deriveAgentState", () => {
  it("data.ok=true なら reachable", () => {
    expect(deriveAgentState(makeHealth(true), null)).toBe("reachable");
  });

  it("error あり (data なし) なら unreachable", () => {
    expect(deriveAgentState(undefined, new Error("network"))).toBe("unreachable");
  });

  it("data も error も無い (初期 fetch 中) なら pending", () => {
    expect(deriveAgentState(undefined, null)).toBe("pending");
    expect(deriveAgentState(undefined, undefined)).toBe("pending");
  });

  it("data.ok=false なら degraded (HTTP 200 だが Agent が自身を unhealthy と申告)", () => {
    expect(deriveAgentState(makeHealth(false), null)).toBe("degraded");
  });

  it("data.ok=true は error があっても reachable を優先する (古い error が残る場合の境界)", () => {
    expect(deriveAgentState(makeHealth(true), new Error("stale"))).toBe("reachable");
  });

  it("data.ok=false は error があっても degraded を優先する (data が新しい signal の前提)", () => {
    expect(deriveAgentState(makeHealth(false), new Error("stale"))).toBe("degraded");
  });
});

describe("deriveProjectDisplayName", () => {
  it("posix path の basename を返す", () => {
    expect(deriveProjectDisplayName("/home/user/projects/acme-webapp")).toBe(
      "acme-webapp"
    );
  });

  it("末尾スラッシュを無視する", () => {
    expect(deriveProjectDisplayName("/home/user/projects/acme/")).toBe("acme");
  });

  it("win32 path のバックスラッシュ区切りに対応する", () => {
    expect(deriveProjectDisplayName("C:\\Users\\rym\\projects\\acme")).toBe("acme");
  });

  it("ルート単独 (区切り文字のみ) の場合は元の文字列を返す", () => {
    expect(deriveProjectDisplayName("/")).toBe("/");
  });

  it("空文字は空文字を返す (空が rootPath として渡されるエッジケース)", () => {
    expect(deriveProjectDisplayName("")).toBe("");
  });

  it("単一セグメントはそのまま返す", () => {
    expect(deriveProjectDisplayName("acme")).toBe("acme");
  });
});
