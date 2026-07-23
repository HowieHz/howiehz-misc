import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { stdout } from "node:process";
import { fileURLToPath, URL } from "node:url";

import { runCommand } from "./utils.js";

const EXPECTED_ORIGINAL_SOURCE_SHA256 = "756cb38c614f25380af7e6bd38be8189c8c196c1c8e2cf593b47ac6fa06c51f3";
const FRESH_JVM_RUNS = 3;
const MIXED_REPETITIONS = 100;
const SHOT_WAIT_MILLISECONDS = 5_000;
const packageRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const repoRoot = join(packageRoot, "..", "..");
const originalSourceRoot = join(repoRoot, "tmp", "graphwar", "src");
const configSource = join(
  packageRoot,
  "src",
  "main",
  "java",
  "top",
  "howiehz",
  "graphwar",
  "agent",
  "GraphwarAgentConfig.java",
);
const DEFAULT_MAX_FUNCTION_BYTES = readJavaIntegerConstant("DEFAULT_MAX_FUNCTION_BYTES");
const DEFAULT_MAX_FUNCTION_TOKENS = readJavaIntegerConstant("DEFAULT_MAX_FUNCTION_TOKENS");
const MAX_CONFIGURED_FUNCTION_BYTES = readJavaIntegerConstant("MAX_CONFIGURED_FUNCTION_BYTES");
const MAX_CONFIGURED_FUNCTION_TOKENS = readJavaIntegerConstant("MAX_CONFIGURED_FUNCTION_TOKENS");
const probeSource = join(packageRoot, "scripts", "probes", "GraphwarFunctionLimitProbe.java");
const cacheRoot = join(repoRoot, ".cache", "graphwar-function-limit-probe");
const classesRoot = join(cacheRoot, "classes");
const originalSources = [
  join(originalSourceRoot, "Graphwar", "PolishNotationFunction.java"),
  join(originalSourceRoot, "Graphwar", "FunctionToken.java"),
  join(originalSourceRoot, "Graphwar", "ValueToken.java"),
  join(originalSourceRoot, "Graphwar", "MalformedFunction.java"),
  join(originalSourceRoot, "GraphServer", "Constants.java"),
];

for (const source of originalSources) {
  if (!existsSync(source)) {
    throw new Error(`Original Graphwar source is required for this manual probe: ${relative(repoRoot, source)}`);
  }
}

rmSync(cacheRoot, { force: true, recursive: true });
mkdirSync(classesRoot, { recursive: true });
runCommand(
  "javac",
  ["--release", "8", "-Xlint:-options", "-encoding", "UTF-8", "-d", classesRoot, ...originalSources, probeSource],
  packageRoot,
);

const mixedCandidates = [4_608, 4_480, 4_464, 4_448, 4_432, 4_352, 4_096];
const totalRuns = mixedCandidates.length * FRESH_JVM_RUNS + 10 + 2 + 2 + 2;
let completedRuns = 0;
const mixedResults = [];

const originalSourceSha256 = hashSources(originalSources);
if (originalSourceSha256 !== EXPECTED_ORIGINAL_SOURCE_SHA256) {
  throw new Error(
    `Original Graphwar source hash changed: expected ${EXPECTED_ORIGINAL_SOURCE_SHA256}, received ${originalSourceSha256}`,
  );
}
stdout.write(`originalSourceSha256=${originalSourceSha256}\n`);
const javaVersion = spawnSync("java", ["-version"], { cwd: packageRoot, encoding: "utf8" });
if (javaVersion.status !== 0) {
  throwProbeError("java version", javaVersion);
}
stdout.write(`javaRuntime=${`${javaVersion.stdout}\n${javaVersion.stderr}`.trim().replaceAll(/\r?\n/gu, " | ")}\n`);
stdout.write(
  `cold-mixed-probe-start repetitionsPerShape=${MIXED_REPETITIONS} freshJvmsPerCandidate=${FRESH_JVM_RUNS} stack=1048576\n`,
);
for (const tokens of mixedCandidates) {
  let passes = 0;
  for (let run = 1; run <= FRESH_JVM_RUNS; run += 1) {
    const result = runProbe(["mixed", String(tokens), String(MIXED_REPETITIONS)]);
    if (result.status === 0) {
      passes += 1;
    } else if (result.status !== 1) {
      throwProbeError(`cold mixed tokens=${tokens} run=${run}`, result);
    }
    reportProgress(
      `cold-mixed tokens=${tokens} run=${run}/${FRESH_JVM_RUNS} result=${result.status === 0 ? "pass" : "overflow"}`,
      totalRuns,
    );
  }
  mixedResults.push({ passes, tokens });
  stdout.write(`tokens=${tokens} mixedPasses=${passes}/${FRESH_JVM_RUNS}\n`);
}

