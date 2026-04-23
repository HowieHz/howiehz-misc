import { type CompatibilityTestAlgorithm } from "../src/compatibility-test/index.ts";

export interface ExactQuestionStats {
  subsetCount: bigint;
  totalQuestions: bigint;
  minQuestions: number;
  maxQuestions: number;
}

export interface ExactTargetCountStats {
  targetCount: number;
  bySubsetSize: (ExactQuestionStats | undefined)[];
  overall: ExactQuestionStats;
}

export interface BenchmarkChartPoint {
  targetCount: number;
  subsetCount: string;
  subsetSize: number | null;
  subsetSizeLabel: string;
  totalQuestions: string;
  minQuestions: number;
  maxQuestions: number;
  averageQuestions: string;
  averageQuestionsValue: number;
}

export interface BenchmarkChartSeries {
  algorithm: CompatibilityTestAlgorithm;
  points: BenchmarkChartPoint[];
}

export interface BenchmarkChart {
  id: string;
  title: string;
  description: string;
  xAxisMin: number;
  xAxisLabel: string;
  yAxisLabel: string;
  series: BenchmarkChartSeries[];
}

export interface BenchmarkResults {
  generatedAt: string;
  maxTargetCount: number;
  charts: BenchmarkChart[];
}

export type ExactBenchmarkStatsByAlgorithm = Record<CompatibilityTestAlgorithm, ExactTargetCountStats[]>;
