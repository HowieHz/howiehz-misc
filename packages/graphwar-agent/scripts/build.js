import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { stdout } from "node:process";
import { fileURLToPath, URL } from "node:url";

const packageRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const sourceRoot = join(packageRoot, "src", "main", "java");
const buildRoot = join(packageRoot, "build");
const generatedSourceRoot = join(buildRoot, "generated", "java");
const classesRoot = join(buildRoot, "classes");
const libsRoot = join(buildRoot, "libs");
const manifestPath = join(buildRoot, "manifest.mf");
const jarPath = join(libsRoot, "graphwar-agent.jar");
const buildInfoPath = join(generatedSourceRoot, "top", "howiehz", "graphwar", "agent", "GraphwarAgentBuildInfo.java");
const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));

function collectJavaSources(rootDirectory) {
  const sources = [];
  const pendingDirectories = [rootDirectory];

  while (pendingDirectories.length > 0) {
    const directory = pendingDirectories.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        pendingDirectories.push(path);
      } else if (entry.isFile() && extname(entry.name) === ".java") {
        sources.push(path);
      }
    }
  }

  return sources;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: packageRoot,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
}

function readGitOutput(args, fallback) {
  const result = spawnSync("git", args, {
    cwd: packageRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return fallback;
  }
  return result.stdout.trim() || fallback;
}

function createBuildInfo() {
  // Use the latest commit that touched this package, not HEAD. The docs jar is
  // auto-committed separately, so HEAD would make the checked-in jar chase its
  // own commit forever.
  const sourceCommit = readGitOutput(["log", "-1", "--format=%H", "--", "."], "unknown");
  const sourceCommitTime = readGitOutput(["log", "-1", "--format=%cI", "--", "."], "unknown");
  return {
    sourceCommit,
    sourceCommitShort: sourceCommit === "unknown" ? "unknown" : sourceCommit.slice(0, 12),
    sourceCommitTime,
    version: String(packageJson.version ?? "0.0.0"),
  };
}

function writeBuildInfoSource(buildInfo) {
  mkdirSync(dirname(buildInfoPath), { recursive: true });
  writeFileSync(
    buildInfoPath,
    [
      "package top.howiehz.graphwar.agent;",
      "",
      "final class GraphwarAgentBuildInfo {",
      `    static final String VERSION = create("${escapeJavaString(buildInfo.version)}");`,
      `    static final String SOURCE_COMMIT = create("${escapeJavaString(buildInfo.sourceCommit)}");`,
      `    static final String SOURCE_COMMIT_SHORT = create("${escapeJavaString(buildInfo.sourceCommitShort)}");`,
      `    static final String SOURCE_COMMIT_TIME = create("${escapeJavaString(buildInfo.sourceCommitTime)}");`,
      "",
      "    private GraphwarAgentBuildInfo() {",
      "    }",
      "",
      "    private static String create(String value) {",
      "        return value;",
      "    }",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
}

function escapeJavaString(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function getJarTimestamp(sourceCommitTime) {
  const timestamp = new Date(sourceCommitTime);
  if (Number.isNaN(timestamp.getTime())) {
    return "1980-01-01T00:00:02Z";
  }
  return timestamp.toISOString().replace(".000Z", "Z");
}

function jarSupportsDateOption() {
  const result = spawnSync("jar", ["--help"], {
    cwd: packageRoot,
    encoding: "utf8",
  });
  return result.status === 0 && `${result.stdout}\n${result.stderr}`.includes("--date");
}

rmSync(buildRoot, { force: true, recursive: true });
mkdirSync(classesRoot, { recursive: true });
mkdirSync(libsRoot, { recursive: true });

const buildInfo = createBuildInfo();
writeBuildInfoSource(buildInfo);

const sources = [...collectJavaSources(sourceRoot), ...collectJavaSources(generatedSourceRoot)];
if (sources.length === 0) {
  throw new Error(`No Java sources found under ${relative(packageRoot, sourceRoot)}`);
}

run("javac", ["--release", "8", "-Xlint:-options", "-encoding", "UTF-8", "-d", classesRoot, ...sources]);

writeFileSync(
  manifestPath,
  [
    "Manifest-Version: 1.0",
    "Premain-Class: top.howiehz.graphwar.agent.GraphwarAgent",
    "Agent-Class: top.howiehz.graphwar.agent.GraphwarAgent",
    `Implementation-Version: ${buildInfo.version}`,
    `Graphwar-Agent-Source-Commit: ${buildInfo.sourceCommit}`,
    `Graphwar-Agent-Source-Commit-Time: ${buildInfo.sourceCommitTime}`,
    "Can-Redefine-Classes: false",
    "Can-Retransform-Classes: false",
    "",
  ].join("\n"),
  "utf8",
);

const jarArgs = jarSupportsDateOption()
  ? [
      "--create",
      "--file",
      jarPath,
      "--manifest",
      manifestPath,
      `--date=${getJarTimestamp(buildInfo.sourceCommitTime)}`,
      "-C",
      classesRoot,
      ".",
    ]
  : ["cfm", jarPath, manifestPath, "-C", classesRoot, "."];
run("jar", jarArgs);

stdout.write(`Built ${relative(packageRoot, jarPath)}\n`);