const firstUnstable = [...mixedResults]
  .sort((left, right) => left.tokens - right.tokens)
  .find((result) => result.passes < FRESH_JVM_RUNS);
if (!firstUnstable) {
  throw new Error("No unstable mixed-shape candidate was observed; extend the probe range");
}
const selectedTokens = Math.floor((firstUnstable.tokens * 0.7) / 1_024) * 1_024;
const configuredMaximumResult = mixedResults.find((result) => result.tokens === MAX_CONFIGURED_FUNCTION_TOKENS);
if (!configuredMaximumResult || configuredMaximumResult.passes !== FRESH_JVM_RUNS) {
  throw new Error("The configured maximum token limit did not pass every fresh-JVM mixed-shape probe");
}

let defaultPasses = 0;
for (let run = 1; run <= 10; run += 1) {
  const result = runProbe(["mixed", String(DEFAULT_MAX_FUNCTION_TOKENS), String(MIXED_REPETITIONS)]);
  if (result.status === 0) {
    defaultPasses += 1;
  } else if (result.status !== 1) {
    throwProbeError(`default verification run=${run}`, result);
  }
  reportProgress(
    `default tokens=${DEFAULT_MAX_FUNCTION_TOKENS} run=${run}/10 result=${result.status === 0 ? "pass" : "overflow"}`,
    totalRuns,
  );
}
stdout.write(
  `default-verification tokens=${DEFAULT_MAX_FUNCTION_TOKENS} mixedPasses=${defaultPasses}/10 repetitionsPerShape=${MIXED_REPETITIONS} stack=1048576\n`,
);
stdout.write(
  `selectedDefaultTokens=${selectedTokens} rationale="70% of the first unstable ${firstUnstable.tokens}-token cold mixed-shape result, rounded down"\n`,
);
stdout.write(
  `verifiedConfiguredMaximumTokens=${MAX_CONFIGURED_FUNCTION_TOKENS} mixedPasses=${configuredMaximumResult.passes}/${FRESH_JVM_RUNS}\n`,
);
if (defaultPasses !== 10 || DEFAULT_MAX_FUNCTION_TOKENS > selectedTokens) {
  throw new Error("The configured default token limit did not retain the measured safety margin");
}

for (const [label, tokens] of [
  ["default", DEFAULT_MAX_FUNCTION_TOKENS],
  ["configured maximum", MAX_CONFIGURED_FUNCTION_TOKENS],
]) {
  const performance = runProbe(["performance", String(tokens)]);
  if (performance.status !== 0) {
    throwProbeError(`${label} performance`, performance);
  }
  reportProgress(`${label} 20,000-evaluation performance probe`, totalRuns);
  stdout.write(performance.stdout);
  if (readMaximumMilliseconds(performance.stdout) >= SHOT_WAIT_MILLISECONDS) {
    throw new Error(`The ${label}-limit 20,000-evaluation probe exceeded the five-second shot wait`);
  }
}

