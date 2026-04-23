import { type CompatibilityTestAlgorithm } from "../../src/compatibility-test/index.ts";
import { type BenchmarkChart, type ExactTargetCountStats } from "../types.ts";

export type BenchmarkWorkerTask = ComputeAlgorithmStatsWorkerTask | RenderChartWorkerTask;

export interface ComputeAlgorithmStatsWorkerTask {
  type: "compute-algorithm-stats";
  algorithm: CompatibilityTestAlgorithm;
  maxTargetCount: number;
}

export interface RenderChartWorkerTask {
  type: "render-chart";
  chart: BenchmarkChart;
}

export type BenchmarkWorkerResult = ComputeAlgorithmStatsWorkerResult | RenderChartWorkerResult;

export interface ComputeAlgorithmStatsWorkerResult {
  type: "compute-algorithm-stats";
  algorithm: CompatibilityTestAlgorithm;
  stats: ExactTargetCountStats[];
}

export interface RenderChartWorkerResult {
  type: "render-chart";
  chartId: string;
  svg: string;
}
