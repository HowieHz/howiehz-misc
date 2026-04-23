import { type CompatibilityTestAlgorithm } from "../src/compatibility-test/index.ts";
import { type ExactQuestionStats, type ExactTargetCountStats } from "./types.ts";

type BenchmarkStatsTable = ExactTargetCountStats[];

export function computeExactBenchmarkStatsForAlgorithm(
  maxTargetCount: number,
  algorithm: CompatibilityTestAlgorithm,
): ExactTargetCountStats[] {
  assertValidTargetCount(maxTargetCount, "maxTargetCount");

  switch (algorithm) {
    case "binary-split":
      return computeBinarySplitStats(maxTargetCount);
    case "leave-one-out":
      return computeLeaveOneOutStats(maxTargetCount);
    default:
      throw new Error(`Unsupported benchmark algorithm: ${algorithm}`);
  }
}

export function computeExactBenchmarkStatsForTargetCount(
  targetCount: number,
  algorithm: CompatibilityTestAlgorithm,
): ExactTargetCountStats {
  assertValidTargetCount(targetCount, "targetCount");

  if (algorithm === "leave-one-out") {
    return computeLeaveOneOutTargetCountStats(targetCount);
  }

  const table = computeExactBenchmarkStatsForAlgorithm(targetCount, algorithm);
  const stats = table[targetCount];
  if (!stats) {
    throw new Error(`Missing benchmark stats for targetCount=${targetCount}`);
  }

  return stats;
}

function computeBinarySplitStats(maxTargetCount: number): BenchmarkStatsTable {
  const freshTable: BenchmarkStatsTable = [];
  const issueKnownTable: BenchmarkStatsTable = [];
  freshTable[1] = {
    targetCount: 1,
    bySubsetSize: [undefined, createExactQuestionStats(1n, 1n, 1, 1)],
    overall: createExactQuestionStats(1n, 1n, 1, 1),
  };
  issueKnownTable[1] = {
    targetCount: 1,
    bySubsetSize: [undefined, createExactQuestionStats(1n, 0n, 0, 0)],
    overall: createExactQuestionStats(1n, 0n, 0, 0),
  };

  for (let targetCount = 2; targetCount <= maxTargetCount; targetCount += 1) {
    computeBinarySplitTargetCountStats(targetCount, freshTable, issueKnownTable);
  }

  return freshTable;
}

function computeBinarySplitTargetCountStats(
  targetCount: number,
  freshTable: BenchmarkStatsTable,
  issueKnownTable: BenchmarkStatsTable,
): void {
  const leftTargetCount = Math.ceil(targetCount / 2);
  const rightTargetCount = Math.floor(targetCount / 2);
  const leftFreshStats = freshTable[leftTargetCount];
  const rightFreshStats = freshTable[rightTargetCount];
  const leftIssueKnownStats = issueKnownTable[leftTargetCount];
  const rightIssueKnownStats = issueKnownTable[rightTargetCount];

  if (!leftFreshStats || !rightFreshStats || !leftIssueKnownStats || !rightIssueKnownStats) {
    throw new Error(`Missing binary-split dependencies for targetCount=${targetCount}`);
  }

  const freshBySubsetSize: (ExactQuestionStats | undefined)[] = new Array(targetCount + 1).fill(undefined);
  const issueKnownBySubsetSize: (ExactQuestionStats | undefined)[] = new Array(targetCount + 1).fill(undefined);

  for (let subsetSize = 1; subsetSize <= targetCount; subsetSize += 1) {
    const aggregate = computeBinarySplitSubsetSizeStats(
      subsetSize,
      leftTargetCount,
      rightTargetCount,
      leftFreshStats,
      leftIssueKnownStats,
      rightIssueKnownStats,
    );

    freshBySubsetSize[subsetSize] = aggregate.fresh;
    issueKnownBySubsetSize[subsetSize] = aggregate.issueKnown;
  }

  freshTable[targetCount] = {
    targetCount,
    bySubsetSize: freshBySubsetSize,
    overall: collapseExactQuestionStats(freshBySubsetSize),
  };
  issueKnownTable[targetCount] = {
    targetCount,
    bySubsetSize: issueKnownBySubsetSize,
    overall: collapseExactQuestionStats(issueKnownBySubsetSize),
  };
}