for (const [label, bytes, tokens] of [
  ["default", DEFAULT_MAX_FUNCTION_BYTES, DEFAULT_MAX_FUNCTION_TOKENS],
  ["configured maximum", MAX_CONFIGURED_FUNCTION_BYTES, MAX_CONFIGURED_FUNCTION_TOKENS],
]) {
  const combinedBoundary = runProbe(["combined", String(bytes), String(tokens)]);
  if (combinedBoundary.status !== 0) {
    throwProbeError(`${label} combined byte/token boundary`, combinedBoundary);
  }
  reportProgress(`${label} combined byte/token boundary`, totalRuns);
  stdout.write(combinedBoundary.stdout);
  const isWithinShotWait = readMaximumMilliseconds(combinedBoundary.stdout) < SHOT_WAIT_MILLISECONDS;
  stdout.write(`combinedWithinShotWait=${isWithinShotWait} boundary=${label}\n`);
  if (label === "default" && !isWithinShotWait) {
    throw new Error(`The ${label} combined byte/token boundary exceeded the five-second shot wait`);
  }
}

stdout.write("bracket-byte-probe effectiveTokens=1\n");
for (const bytes of [DEFAULT_MAX_FUNCTION_BYTES - 1, MAX_CONFIGURED_FUNCTION_BYTES - 1]) {
  const result = runProbe(["bracket", String(bytes)]);
  if (result.status !== 0) {
    throwProbeError(`bracket bytes=${bytes}`, result);
  }
  reportProgress(`bracket bytes=${bytes}`, totalRuns);
  stdout.write(result.stdout);
  if (readMaximumMilliseconds(result.stdout) >= SHOT_WAIT_MILLISECONDS) {
    throw new Error(`The ${bytes}-byte bracket-heavy probe exceeded the five-second shot wait`);
  }
}
stdout.write(
  `defaultFunctionBytes=${DEFAULT_MAX_FUNCTION_BYTES} verifiedConfiguredMaximumFunctionBytes=${MAX_CONFIGURED_FUNCTION_BYTES}\n`,
);

/** Runs one fresh 1 MiB-stack JVM against the unmodified original parser classes. */
function runProbe(arguments_) {
  return spawnSync("java", ["-Xss1m", "-cp", classesRoot, "Graphwar.GraphwarFunctionLimitProbe", ...arguments_], {
    cwd: packageRoot,
    encoding: "utf8",
    maxBuffer: 4 * 1_024 * 1_024,
    timeout: 120_000,
  });
}

/** Reports deterministic progress without relying on an interactive terminal. */
function reportProgress(label, total) {
  completedRuns += 1;
  const width = 32;
  const filled = Math.floor((completedRuns * width) / total);
  stdout.write(`[${"#".repeat(filled)}${"-".repeat(width - filled)}] ${label}\n`);
}

/** Hashes the exact original source snapshot used by the offline measurement. */
function hashSources(sources) {
  const hash = createHash("sha256");
  for (const source of sources) {
    hash.update(relative(originalSourceRoot, source).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(readFileSync(source));
    hash.update("\0");
  }
  return hash.digest("hex");
}

/** Reads one numeric production boundary so the probe cannot silently drift from the Agent. */
function readJavaIntegerConstant(name) {
  const match = readFileSync(configSource, "utf8").match(new RegExp(`static final int ${name} = ([0-9_]+);`, "u"));
  if (!match) {
    throw new Error(`Cannot read ${name} from ${relative(repoRoot, configSource)}`);
  }
  return Number.parseInt(match[1].replaceAll("_", ""), 10);
}

/** Extracts the slowest millisecond measurement emitted by one probe process. */
function readMaximumMilliseconds(output) {
  let maximum = -1;
  for (const match of output.matchAll(/(?:ms|parseMs)=([0-9]+)/gu)) {
    maximum = Math.max(maximum, Number.parseInt(match[1], 10));
  }
  if (maximum < 0) {
    throw new Error(`Probe output did not include a millisecond measurement: ${output.trim()}`);
  }
  return maximum;
}

/** Converts an unexpected child-JVM result into one concise actionable failure. */
function throwProbeError(label, result) {
  if (result.error) {
    throw result.error;
  }
  throw new Error(`${label} probe failed with status ${result.status}: ${`${result.stdout}\n${result.stderr}`.trim()}`);
}
