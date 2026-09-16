import { describe, expect, it } from "vitest";
import { runSystemSelfTests } from "../services/systemSelfTest";

describe("runSystemSelfTests diagnostic suite (Phase 14 & 15)", () => {
  it("runs all 7 core logic tests and passes with 100% accuracy", async () => {
    const report = await runSystemSelfTests();
    expect(report.results.length).toBe(7);
    expect(report.allPassed).toBe(true);
    for (const test of report.results) {
      expect(test.status).toBe("PASS");
    }
  });
});
