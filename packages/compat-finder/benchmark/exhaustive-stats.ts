import {
  applyCompatibilityTestAnswer,
  createCompatibilityTestState,
  getCurrentCompatibilityTestStep,
  skipCachedCompatibilityTestSteps,
  type CompatibilityTestAlgorithm,
  type TargetRange,
} from "../src/compatibility-test/index.ts";
import { type ExactQuestionStats, type ExactTargetCountStats } from "./types.ts";

interface MutableQuestionStats {
  subsetCount: bigint;
  totalQuestions: bigint;
  minQuestions: number;
  maxQuestions: number;
}

type BenchmarkStatsTable = ExactTargetCountStats[];

export function computeExhaustiveBenchmarkStatsForAlgorithm(
  maxTargetCount: number,
  algorithm: CompatibilityTestAlgorithm,
): ExactTargetCountStats[] {
  if (!Number.isInteger(maxTargetCount) || maxTargetCount < 1) {
    throw new Error("maxTargetCount must be an integer greater than or equal to 1");
  }

  const table: BenchmarkStatsTable = [];

  for (let targetCount = 1; targetCount <= maxTargetCount; targetCount += 1) {
    table[targetCount] = computeExhaustiveBenchmarkStatsForTargetCount(targetCount, algorithm);
  }

  return table;
}

export function computeExhaustiveBenchmarkStatsForTargetCount(
  targetCount: number,
  algorithm: CompatibilityTestAlgorithm,
): ExactTargetCountStats {
  const bySubsetSize: (ExactQuestionStats | undefined)[] = new Array(targetCount + 1).fill(undefined);
  const overall = createMutableQuestionStats();
  const subsetUpperBound = 1n << BigInt(targetCount);

  for (let subsetMask = 1n; subsetMask < subsetUpperBound; subsetMask += 1n) {
    const failingTargets = decodeSubsetMask(targetCount, subsetMask);
    const subsetSize = failingTargets.length;
    const questionCount = runEngineQuestionCount(targetCount, failingTargets, algorithm);

    applyQuestionCount(getOrCreateMutableStats(bySubsetSize, subsetSize), questionCount);
    applyQuestionCount(overall, questionCount);
  }

  return {
    targetCount,
    bySubsetSize: bySubsetSize.map((stats) => (stats ? freezeMutableStats(stats) : undefined)),
    overall: freezeMutableStats(overall),
  };
}

function runEngineQuestionCount(
  targetCount: number,
  failingTargets: readonly number[],
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
    applyCompatibilityTestAnswer(state, promptCoversAllTargets(step.promptTargetRanges, failingTargets));
    step = getCurrentCompatibilityTestStep(state);
  }

  return questionCount;
}

function promptCoversAllTargets(ranges: readonly TargetRange[], targets: readonly number[]): boolean {
  return targets.every((target) => rangeListContainsTarget(ranges, target));
}

function rangeListContainsTarget(ranges: readonly TargetRange[], target: number): boolean {
  for (const range of ranges) {
    if (target < range.start) {
      return false;
    }

    if (target <= range.end) {
      return true;
    }
  }

  return false;
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

function createMutableQuestionStats(): MutableQuestionStats {
  return {
    subsetCount: 0n,
    totalQuestions: 0n,
    minQuestions: Number.POSITIVE_INFINITY,
    maxQuestions: Number.NEGATIVE_INFINITY,
  };
}

function getOrCreateMutableStats(
  buckets: (MutableQuestionStats | undefined)[],
  subsetSize: number,
): MutableQuestionStats {
  const existingStats = buckets[subsetSize];
  if (existingStats) {
    return existingStats;
  }

  const createdStats = createMutableQuestionStats();
  buckets[subsetSize] = createdStats;
  return createdStats;
}

function applyQuestionCount(stats: MutableQuestionStats, questionCount: number): void {
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
