import { describe, expect, it } from "vitest";

import { computeExactBenchmarkStatsForAlgorithm } from "../benchmark/exact-stats.ts";
import { type ExactQuestionStats } from "../benchmark/types.ts";
import {
  applyCompatibilityTestAnswer,
  COMPATIBILITY_TEST_ALGORITHMS,
  createCompatibilityTestState,
  getCurrentCompatibilityTestStep,
  skipCachedCompatibilityTestSteps,
  takeTargetsFromRanges,
  type CompatibilityTestAlgorithm,
} from "../src/compatibility-test/index.ts";

interface MutableQuestionStats {
  subsetCount: bigint;
  totalQuestions: bigint;
  minQuestions: number;
  maxQuestions: number;
}

describe("benchmark exact stats", () => {
  it("matches brute-force enumeration for small target counts", () => {
    for (const algorithm of COMPATIBILITY_TEST_ALGORITHMS) {
      const computed = computeExactBenchmarkStatsForAlgorithm(8, algorithm);

      for (let targetCount = 1; targetCount <= 8; targetCount += 1) {
        const bruteForce = bruteForceQuestionStats(targetCount, algorithm);
        const exact = computed[targetCount];

        expect(exact?.overall).toEqual(bruteForce.overall);

        for (let subsetSize = 1; subsetSize <= targetCount; subsetSize += 1) {
          expect(exact?.bySubsetSize[subsetSize]).toEqual(bruteForce.bySubsetSize[subsetSize]);
        }
      }
    }
  });
});

function bruteForceQuestionStats(targetCount: number, algorithm: CompatibilityTestAlgorithm) {
  const bySubsetSize: (MutableQuestionStats | undefined)[] = new Array(targetCount + 1).fill(undefined);
  const overall: MutableQuestionStats = {
    subsetCount: 0n,
    totalQuestions: 0n,
    minQuestions: Number.POSITIVE_INFINITY,
    maxQuestions: Number.NEGATIVE_INFINITY,
  };

  const subsetUpperBound = 1n << BigInt(targetCount);
  for (let subsetMask = 1n; subsetMask < subsetUpperBound; subsetMask += 1n) {
    const subset = decodeSubsetMask(targetCount, subsetMask);
    const subsetSize = subset.length;
    const questionCount = runEngineQuestionCount(targetCount, subset, algorithm);

    const bucket = getOrCreateMutableStats(bySubsetSize, subsetSize);
    applyBruteForceSample(bucket, questionCount);
    applyBruteForceSample(overall, questionCount);
  }

  return {
    bySubsetSize: bySubsetSize.map((stats) => (stats ? freezeMutableStats(stats) : undefined)),
    overall: freezeMutableStats(overall),
  };
}

function runEngineQuestionCount(
  targetCount: number,
  failingSubset: readonly number[],
  algorithm: CompatibilityTestAlgorithm,
): number {
  const state = createCompatibilityTestState(targetCount, { algorithm });
  let questionCount = 0;
  let step = getCurrentCompatibilityTestStep(state);

  while (step) {
    if (!step.requiresAnswer) {
      step = skipCachedCompatibilityTestSteps(state);
      continue;
    }

    questionCount += 1;
    const promptTargets = new Set(takeTargetsFromRanges(step.promptTargetRanges, step.promptTargetCount));
    const hasIssue = failingSubset.every((target) => promptTargets.has(target));
    applyCompatibilityTestAnswer(state, hasIssue);
    step = getCurrentCompatibilityTestStep(state);
  }

  return questionCount;
}

function decodeSubsetMask(targetCount: number, subsetMask: bigint): number[] {
  const subset: number[] = [];

  for (let targetIndex = 0; targetIndex < targetCount; targetIndex += 1) {
    if ((subsetMask & (1n << BigInt(targetIndex))) !== 0n) {
      subset.push(targetIndex + 1);
    }
  }

  return subset;
}

function getOrCreateMutableStats(
  buckets: (MutableQuestionStats | undefined)[],
  subsetSize: number,
): MutableQuestionStats {
  const existingStats = buckets[subsetSize];
  if (existingStats) {
    return existingStats;
  }

  const createdStats: MutableQuestionStats = {
    subsetCount: 0n,
    totalQuestions: 0n,
    minQuestions: Number.POSITIVE_INFINITY,
    maxQuestions: Number.NEGATIVE_INFINITY,
  };
  buckets[subsetSize] = createdStats;
  return createdStats;
}

function applyBruteForceSample(stats: MutableQuestionStats, questionCount: number): void {
  stats.subsetCount += 1n;
  stats.totalQuestions += BigInt(questionCount);
  stats.minQuestions = Math.min(stats.minQuestions, questionCount);
  stats.maxQuestions = Math.max(stats.maxQuestions, questionCount);
}

function freezeMutableStats(stats: MutableQuestionStats): ExactQuestionStats {
  return {
    subsetCount: stats.subsetCount,
    totalQuestions: stats.totalQuestions,
    minQuestions: stats.minQuestions,
    maxQuestions: stats.maxQuestions,
  };
}
