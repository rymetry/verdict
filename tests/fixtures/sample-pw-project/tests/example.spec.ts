import { test, expect } from "@playwright/test";

test("trivial passing assertion", async () => {
  expect(1 + 1).toBe(2);
});

test("describes a tag for grep filtering @smoke", async () => {
  expect("smoke").toContain("smoke");
});
