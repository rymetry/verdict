import { describe, expect, it } from "vitest";
import { buildAgentEnv } from "../src/env.js";

describe("buildAgentEnv", () => {
  it.each([
    ["1", true],
    ["true", true],
    ["TRUE", true],
    [" true ", true],
    ["", false],
    ["false", false],
    ["0", false],
    [undefined, false]
  ])("parses AGENT_FAIL_CLOSED_AUDIT=%s", (raw, expected) => {
    const env = buildAgentEnv({
      env: raw === undefined ? {} : { AGENT_FAIL_CLOSED_AUDIT: raw }
    });
    expect(env.failClosedAudit).toBe(expected);
  });
});
