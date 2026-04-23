import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { stdout } from "node:process";
import { parseArgs } from "node:util";
import { Worker } from "node:worker_threads";

import { COMPATIBILITY_TEST_ALGORITHMS } from "../src/compatibility-test/index.ts";
import { buildBenchmarkResults } from "./charts/index.ts";
import { renderBenchmarkChartSvg } from "./charts/svg.ts";
import { computeExactBenchmarkStatsForAlgorithm } from "./exact-stats.ts";
import { createBenchmarkProgressReporter } from "./progress.ts";
import { getDetectedCpuCount, parseBenchmarkWorkerCount } from "./runtime.ts";
import { type BenchmarkChart, type ExactBenchmarkStatsByAlgorithm, type ExactTargetCountStats } from "./types.ts";
import { type BenchmarkWorkerResult, type BenchmarkWorkerTask } from "./worker/protocol.ts";

const DEFAULT_MAX_TARGET_COUNT = 1024;
const DEFAULT_OUTPUT_DIR = path.resolve(import.meta.dirname, "output");
const BENCHMARK_WORKER_URL = new URL("./worker/index.ts", import.meta.url);

interface QueuedBenchmarkTask {
  description: string;
  task: BenchmarkWorkerTask;
  workUnits: bigint;
}

interface WorkerHandle {
  close: () => Promise<void>;
  run: (task: BenchmarkWorkerTask) => Promise<BenchmarkWorkerResult>;
}

