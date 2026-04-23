import { parentPort } from "node:worker_threads";

import { renderBenchmarkChartSvg } from "../charts/svg.ts";
import { computeExactBenchmarkStatsForAlgorithm } from "../exact-stats.ts";
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
