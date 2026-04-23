import { type CompatibilityTestAlgorithm } from "../src/compatibility-test/index.ts";
import { type ExactBenchmarkStatsByAlgorithm, type ExactQuestionStats, type ExactTargetCountStats } from "./types.ts";

type BenchmarkStatsTable = ExactTargetCountStats[];

export function computeExactBenchmarkStats(maxTargetCount: number): ExactBenchmarkStatsByAlgorithm {
  if (!Number.isInteger(maxTargetCount) || maxTargetCount < 1) {
    throw new Error("maxTargetCount must be an integer greater than or equal to 1");
  }

  return {
    "binary-split": computeExactBenchmarkStatsForAlgorithm(maxTargetCount, "binary-split"),
    "leave-one-out": computeExactBenchmarkStatsForAlgorithm(maxTargetCount, "leave-one-out"),
  };
}

export function computeExactBenchmarkStatsForAlgorithm(
  maxTargetCount: number,
  algorithm: CompatibilityTestAlgorithm,
): ExactTargetCountStats[] {
  if (!Number.isInteger(maxTargetCount) || maxTargetCount < 1) {
    throw new Error("maxTargetCount must be an integer greater than or equal to 1");
  }

  switch (algorithm) {
    case "binary-split":
      return computeBinarySplitStats(maxTargetCount);
    case "leave-one-out":
      return computeLeaveOneOutStats(maxTargetCount);
  }
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
      let freshAggregate: ExactQuestionStats | undefined;
      let issueKnownAggregate: ExactQuestionStats | undefined;
      const leftSubsetSizeStart = Math.max(0, subsetSize - rightTargetCount);
      const leftSubsetSizeEnd = Math.min(leftTargetCount, subsetSize);

      for (let leftSubsetSize = leftSubsetSizeStart; leftSubsetSize <= leftSubsetSizeEnd; leftSubsetSize += 1) {
        const rightSubsetSize = subsetSize - leftSubsetSize;

        if (leftSubsetSize === 0) {
          const rightIssueKnownContribution = rightIssueKnownStats.bySubsetSize[rightSubsetSize];
          if (!rightIssueKnownContribution) {
            continue;
          }

          const offsetContribution = offsetExactQuestionStats(rightIssueKnownContribution, 2);
          freshAggregate = mergeExactQuestionStats(freshAggregate, offsetContribution);
          issueKnownAggregate = mergeExactQuestionStats(issueKnownAggregate, offsetContribution);
          continue;
        }

        if (rightSubsetSize === 0) {
          const leftIssueKnownContribution = leftIssueKnownStats.bySubsetSize[leftSubsetSize];
          if (!leftIssueKnownContribution) {
            continue;
          }

          const offsetContribution = offsetExactQuestionStats(leftIssueKnownContribution, 1);
          freshAggregate = mergeExactQuestionStats(freshAggregate, offsetContribution);
          issueKnownAggregate = mergeExactQuestionStats(issueKnownAggregate, offsetContribution);
          continue;
        }

        const leftFreshContribution = leftFreshStats.bySubsetSize[leftSubsetSize];
        const leftIssueKnownContribution = leftIssueKnownStats.bySubsetSize[leftSubsetSize];
        const rightIssueKnownContribution = rightIssueKnownStats.bySubsetSize[rightSubsetSize];
        if (!leftFreshContribution || !leftIssueKnownContribution || !rightIssueKnownContribution) {
          continue;
        }

        freshAggregate = mergeExactQuestionStats(
          freshAggregate,
          combineSplitBranchStats(leftFreshContribution, rightIssueKnownContribution, 2),
        );
        issueKnownAggregate = mergeExactQuestionStats(
          issueKnownAggregate,
          combineSplitBranchStats(leftIssueKnownContribution, rightIssueKnownContribution, 2),
        );
      }

      if (!freshAggregate || !issueKnownAggregate) {
        throw new Error(`Failed to compute binary-split stats for n=${targetCount}, k=${subsetSize}`);
      }

      freshBySubsetSize[subsetSize] = freshAggregate;
      issueKnownBySubsetSize[subsetSize] = issueKnownAggregate;
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

  return freshTable;
}

function computeLeaveOneOutStats(maxTargetCount: number): BenchmarkStatsTable {
  const table: BenchmarkStatsTable = [];

  for (let targetCount = 1; targetCount <= maxTargetCount; targetCount += 1) {
    const bySubsetSize: (ExactQuestionStats | undefined)[] = new Array(targetCount + 1).fill(undefined);
    let subsetCount = 1n;

    for (let subsetSize = 1; subsetSize <= targetCount; subsetSize += 1) {
      subsetCount = (subsetCount * BigInt(targetCount - subsetSize + 1)) / BigInt(subsetSize);
      const questionCount = subsetSize === targetCount ? targetCount + 1 : targetCount;
      bySubsetSize[subsetSize] = createExactQuestionStats(
        subsetCount,
        subsetCount * BigInt(questionCount),
        questionCount,
        questionCount,
      );
    }

    table[targetCount] = {
      targetCount,
      bySubsetSize,
      overall: collapseExactQuestionStats(bySubsetSize),
    };
  }

  return table;
}

function collapseExactQuestionStats(statsList: (ExactQuestionStats | undefined)[]): ExactQuestionStats {
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
