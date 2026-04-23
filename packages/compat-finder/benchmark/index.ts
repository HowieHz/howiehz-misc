import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { Worker } from "node:worker_threads";

import { COMPATIBILITY_TEST_ALGORITHMS } from "../src/compatibility-test/index.ts";
import { buildBenchmarkResults } from "./charts/index.ts";
import { renderBenchmarkChartSvg } from "./charts/svg.ts";
import { getDetectedCpuCount, parseBenchmarkWorkerCount } from "./runtime.ts";
import { computeExactBenchmarkStatsForAlgorithm } from "./stats.ts";
import { type BenchmarkChart, type ExactBenchmarkStatsByAlgorithm } from "./types.ts";
import { type BenchmarkWorkerResult, type BenchmarkWorkerTask } from "./worker/protocol.ts";

const DEFAULT_MAX_TARGET_COUNT = 1_000;
const DEFAULT_OUTPUT_DIR = path.resolve(import.meta.dirname, "output");
const BENCHMARK_WORKER_URL = new URL("./worker/index.ts", import.meta.url);

async function main(): Promise<void> {
  const { values } = parseArgs({
    allowPositionals: false,
    options: {
      "max-target-count": {
        type: "string",
      },
      "output-dir": {
        type: "string",
      },
      workers: {
        type: "string",
      },
    },
  });

  const maxTargetCount = parseMaxTargetCount(values["max-target-count"]);
  const detectedCpuCount = getDetectedCpuCount();
  const workerCount = parseBenchmarkWorkerCount(values.workers);
  const outputDir = values["output-dir"] ? path.resolve(process.cwd(), values["output-dir"]) : DEFAULT_OUTPUT_DIR;
  const chartsDir = path.join(outputDir, "charts");

  const statsByAlgorithm = await computeStatsByAlgorithm(maxTargetCount, workerCount);
  const results = buildBenchmarkResults(maxTargetCount, statsByAlgorithm);
  const renderedCharts = await renderCharts(results.charts, workerCount);

  await mkdir(chartsDir, { recursive: true });
  await writeFile(path.join(outputDir, "results.json"), `${JSON.stringify(results, null, 2)}\n`, "utf8");

  await Promise.all(
    results.charts.map((chart) =>
      writeFile(
        path.join(chartsDir, `${chart.id}.svg`),
        `${renderedCharts.get(chart.id) ?? renderBenchmarkChartSvg(chart)}\n`,
        "utf8",
      ),
    ),
  );

  process.stdout.write(
    [
      `compat-finder benchmark written to ${outputDir}`,
      `detectedCpuCount=${detectedCpuCount}`,
      `workerCount=${workerCount}`,
      `maxTargetCount=${maxTargetCount}`,
      `charts=${results.charts.length}`,
    ].join("\n"),
  );
}

function parseMaxTargetCount(rawValue: string | undefined): number {
  if (rawValue === undefined) {
    return DEFAULT_MAX_TARGET_COUNT;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("--max-target-count must be an integer greater than or equal to 1");
  }

  return parsed;
}

async function computeStatsByAlgorithm(
  maxTargetCount: number,
  workerCount: number,
): Promise<ExactBenchmarkStatsByAlgorithm> {
  if (workerCount <= 1) {
    return {
      "binary-split": computeExactBenchmarkStatsForAlgorithm(maxTargetCount, "binary-split"),
      "leave-one-out": computeExactBenchmarkStatsForAlgorithm(maxTargetCount, "leave-one-out"),
    };
  }

  const tasks: BenchmarkWorkerTask[] = COMPATIBILITY_TEST_ALGORITHMS.map((algorithm) => ({
    type: "compute-algorithm-stats",
    algorithm,
    maxTargetCount,
  }));
  const results = await runWorkerTasks(tasks, workerCount);
  let binarySplitStats: ExactBenchmarkStatsByAlgorithm["binary-split"] | undefined;
  let leaveOneOutStats: ExactBenchmarkStatsByAlgorithm["leave-one-out"] | undefined;

  for (const result of results) {
    if (result.type !== "compute-algorithm-stats") {
      throw new Error(`Unexpected worker result type: ${result.type}`);
    }

    if (result.algorithm === "binary-split") {
      binarySplitStats = result.stats;
      continue;
    }

    leaveOneOutStats = result.stats;
  }

  if (!binarySplitStats || !leaveOneOutStats) {
    throw new Error("Missing benchmark stats from worker results");
  }

  return {
    "binary-split": binarySplitStats,
    "leave-one-out": leaveOneOutStats,
  };
}

