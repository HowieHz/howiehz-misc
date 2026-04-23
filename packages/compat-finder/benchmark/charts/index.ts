import { COMPATIBILITY_TEST_ALGORITHMS } from "../../src/compatibility-test/index.ts";
import {
  type BenchmarkChart,
  type BenchmarkChartPoint,
  type BenchmarkResults,
  type ExactBenchmarkStatsByAlgorithm,
  type ExactQuestionStats,
  type ExactTargetCountStats,
} from "../types.ts";

const QUARTER_BASELINE_TARGET_COUNT = 4;
const FIFTH_BASELINE_TARGET_COUNT = 5;
const SIXTH_BASELINE_TARGET_COUNT = 6;
const SEVENTH_BASELINE_TARGET_COUNT = 7;
const EIGHTH_BASELINE_TARGET_COUNT = 8;
const LINEAR_SLOPE_BASIS_POINTS = 2283;
const LINEAR_SLOPE_BASELINE_TARGET_COUNT = Math.ceil(10_000 / LINEAR_SLOPE_BASIS_POINTS);
const MAX_LINEAR_SLOPE_BASIS_POINTS = 1377;
const MAX_LINEAR_SLOPE_BASELINE_TARGET_COUNT = Math.ceil(10_000 / MAX_LINEAR_SLOPE_BASIS_POINTS);
const FIXED_DECIMAL_DIGITS = 6;

interface BenchmarkChartDefinition {
  description: string;
  id: string;
  resolvePoint: (stats: ExactTargetCountStats) => BenchmarkChartPoint | undefined;
  title: string;
  xAxisMin: number;
}

const BENCHMARK_CHART_DEFINITIONS: readonly BenchmarkChartDefinition[] = [
  {
    id: "overall-non-empty-subsets",
    title: "All Non-Empty Failing Sets",
    description: "Exact min / avg / max question counts across all non-empty failing sets.",
    xAxisMin: 1,
    resolvePoint: (stats) => createChartPoint(stats.targetCount, null, "all non-empty failing sets", stats.overall),
  },
  createFloorFractionChartDefinition(1, 1),
  createFloorFractionChartDefinition(1, 5, FIFTH_BASELINE_TARGET_COUNT),
  createFloorBasisPointsChartDefinition(LINEAR_SLOPE_BASIS_POINTS, LINEAR_SLOPE_BASELINE_TARGET_COUNT),
  createFloorFractionChartDefinition(1, 6, SIXTH_BASELINE_TARGET_COUNT),
  createFloorFractionChartDefinition(1, 7, SEVENTH_BASELINE_TARGET_COUNT),
  createFloorBasisPointsChartDefinition(MAX_LINEAR_SLOPE_BASIS_POINTS, MAX_LINEAR_SLOPE_BASELINE_TARGET_COUNT),
  createFloorFractionChartDefinition(1, 8, EIGHTH_BASELINE_TARGET_COUNT),
  createFloorFractionChartDefinition(1, 4, QUARTER_BASELINE_TARGET_COUNT),
  {
    id: "pick-all",
    title: "Failing Set Size = n",
    description: "Exact min / avg / max question counts when every target is in the failing set.",
    xAxisMin: QUARTER_BASELINE_TARGET_COUNT,
    resolvePoint: (stats) => {
      if (stats.targetCount < QUARTER_BASELINE_TARGET_COUNT) {
        return undefined;
      }

      return createFixedSizeChartPoint(stats, stats.targetCount, "failing set size = n");
    },
  },
];

export function buildBenchmarkResults(
  maxTargetCount: number,
  statsByAlgorithm: ExactBenchmarkStatsByAlgorithm,
): BenchmarkResults {
  return {
    generatedAt: new Date().toISOString(),
    maxTargetCount,
    charts: BENCHMARK_CHART_DEFINITIONS.map((definition) =>
      createBenchmarkChart(definition, statsByAlgorithm, maxTargetCount),
    ),
  };
}

function createFloorBasisPointsChartDefinition(basisPoints: number, baselineTargetCount = 1): BenchmarkChartDefinition {
  const percentLabel = formatBasisPointsPercent(basisPoints);
  const id = `pick-${percentLabel.replace(".", "-")}-percent`;
  const title = `Failing Set Size = floor(${percentLabel}% of n)`;
  const subsetSizeLabel = `failing set size = floor(${percentLabel}% of n)`;

  return {
    id,
    title,
    description: `Exact min / avg / max question counts when the failing set size is floor(${percentLabel}% of n).`,
    xAxisMin: baselineTargetCount,
    resolvePoint: (stats) => {
      if (stats.targetCount < baselineTargetCount) {
        return undefined;
      }

      const subsetSize = Math.floor((stats.targetCount * basisPoints) / 10_000);
      return createFixedSizeChartPoint(stats, subsetSize, subsetSizeLabel);
    },
  };
}