function computeBinarySplitSubsetSizeStats(
  subsetSize: number,
  leftTargetCount: number,
  rightTargetCount: number,
  leftFreshStats: ExactTargetCountStats,
  leftIssueKnownStats: ExactTargetCountStats,
  rightIssueKnownStats: ExactTargetCountStats,
): { fresh: ExactQuestionStats; issueKnown: ExactQuestionStats } {
  let freshAggregate: ExactQuestionStats | undefined;
  let issueKnownAggregate: ExactQuestionStats | undefined;
  const leftSubsetSizeStart = Math.max(0, subsetSize - rightTargetCount);
  const leftSubsetSizeEnd = Math.min(leftTargetCount, subsetSize);

  for (let leftSubsetSize = leftSubsetSizeStart; leftSubsetSize <= leftSubsetSizeEnd; leftSubsetSize += 1) {
    const rightSubsetSize = subsetSize - leftSubsetSize;
    const contribution = getBinarySplitAggregateContribution(
      leftSubsetSize,
      rightSubsetSize,
      leftFreshStats,
      leftIssueKnownStats,
      rightIssueKnownStats,
    );
    if (!contribution) {
      continue;
    }

    freshAggregate = mergeExactQuestionStats(freshAggregate, contribution.freshContribution);
    issueKnownAggregate = mergeExactQuestionStats(issueKnownAggregate, contribution.issueKnownContribution);
  }

  if (!freshAggregate || !issueKnownAggregate) {
    throw new Error(`Failed to compute binary-split stats for subsetSize=${subsetSize}`);
  }

  return {
    fresh: freshAggregate,
    issueKnown: issueKnownAggregate,
  };
}

interface BinarySplitAggregateContribution {
  freshContribution: ExactQuestionStats;
  issueKnownContribution: ExactQuestionStats;
}

function getBinarySplitAggregateContribution(
  leftSubsetSize: number,
  rightSubsetSize: number,
  leftFreshStats: ExactTargetCountStats,
  leftIssueKnownStats: ExactTargetCountStats,
  rightIssueKnownStats: ExactTargetCountStats,
): BinarySplitAggregateContribution | undefined {
  if (leftSubsetSize === 0) {
    return getRightOnlyAggregateContribution(rightIssueKnownStats, rightSubsetSize);
  }

  if (rightSubsetSize === 0) {
    return getLeftOnlyAggregateContribution(leftIssueKnownStats, leftSubsetSize);
  }

  return getSplitAggregateContribution(
    leftFreshStats,
    leftIssueKnownStats,
    rightIssueKnownStats,
    leftSubsetSize,
    rightSubsetSize,
  );
}

function getRightOnlyAggregateContribution(
  rightIssueKnownStats: ExactTargetCountStats,
  rightSubsetSize: number,
): BinarySplitAggregateContribution | undefined {
  const rightIssueKnownContribution = rightIssueKnownStats.bySubsetSize[rightSubsetSize];
  if (!rightIssueKnownContribution) {
    return undefined;
  }

  const offsetContribution = offsetExactQuestionStats(rightIssueKnownContribution, 2);
  return {
    freshContribution: offsetContribution,
    issueKnownContribution: offsetContribution,
  };
}

function getLeftOnlyAggregateContribution(
  leftIssueKnownStats: ExactTargetCountStats,
  leftSubsetSize: number,
): BinarySplitAggregateContribution | undefined {
  const leftIssueKnownContribution = leftIssueKnownStats.bySubsetSize[leftSubsetSize];
  if (!leftIssueKnownContribution) {
    return undefined;
  }

  const offsetContribution = offsetExactQuestionStats(leftIssueKnownContribution, 1);
  return {
    freshContribution: offsetContribution,
    issueKnownContribution: offsetContribution,
  };
}