async function renderCharts(charts: readonly BenchmarkChart[], workerCount: number): Promise<Map<string, string>> {
  if (workerCount <= 1) {
    return new Map(charts.map((chart) => [chart.id, renderBenchmarkChartSvg(chart)]));
  }

  const tasks: BenchmarkWorkerTask[] = charts.map((chart) => ({
    type: "render-chart",
    chart,
  }));
  const results = await runWorkerTasks(tasks, workerCount);
  return new Map(
    results.map((result) => {
      if (result.type !== "render-chart") {
        throw new Error(`Unexpected worker result type: ${result.type}`);
      }

      return [result.chartId, result.svg] as const;
    }),
  );
}

async function runWorkerTasks(tasks: BenchmarkWorkerTask[], workerCount: number): Promise<BenchmarkWorkerResult[]> {
  if (tasks.length === 0) {
    return [];
  }

  const results: BenchmarkWorkerResult[] = new Array(tasks.length);
  let nextTaskIndex = 0;
  const laneCount = Math.min(workerCount, tasks.length);
  const workerPool = Array.from({ length: laneCount }, () => createWorkerHandle());

  try {
    await Promise.all(
      workerPool.map(async (workerHandle) => {
        while (true) {
          const taskIndex = nextTaskIndex;
          nextTaskIndex += 1;

          const task = tasks[taskIndex];
          if (!task) {
            return;
          }

          results[taskIndex] = await workerHandle.run(task);
        }
      }),
    );
  } finally {
    await Promise.all(workerPool.map((workerHandle) => workerHandle.close()));
  }

  return results;
}

interface WorkerHandle {
  close: () => Promise<void>;
  run: (task: BenchmarkWorkerTask) => Promise<BenchmarkWorkerResult>;
}

function createWorkerHandle(): WorkerHandle {
  const worker = new Worker(BENCHMARK_WORKER_URL, {
    execArgv: ensureStripTypesExecArgv(),
  });
  let runningTask = false;
  let closed = false;

  return {
    async close(): Promise<void> {
      if (closed) {
        return;
      }

      closed = true;
      await worker.terminate();
    },
    async run(task: BenchmarkWorkerTask): Promise<BenchmarkWorkerResult> {
      if (closed) {
        throw new Error("Cannot schedule a task on a closed benchmark worker");
      }

      if (runningTask) {
        throw new Error("Cannot schedule multiple benchmark tasks on the same worker concurrently");
      }

      runningTask = true;
      return await new Promise<BenchmarkWorkerResult>((resolve, reject) => {
        const cleanup = () => {
          worker.off("message", handleMessage);
          worker.off("error", handleError);
          worker.off("exit", handleExit);
          runningTask = false;
        };

        const handleMessage = (result: BenchmarkWorkerResult) => {
          cleanup();
          resolve(result);
        };
        const handleError = (error: Error) => {
          cleanup();
          closed = true;
          reject(error);
        };
        const handleExit = (code: number) => {
          cleanup();
          closed = true;
          reject(
            new Error(
              code === 0
                ? "Benchmark worker exited before completing the current task"
                : `Benchmark worker exited with code ${code}`,
            ),
          );
        };

        worker.once("message", handleMessage);
        worker.once("error", handleError);
        worker.once("exit", handleExit);
        worker.postMessage(task);
      });
    },
  };
}

function ensureStripTypesExecArgv(): string[] {
  return process.execArgv.includes("--experimental-strip-types")
    ? process.execArgv
    : [...process.execArgv, "--experimental-strip-types"];
}

await main();
