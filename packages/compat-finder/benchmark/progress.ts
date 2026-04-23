import { stdout } from "node:process";

const PROGRESS_BAR_WIDTH = 24;

export interface BenchmarkProgressUpdate {
  completedTaskCount: number;
  currentTaskDescription: string;
}

export interface BenchmarkProgressReporter {
  finishPhase: () => void;
  startPhase: (label: string, totalTaskCount: number, totalWorkUnits: bigint) => void;
  update: (workUnits: bigint, update: BenchmarkProgressUpdate) => void;
}

export function createBenchmarkProgressReporter(): BenchmarkProgressReporter {
  let completedTaskCount = 0;
  let currentLabel = "";
  let lastLineLength = 0;
  let totalTaskCount = 0;
  let totalWorkUnits = 0n;
  let completedWorkUnits = 0n;

  return {
    finishPhase() {
      if (stdout.isTTY) {
        stdout.write("\n");
      }
    },
    startPhase(label, nextTotalTaskCount, nextTotalWorkUnits) {
      completedTaskCount = 0;
      currentLabel = label;
      lastLineLength = 0;
      totalTaskCount = nextTotalTaskCount;
      totalWorkUnits = nextTotalWorkUnits;
      completedWorkUnits = 0n;
      renderProgressLine(currentLabel, totalTaskCount, completedTaskCount, totalWorkUnits, completedWorkUnits, "");
    },
    update(workUnits, update) {
      completedTaskCount = update.completedTaskCount;
      completedWorkUnits += workUnits;
      renderProgressLine(
        currentLabel,
        totalTaskCount,
        completedTaskCount,
        totalWorkUnits,
        completedWorkUnits,
        update.currentTaskDescription,
      );
    },
  };

  function renderProgressLine(
    label: string,
    phaseTotalTaskCount: number,
    phaseCompletedTaskCount: number,
    phaseTotalWorkUnits: bigint,
    phaseCompletedWorkUnits: bigint,
    currentTaskDescription: string,
  ): void {
    const line = [
      renderProgressBar(phaseCompletedWorkUnits, phaseTotalWorkUnits),
      formatPercent(phaseCompletedWorkUnits, phaseTotalWorkUnits),
      label,
      `(${phaseCompletedTaskCount}/${phaseTotalTaskCount})`,
      currentTaskDescription,
    ]
      .filter((part) => part.length > 0)
      .join(" ");

    if (!stdout.isTTY) {
      stdout.write(`${line}\n`);
      return;
    }

    const paddedLine = line.padEnd(lastLineLength);
    lastLineLength = paddedLine.length;
    stdout.write(`\r${paddedLine}`);
  }
}

function renderProgressBar(completedWorkUnits: bigint, totalWorkUnits: bigint): string {
  const filledWidth =
    totalWorkUnits === 0n
      ? PROGRESS_BAR_WIDTH
      : Number((completedWorkUnits * BigInt(PROGRESS_BAR_WIDTH)) / totalWorkUnits);
  return `[${"#".repeat(filledWidth)}${"-".repeat(PROGRESS_BAR_WIDTH - filledWidth)}]`;
}

function formatPercent(completedWorkUnits: bigint, totalWorkUnits: bigint): string {
  if (totalWorkUnits === 0n) {
    return "100.0%";
  }

  const permille = (completedWorkUnits * 1000n) / totalWorkUnits;
  const integerPart = permille / 10n;
  const fractionalPart = permille % 10n;
  return `${integerPart}.${fractionalPart}%`;
}