function getSplitAggregateContribution(
  leftFreshStats: ExactTargetCountStats,
  leftIssueKnownStats: ExactTargetCountStats,
  rightIssueKnownStats: ExactTargetCountStats,
  leftSubsetSize: number,
  rightSubsetSize: number,
): BinarySplitAggregateContribution | undefined {
  const leftFreshContribution = leftFreshStats.bySubsetSize[leftSubsetSize];
  const leftIssueKnownContribution = leftIssueKnownStats.bySubsetSize[leftSubsetSize];
  const rightIssueKnownContribution = rightIssueKnownStats.bySubsetSize[rightSubsetSize];
  if (!leftFreshContribution || !leftIssueKnownContribution || !rightIssueKnownContribution) {
    return undefined;
  }

  return {
    freshContribution: combineSplitBranchStats(leftFreshContribution, rightIssueKnownContribution, 2),
    issueKnownContribution: combineSplitBranchStats(leftIssueKnownContribution, rightIssueKnownContribution, 2),
  };
}

function computeLeaveOneOutStats(maxTargetCount: number): BenchmarkStatsTable {
  const table: BenchmarkStatsTable = [];

  for (let targetCount = 1; targetCount <= maxTargetCount; targetCount += 1) {
    table[targetCount] = computeLeaveOneOutTargetCountStats(targetCount);
  }

  return table;
}

function computeLeaveOneOutTargetCountStats(targetCount: number): ExactTargetCountStats {
  const bySubsetSize: (ExactQuestionStats | undefined)[] = new Array(targetCount + 1).fill(undefined);
  let subsetCount = 1n;

  for (let subsetSize = 1; subsetSize <= targetCount; subsetSize += 1) {
    subsetCount = (subsetCount * BigInt(targetCount - subsetSize + 1)) / BigInt(subsetSize);
    const questionCount = getLeaveOneOutQuestionCount(targetCount, subsetSize);
    bySubsetSize[subsetSize] = createExactQuestionStats(
      subsetCount,
      subsetCount * BigInt(questionCount),
      questionCount,
      questionCount,
    );
  }

  return {
    targetCount,
    bySubsetSize,
    overall: collapseExactQuestionStats(bySubsetSize),
  };
}

function getLeaveOneOutQuestionCount(targetCount: number, subsetSize: number): number {
  if (targetCount === 1) {
    return 1;
  }

  return subsetSize === targetCount ? targetCount + 1 : targetCount;
}

function combineSplitBranchStats(
  leftStats: ExactQuestionStats,
  rightStats: ExactQuestionStats,
  offset: number,
): ExactQuestionStats {
  const subsetCount = leftStats.subsetCount * rightStats.subsetCount;
  const totalQuestions =
    leftStats.totalQuestions * rightStats.subsetCount +
    rightStats.totalQuestions * leftStats.subsetCount +
    subsetCount * BigInt(offset);

  return createExactQuestionStats(
    subsetCount,
    totalQuestions,
    leftStats.minQuestions + rightStats.minQuestions + offset,
    leftStats.maxQuestions + rightStats.maxQuestions + offset,
  );
}

function collapseExactQuestionStats(statsList: readonly (ExactQuestionStats | undefined)[]): ExactQuestionStats {
  let aggregate: ExactQuestionStats | undefined;

  for (const stats of statsList) {
    if (!stats) {
      continue;
    }

    aggregate = mergeExactQuestionStats(aggregate, stats);
  }

  if (!aggregate) {
    throw new Error("Expected at least one subset bucket when collapsing benchmark stats");
  }

  return aggregate;
}

function mergeExactQuestionStats(
  current: ExactQuestionStats | undefined,
  next: ExactQuestionStats,
): ExactQuestionStats {
  if (!current) {
    return next;
  }

  return createExactQuestionStats(
    current.subsetCount + next.subsetCount,
    current.totalQuestions + next.totalQuestions,
    Math.min(current.minQuestions, next.minQuestions),
    Math.max(current.maxQuestions, next.maxQuestions),
  );
}

function offsetExactQuestionStats(stats: ExactQuestionStats, offset: number): ExactQuestionStats {
  return createExactQuestionStats(
    stats.subsetCount,
    stats.totalQuestions + stats.subsetCount * BigInt(offset),
    stats.minQuestions + offset,
    stats.maxQuestions + offset,
  );
}

function createExactQuestionStats(
  subsetCount: bigint,
  totalQuestions: bigint,
  minQuestions: number,
  maxQuestions: number,
): ExactQuestionStats {
  return {
    subsetCount,
    totalQuestions,
    minQuestions,
    maxQuestions,
  };
}

function assertValidTargetCount(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be an integer greater than or equal to 1`);
  }
}
