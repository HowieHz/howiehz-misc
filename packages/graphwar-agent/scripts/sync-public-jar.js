import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { stdout } from "node:process";
import { fileURLToPath, URL } from "node:url";

import { collectFiles } from "./utils.js";

const packageRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const repoRoot = join(packageRoot, "..", "..");
const buildRoot = join(packageRoot, "build");
const builtJarPath = join(packageRoot, "build", "libs", "graphwar-agent.jar");
const publicJarPath = join(repoRoot, "docs", "public", "graphwar-agent.jar");
const publicMetadataPath = join(repoRoot, "docs", "public", "graphwar-agent.json");
const buildInfoClassPath = "top/howiehz/graphwar/agent/GraphwarAgentBuildInfo.class";
const manifestPath = "META-INF/MANIFEST.MF";

if (!existsSync(builtJarPath)) {
  throw new Error(`Built jar was not found at ${relative(repoRoot, builtJarPath)}`);
}

mkdirSync(dirname(publicJarPath), { recursive: true });

if (existsSync(publicJarPath) && effectiveJarHash(builtJarPath) === effectiveJarHash(publicJarPath)) {
  stdout.write(`Public jar is already up to date: ${relative(repoRoot, publicJarPath)}\n`);
} else {
  copyFileSync(builtJarPath, publicJarPath);
  stdout.write(`Updated ${relative(repoRoot, publicJarPath)}\n`);
}

writePublicMetadata();

/** 为文档站生成公开 JAR 的哈希和内嵌构建来源信息。 */
function writePublicMetadata() {
  const content = readFileSync(publicJarPath);
  const metadata = readJarMetadata(publicJarPath);
  const document = {
    fileSize: content.byteLength,
    md5: createHash("md5").update(content).digest("hex"),
    sha256: createHash("sha256").update(content).digest("hex"),
    version: metadata.version || "unknown",
    sourceCommit: metadata.sourceCommit || "unknown",
    sourceCommitShort: metadata.sourceCommitShort || "unknown",
    sourceCommitTime: metadata.sourceCommitTime || "unknown",
  };
  const serialized = `${JSON.stringify(document, null, 2)}\n`;
  if (existsSync(publicMetadataPath) && readFileSync(publicMetadataPath, "utf8") === serialized) {
    return;
  }

  writeFileSync(publicMetadataPath, serialized, "utf8");
  stdout.write(`Updated ${relative(repoRoot, publicMetadataPath)}\n`);
}

/** 读取 JAR manifest，不让文档构建依赖 JDK。 */
function readJarMetadata(jarPath) {
  const tempDirectory = mkdtempSync(join(buildRoot, "read-public-metadata-"));
  try {
    extractJar(jarPath, tempDirectory);
    return readBuildMetadata(tempDirectory);
  } finally {
    rmSync(tempDirectory, { force: true, recursive: true });
  }
}

/** Hashes executable contents and source provenance, but not build-machine metadata. */
function effectiveJarHash(jarPath) {
  const tempDirectory = mkdtempSync(join(buildRoot, "sync-public-jar-"));

  try {
    extractJar(jarPath, tempDirectory);

    const metadata = readBuildMetadata(tempDirectory);
    const hash = createHash("sha256");
    for (const file of collectFiles(tempDirectory).sort()) {
      const entryPath = relative(tempDirectory, file).split(sep).join("/");
      if (entryPath === buildInfoClassPath) {
        continue;
      }

      hash.update(entryPath);
      hash.update("\0");
      hash.update(normalizeJarEntry(entryPath, readFileSync(file), metadata));
      hash.update("\0");
    }

    // A pre-commit build names the previous source commit. Keep provenance in the
    // effective hash so CI refreshes the public jar after the source commit exists.
    hash.update("source-commit\0");
    hash.update(metadata.sourceCommit ?? "");
    hash.update("\0source-commit-time\0");
    hash.update(metadata.sourceCommitTime ?? "");
    return hash.digest("hex");
  } finally {
    rmSync(tempDirectory, { force: true, recursive: true });
  }
}

