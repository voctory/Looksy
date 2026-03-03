import { beforeAll, describe, expect, it } from "vitest";
import { loadConformanceMatrix } from "../helpers/fixture-loader";

const requiredTags = ["auth", "policy", "timeout", "cancel"];

describe("regression fixture coverage", () => {
  let matrix: Awaited<ReturnType<typeof loadConformanceMatrix>>;

  beforeAll(async () => {
    matrix = await loadConformanceMatrix();
  });

  for (const tag of requiredTags) {
    it(`contains fixture tagged '${tag}'`, () => {
      const fixtureCase = matrix.cases.find((entry) => entry.tags?.includes(tag));
      expect(fixtureCase, `Missing fixture case tagged with '${tag}'`).toBeTruthy();
    });
  }
});