function createBenchmarkChart(
  definition: BenchmarkChartDefinition,
  statsByAlgorithm: ExactBenchmarkStatsByAlgorithm,
  maxTargetCount: number,
): BenchmarkChart {
  return {
    id: definition.id,
    title: definition.title,
    description: definition.description,
    xAxisMin: definition.xAxisMin,
    xAxisLabel: "Target count",
    yAxisLabel: "Question count",
    series: COMPATIBILITY_TEST_ALGORITHMS.map((algorithm) => ({
      algorithm,
      points: statsByAlgorithm[algorithm]
        .slice(1, maxTargetCount + 1)
        .map((stats) => (stats ? definition.resolvePoint(stats) : undefined))
        .filter((point): point is BenchmarkChartPoint => point !== undefined),
    })),
  };
}

function createFloorFractionChartDefinition(
  numerator: number,
  denominator: number,
  baselineTargetCount = 1,
): BenchmarkChartDefinition {
  const id = denominator === 1 ? `pick-${numerator}` : `pick-${ordinalName(denominator)}`;
  const title =
    denominator === 1 ? `Failing Set Size = ${numerator}` : `Failing Set Size = floor(${numerator}n / ${denominator})`;
  const subsetSizeLabel =
    denominator === 1 ? `failing set size = ${numerator}` : `failing set size = floor(${numerator}n / ${denominator})`;
  const description =
    denominator === 1
      ? `Exact min / avg / max question counts when the failing set size is exactly ${numerator}.`
      : `Exact min / avg / max question counts when the failing set size is floor(${numerator}n / ${denominator}).`;

  return {
    id,
    title,
    description,
    xAxisMin: baselineTargetCount,
    resolvePoint: (stats) => {
      if (stats.targetCount < baselineTargetCount) {
        return undefined;
      }

      const subsetSize = denominator === 1 ? numerator : Math.floor((stats.targetCount * numerator) / denominator);
      return createFixedSizeChartPoint(stats, subsetSize, subsetSizeLabel);
    },
  };
}

function createFixedSizeChartPoint(
  stats: ExactTargetCountStats,
  subsetSize: number,
  subsetSizeLabel: string,
): BenchmarkChartPoint | undefined {
  const exactStats = stats.bySubsetSize[subsetSize];
  if (!exactStats) {
    return undefined;
  }

  return createChartPoint(stats.targetCount, subsetSize, subsetSizeLabel, exactStats);
}

function createChartPoint(
  targetCount: number,
  subsetSize: number | null,
  subsetSizeLabel: string,
  stats: ExactQuestionStats,
): BenchmarkChartPoint {
  const averageQuestions = formatRatio(stats.totalQuestions, stats.subsetCount);
  return {
    targetCount,
    subsetCount: stats.subsetCount.toString(),
    subsetSize,
    subsetSizeLabel,
    totalQuestions: stats.totalQuestions.toString(),
    minQuestions: stats.minQuestions,
    maxQuestions: stats.maxQuestions,
    averageQuestions,
    averageQuestionsValue: Number.parseFloat(averageQuestions),
  };
}

function formatRatio(numerator: bigint, denominator: bigint): string {
  if (denominator === 0n) {
    throw new Error("Cannot format a ratio with denominator 0");
  }

  const integerPart = numerator / denominator;
  let remainder = numerator % denominator;

  if (remainder === 0n) {
    return integerPart.toString();
  }

  let fractionDigits = "";
  for (let index = 0; index < FIXED_DECIMAL_DIGITS; index += 1) {
    remainder *= 10n;
    fractionDigits += (remainder / denominator).toString();
    remainder %= denominator;
  }

  fractionDigits = fractionDigits.replace(/0+$/, "");
  return fractionDigits.length === 0 ? integerPart.toString() : `${integerPart}.${fractionDigits}`;
}

function ordinalName(value: number): string {
  switch (value) {
    case 4:
      return "quarter";
    case 5:
      return "fifth";
    case 6:
      return "sixth";
    case 7:
      return "seventh";
    case 8:
      return "eighth";
    default:
      return String(value);
  }
}

function formatBasisPointsPercent(basisPoints: number): string {
  const integerPart = Math.floor(basisPoints / 100);
  const fractionalPart = basisPoints % 100;
  return fractionalPart === 0 ? String(integerPart) : `${integerPart}.${String(fractionalPart).padStart(2, "0")}`;
}