/** Extracts a jar into an isolated directory for normalized hashing. */
function extractJar(jarPath, outputDirectory) {
  const result = spawnSync("jar", ["xf", jarPath], {
    cwd: outputDirectory,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const output = `${result.stdout}\n${result.stderr}`.trim();
    throw new Error(`Failed to extract ${relative(repoRoot, jarPath)}${output ? `: ${output}` : ""}`);
  }
}

/** Reads source provenance from an extracted manifest when present. */
function readBuildMetadata(extractedJarRoot) {
  const manifestFile = join(extractedJarRoot, ...manifestPath.split("/"));
  if (!existsSync(manifestFile)) {
    return {};
  }

  const manifest = readFileSync(manifestFile, "utf8");
  const sourceCommit = readManifestHeader(manifest, "Graphwar-Agent-Source-Commit");
  return {
    version: readManifestHeader(manifest, "Implementation-Version"),
    sourceCommit,
    sourceCommitShort: sourceCommit && sourceCommit !== "unknown" ? sourceCommit.slice(0, 12) : sourceCommit,
    sourceCommitTime: readManifestHeader(manifest, "Graphwar-Agent-Source-Commit-Time"),
  };
}

/** Reads one unfolded manifest header written by this package's build script. */
function readManifestHeader(manifest, name) {
  const prefix = `${name}: `;
  for (const line of manifest.replace(/\r\n/g, "\n").split("\n")) {
    if (line.startsWith(prefix)) {
      return line.slice(prefix.length);
    }
  }
  return "";
}

/** Removes build-machine metadata that does not change executable behavior. */
function normalizeJarEntry(entryPath, content, metadata) {
  if (entryPath === manifestPath) {
    return normalizeManifest(content);
  }
  if (entryPath.endsWith(".class")) {
    return normalizeClassBuildMetadata(content, metadata);
  }
  return content;
}

/** Normalizes generated provenance and JDK-specific manifest headers. */
function normalizeManifest(content) {
  const lines = content.toString("utf8").replace(/\r\n/g, "\n").split("\n");
  const normalizedLines = [];

  for (const line of lines) {
    if (line.startsWith("Graphwar-Agent-Source-Commit:")) {
      normalizedLines.push("Graphwar-Agent-Source-Commit: <source-commit>");
    } else if (line.startsWith("Graphwar-Agent-Source-Commit-Time:")) {
      normalizedLines.push("Graphwar-Agent-Source-Commit-Time: <source-commit-time>");
    } else if (!line.startsWith("Created-By:")) {
      normalizedLines.push(line);
    }
  }

  return Buffer.from(normalizedLines.join("\n"), "utf8");
}

/** Normalizes provenance strings that javac may embed in executable class files. */
function normalizeClassBuildMetadata(content, metadata) {
  // javac inlines GraphwarAgentBuildInfo constants into GraphwarAgent.class, so
  // raw class bytes can differ even when only source commit metadata changed.
  let normalized = content
    .toString("latin1")
    .replace(
      /\[graphwar-agent\] source commit (?:unknown|[0-9a-f]{12}) \((?:unknown|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\)/g,
      "[graphwar-agent] source commit <source-commit> (<source-commit-time>)",
    );

  normalized = replaceAscii(normalized, metadata.sourceCommit, "<source-commit>");
  normalized = replaceAscii(normalized, metadata.sourceCommitShort, "<source-commit-short>");
  normalized = replaceAscii(normalized, metadata.sourceCommitTime, "<source-commit-time>");

  return Buffer.from(normalized, "latin1");
}

/** Replaces one optional ASCII metadata value without touching unknown sentinels. */
function replaceAscii(value, search, replacement) {
  if (!search || search === "unknown") {
    return value;
  }
  return value.split(search).join(replacement);
}
