// usePersonaStore の振る舞いを invariant 単位で検証する。
// 永続化は β 段階では行わない (γ で TanStack Router に移譲する想定)。
import { beforeEach, describe, expect, it } from "vitest";

import {
  isPersonaView,
  PERSONA_VIEWS,
  type PersonaView,
  usePersonaStore
} from "@/store/persona-store";

function resetStore(): void {
  usePersonaStore.setState({ persona: "qa" }, false);
}

describe("persona-store", () => {
  beforeEach(() => {
    resetStore();
  });

  it("初期 persona は qa である", () => {
    expect(usePersonaStore.getState().persona).toBe("qa");
  });

  it("setPersona で persona が更新される", () => {
    usePersonaStore.getState().setPersona("dev");
    expect(usePersonaStore.getState().persona).toBe("dev");
  });

  it("setPersona は qa / dev / qmo すべてを許容する", () => {
    const all: PersonaView[] = ["qa", "dev", "qmo"];
    for (const v of all) {
      usePersonaStore.getState().setPersona(v);
      expect(usePersonaStore.getState().persona).toBe(v);
    }
  });

  it("PERSONA_VIEWS は 3 種類すべてを公開する", () => {
    expect(PERSONA_VIEWS).toEqual(["qa", "dev", "qmo"]);
  });

  it("isPersonaView は値域内の文字列のみ true を返す", () => {
    expect(isPersonaView("qa")).toBe(true);
    expect(isPersonaView("dev")).toBe(true);
    expect(isPersonaView("qmo")).toBe(true);
    expect(isPersonaView("admin")).toBe(false);
    expect(isPersonaView("")).toBe(false);
    expect(isPersonaView(null)).toBe(false);
    expect(isPersonaView(undefined)).toBe(false);
    expect(isPersonaView(0)).toBe(false);
  });

  it("ストアは persona と setPersona のみを公開する (拡張時に気付ける invariant)", () => {
    const keys = Object.keys(usePersonaStore.getState()).sort();
    expect(keys).toEqual(["persona", "setPersona"]);
  });
});
