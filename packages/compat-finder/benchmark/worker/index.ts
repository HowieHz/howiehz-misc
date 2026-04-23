import { parentPort } from "node:worker_threads";

import { renderBenchmarkChartSvg } from "../charts/svg.ts";
import { computeExhaustiveBenchmarkStatsForTargetCount } from "../exhaustive-stats.ts";
import { type BenchmarkWorkerResult, type BenchmarkWorkerTask } from "./protocol.ts";

const port = parentPort;

if (!port) {
  throw new Error("benchmark worker requires a parent port");
}

port.on("message", (task: BenchmarkWorkerTask) => {
  port.postMessage(runTask(task));
});

function runTask(task: BenchmarkWorkerTask): BenchmarkWorkerResult {
  switch (task.type) {
    case "compute-target-count-stats":
      return {
        type: "compute-target-count-stats",
        algorithm: task.algorithm,
        stats: computeExhaustiveBenchmarkStatsForTargetCount(task.targetCount, task.algorithm),
        targetCount: task.targetCount,
      };
    case "render-chart":
      return {
        type: "render-chart",
        chartId: task.chart.id,
        svg: renderBenchmarkChartSvg(task.chart),
      };
  }
}
