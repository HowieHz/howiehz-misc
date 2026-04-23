import { availableParallelism, cpus } from "node:os";

export function getDetectedCpuCount(): number {
  return typeof availableParallelism === "function" ? availableParallelism() : cpus().length;
}

export function getDefaultBenchmarkWorkerCount(): number {
  return Math.max(1, getDetectedCpuCount() - 2);
}

export function parseBenchmarkWorkerCount(rawValue: string | undefined): number {
  if (rawValue === undefined) {
    return getDefaultBenchmarkWorkerCount();
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("--workers must be an integer greater than or equal to 1");
  }

  return parsed;
}