async function main(): Promise<void> {
  const benchmarkStartedAt = process.hrtime.bigint();
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
  const progressReporter = createBenchmarkProgressReporter();

  const statsTasks = createComputeStatsTasks(maxTargetCount);
  const statsStartedAt = process.hrtime.bigint();
  progressReporter.startPhase("Computing exact stats", statsTasks.length, sumTaskWorkUnits(statsTasks));
  const statsResults = await runBenchmarkTasks(statsTasks, workerCount, (task, completedTaskCount) => {
    progressReporter.update(task.workUnits, {
      completedTaskCount,
      currentTaskDescription: task.description,
    });
  });
  progressReporter.finishPhase();
  const statsElapsedNanoseconds = process.hrtime.bigint() - statsStartedAt;
  const statsByAlgorithm = collectComputedStats(statsResults, maxTargetCount);

  const results = buildBenchmarkResults(maxTargetCount, statsByAlgorithm);
  const chartTasks = createRenderChartTasks(results.charts);
  const chartsStartedAt = process.hrtime.bigint();
  progressReporter.startPhase("Rendering charts", chartTasks.length, sumTaskWorkUnits(chartTasks));
  const renderedCharts = collectRenderedCharts(
    await runBenchmarkTasks(chartTasks, workerCount, (task, completedTaskCount) => {
      progressReporter.update(task.workUnits, {
        completedTaskCount,
        currentTaskDescription: task.description,
      });
    }),
  );
  progressReporter.finishPhase();
  const chartsElapsedNanoseconds = process.hrtime.bigint() - chartsStartedAt;

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

  stdout.write(
    [
      `compat-finder benchmark written to ${outputDir}`,
      `detectedCpuCount=${detectedCpuCount}`,
      `workerCount=${workerCount}`,
      `maxTargetCount=${maxTargetCount}`,
      "benchmarkMode=exact-stats",
      `statsElapsed=${formatDuration(statsElapsedNanoseconds)}`,
      `chartsElapsed=${formatDuration(chartsElapsedNanoseconds)}`,
      `totalElapsed=${formatDuration(process.hrtime.bigint() - benchmarkStartedAt)}`,
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

function createComputeStatsTasks(maxTargetCount: number): QueuedBenchmarkTask[] {
  return COMPATIBILITY_TEST_ALGORITHMS.map((algorithm) => ({
    description: algorithm,
    task: {
      type: "compute-algorithm-stats",
      algorithm,
      maxTargetCount,
    },
    workUnits: 1n,
  }));
}

function createRenderChartTasks(charts: readonly BenchmarkChart[]): QueuedBenchmarkTask[] {
  return charts.map((chart) => ({
    description: chart.id,
    task: {
      type: "render-chart",
      chart,
    },
    workUnits: 1n,
  }));
}

function sumTaskWorkUnits(tasks: readonly QueuedBenchmarkTask[]): bigint {
  let totalWorkUnits = 0n;

  for (const task of tasks) {
    totalWorkUnits += task.workUnits;
  }

  return totalWorkUnits;
}

async function runBenchmarkTasks(
  tasks: readonly QueuedBenchmarkTask[],
  workerCount: number,
  onTaskCompleted: (task: QueuedBenchmarkTask, completedTaskCount: number) => void,
): Promise<BenchmarkWorkerResult[]> {
  if (tasks.length === 0) {
    return [];
  }

  return workerCount <= 1
    ? runTasksLocally(tasks, onTaskCompleted)
    : runTasksWithWorkers(tasks, workerCount, onTaskCompleted);
}

async function runTasksLocally(
  tasks: readonly QueuedBenchmarkTask[],
  onTaskCompleted: (task: QueuedBenchmarkTask, completedTaskCount: number) => void,
): Promise<BenchmarkWorkerResult[]> {
  const results: BenchmarkWorkerResult[] = [];

  for (const [taskIndex, task] of tasks.entries()) {
    results[taskIndex] = runTaskLocally(task.task);
    onTaskCompleted(task, taskIndex + 1);
  }

  return results;
}

async function runTasksWithWorkers(
  tasks: readonly QueuedBenchmarkTask[],
  workerCount: number,
  onTaskCompleted: (task: QueuedBenchmarkTask, completedTaskCount: number) => void,
): Promise<BenchmarkWorkerResult[]> {
  const results: BenchmarkWorkerResult[] = new Array(tasks.length);
  const nextTaskIndex = createTaskIndexAllocator();
  const workerPool = createWorkerPool(workerCount, tasks.length);
  let completedTaskCount = 0;

  try {
    await Promise.all(
      workerPool.map((workerHandle) =>
        runWorkerLane(workerHandle, tasks, results, nextTaskIndex, (task) => {
          completedTaskCount += 1;
          onTaskCompleted(task, completedTaskCount);
        }),
      ),
    );
  } finally {
    await Promise.all(workerPool.map((workerHandle) => workerHandle.close()));
  }

  return results;
}

function runTaskLocally(task: BenchmarkWorkerTask): BenchmarkWorkerResult {
  switch (task.type) {
    case "compute-algorithm-stats":
      return {
        type: "compute-algorithm-stats",
        algorithm: task.algorithm,
        stats: computeExactBenchmarkStatsForAlgorithm(task.maxTargetCount, task.algorithm),
      };
    case "render-chart":
      return {
        type: "render-chart",
        chartId: task.chart.id,
        svg: renderBenchmarkChartSvg(task.chart),
      };
  }
}

function collectComputedStats(
  results: readonly BenchmarkWorkerResult[],
  maxTargetCount: number,
): ExactBenchmarkStatsByAlgorithm {
  const statsByAlgorithm = createEmptyStatsByAlgorithm(maxTargetCount);

  for (const result of results) {
    assertComputeAlgorithmStatsWorkerResult(result);
    statsByAlgorithm[result.algorithm] = result.stats;
  }

  for (const algorithm of COMPATIBILITY_TEST_ALGORITHMS) {
    for (let targetCount = 1; targetCount <= maxTargetCount; targetCount += 1) {
      if (!statsByAlgorithm[algorithm][targetCount]) {
        throw new Error(`Missing benchmark stats for ${algorithm} targetCount=${targetCount}`);
      }
    }
  }

  return statsByAlgorithm;
}

function createEmptyStatsByAlgorithm(maxTargetCount: number): ExactBenchmarkStatsByAlgorithm {
  return {
    "binary-split": new Array<ExactTargetCountStats | undefined>(
      maxTargetCount + 1,
    ) as ExactBenchmarkStatsByAlgorithm["binary-split"],
    "leave-one-out": new Array<ExactTargetCountStats | undefined>(
      maxTargetCount + 1,
    ) as ExactBenchmarkStatsByAlgorithm["leave-one-out"],
  };
}

function collectRenderedCharts(results: readonly BenchmarkWorkerResult[]): Map<string, string> {
  return new Map(
    results.map((result) => {
      if (result.type !== "render-chart") {
        throw new Error(`Unexpected worker result type: ${result.type}`);
      }

      return [result.chartId, result.svg] as const;
    }),
  );
}

function createTaskIndexAllocator(): () => number {
  let nextTaskIndex = 0;
  return () => {
    const taskIndex = nextTaskIndex;
    nextTaskIndex += 1;
    return taskIndex;
  };
}

function createWorkerPool(workerCount: number, taskCount: number): WorkerHandle[] {
  const laneCount = Math.min(workerCount, taskCount);
  return Array.from({ length: laneCount }, () => createWorkerHandle());
}

async function runWorkerLane(
  workerHandle: WorkerHandle,
  tasks: readonly QueuedBenchmarkTask[],
  results: BenchmarkWorkerResult[],
  nextTaskIndex: () => number,
  onTaskCompleted: (task: QueuedBenchmarkTask) => void,
): Promise<void> {
  while (true) {
    const taskIndex = nextTaskIndex();
    const queuedTask = tasks[taskIndex];
    if (!queuedTask) {
      return;
    }

    results[taskIndex] = await workerHandle.run(queuedTask.task);
    onTaskCompleted(queuedTask);
  }
}

function assertComputeAlgorithmStatsWorkerResult(
  result: BenchmarkWorkerResult,
): asserts result is Extract<BenchmarkWorkerResult, { type: "compute-algorithm-stats" }> {
  if (result.type === "compute-algorithm-stats") {
    return;
  }

  throw new Error(`Unexpected worker result type: ${result.type}`);
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
      assertWorkerCanRunTask(closed, runningTask);
      runningTask = true;
      return await runTaskOnWorker(
        worker,
        task,
        () => {
          runningTask = false;
        },
        () => {
          closed = true;
        },
      );
    },
  };
}

function ensureStripTypesExecArgv(): string[] {
  return process.execArgv.includes("--experimental-strip-types")
    ? process.execArgv
    : [...process.execArgv, "--experimental-strip-types"];
}

function assertWorkerCanRunTask(closed: boolean, runningTask: boolean): void {
  if (closed) {
    throw new Error("Cannot schedule a task on a closed benchmark worker");
  }

  if (!runningTask) {
    return;
  }

  throw new Error("Cannot schedule multiple benchmark tasks on the same worker concurrently");
}

async function runTaskOnWorker(
  worker: Worker,
  task: BenchmarkWorkerTask,
  markTaskComplete: () => void,
  markWorkerClosed: () => void,
): Promise<BenchmarkWorkerResult> {
  return await new Promise<BenchmarkWorkerResult>((resolve, reject) => {
    const cleanup = () => {
      worker.off("message", handleMessage);
      worker.off("error", handleError);
      worker.off("exit", handleExit);
      markTaskComplete();
    };

    const handleMessage = (result: BenchmarkWorkerResult) => {
      cleanup();
      resolve(result);
    };
    const handleError = (error: Error) => {
      cleanup();
      markWorkerClosed();
      reject(error);
    };
    const handleExit = (code: number) => {
      cleanup();
      markWorkerClosed();
      reject(new Error(getUnexpectedWorkerExitMessage(code)));
    };

    worker.once("message", handleMessage);
    worker.once("error", handleError);
    worker.once("exit", handleExit);
    worker.postMessage(task);
  });
}

function getUnexpectedWorkerExitMessage(code: number): string {
  if (code === 0) {
    return "Benchmark worker exited before completing the current task";
  }

  return `Benchmark worker exited with code ${code}`;
}

function formatDuration(durationNanoseconds: bigint): string {
  const durationMilliseconds = Number(durationNanoseconds) / 1_000_000;
  if (durationMilliseconds < 1_000) {
    return `${durationMilliseconds.toFixed(1)}ms`;
  }

  const durationSeconds = durationMilliseconds / 1_000;
  if (durationSeconds < 60) {
    return `${durationSeconds.toFixed(2)}s`;
  }

  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds - minutes * 60;
  return `${minutes}m ${seconds.toFixed(2)}s`;
}

await main();
