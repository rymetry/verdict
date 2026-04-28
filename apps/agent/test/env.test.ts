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

  it.each([
    ["1", "0.0.0.0"],
    ["true", "0.0.0.0"],
    ["TRUE", "0.0.0.0"],
    [" true ", "0.0.0.0"]
  ])("allows non-loopback host when WORKBENCH_ALLOW_REMOTE=%s", (raw, expectedHost) => {
    const env = buildAgentEnv({
      env: { HOST: expectedHost, WORKBENCH_ALLOW_REMOTE: raw }
    });

    expect(env.host).toBe(expectedHost);
  });

  it.each(["", "0", "false", undefined])(
    "rejects non-loopback host when WORKBENCH_ALLOW_REMOTE=%s",
    (raw) => {
      expect(() =>
        buildAgentEnv({
          env:
            raw === undefined
              ? { HOST: "0.0.0.0" }
              : { HOST: "0.0.0.0", WORKBENCH_ALLOW_REMOTE: raw }
        })
      ).toThrow(/WORKBENCH_ALLOW_REMOTE=1 or true/);
    }
  );

  it.each(["yes", "on"])("rejects ambiguous boolean flag value %s", (raw) => {
    expect(() =>
      buildAgentEnv({
        env: { WORKBENCH_ALLOW_REMOTE: raw }
      })
    ).toThrow(/Invalid WORKBENCH_ALLOW_REMOTE value/);
  });
});
