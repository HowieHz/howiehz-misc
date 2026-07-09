import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { get } from "node:https";
import { dirname, join, relative } from "node:path";
import { exit, stderr, stdout } from "node:process";
import { fileURLToPath, URL } from "node:url";

const GOOGLE_JAVA_FORMAT_VERSION = "1.35.0";
const GOOGLE_JAVA_FORMAT_SHA256 = "bfb7f9ead6cd328389bc2da53860443bc0e805dfd08cc889bfdf43b26cb2a6e8";
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cacheRoot = join(repoRoot, ".cache", "google-java-format");
const jarName = `google-java-format-${GOOGLE_JAVA_FORMAT_VERSION}-all-deps.jar`;
const jarPath = join(cacheRoot, jarName);
const jarUrl = `https://repo1.maven.org/maven2/com/google/googlejavaformat/google-java-format/${GOOGLE_JAVA_FORMAT_VERSION}/${jarName}`;

async function main() {
  const javaFiles = collectJavaFiles();
  if (javaFiles.length === 0) {
    stdout.write("No Java files to format\n");
    return;
  }

  await ensureFormatterJar();
  run("java", ["-jar", jarPath, "--aosp", "--replace", ...javaFiles]);
  stdout.write(`Formatted ${javaFiles.length} Java files with google-java-format ${GOOGLE_JAVA_FORMAT_VERSION}\n`);
}

function collectJavaFiles() {
  // Use git so ignored upstream source snapshots, build output, and caches stay untouched.
  const files = new Set([...gitFiles(["ls-files"]), ...gitFiles(["ls-files", "--others", "--exclude-standard"])]);
  return [...files].filter((file) => file.endsWith(".java")).sort();
}

function gitFiles(args) {
  const result = spawnSync("git", [...args, "--", "*.java"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    return [];
  }
  return result.stdout.split(/\r?\n/u).filter(Boolean);
}

async function ensureFormatterJar() {
  if (hasExpectedSha256(jarPath)) {
    return;
  }

  mkdirSync(cacheRoot, { recursive: true });
  const bytes = await download(jarUrl);
  const temporaryPath = `${jarPath}.tmp`;
  writeFileSync(temporaryPath, bytes);

  if (!hasExpectedSha256(temporaryPath)) {
    rmSync(temporaryPath, { force: true });
    throw new Error(`Downloaded ${jarName} failed sha256 verification`);
  }

  renameSync(temporaryPath, jarPath);
}

function download(url, redirectCount = 0) {
  const curlBytes = downloadWithCurl(url);
  if (curlBytes) {
    return curlBytes;
  }
  return downloadWithHttps(url, redirectCount);
}

function downloadWithCurl(url) {
  const result = spawnSync("curl", ["--fail", "--location", "--silent", "--show-error", url], {
    cwd: repoRoot,
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    return null;
  }
  return result.stdout;
}

function downloadWithHttps(url, redirectCount = 0) {
  if (redirectCount > 3) {
    throw new Error(`Too many redirects while downloading ${url}`);
  }

  return new Promise((resolve, reject) => {
    get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        resolve(downloadWithHttps(new URL(response.headers.location, url).href, redirectCount + 1));
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Failed to download ${url}: HTTP ${response.statusCode}`));
        return;
      }

      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve(Buffer.concat(chunks)));
    }).on("error", reject);
  });
}

function hasExpectedSha256(path) {
  if (!existsSync(path)) {
    return false;
  }
  return createHash("sha256").update(readFileSync(path)).digest("hex") === GOOGLE_JAVA_FORMAT_SHA256;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.map(formatArg).join(" ")} failed`);
  }
}

function formatArg(arg) {
  return arg.startsWith(repoRoot) ? relative(repoRoot, arg) : arg;
}

main().catch((error) => {
  stderr.write(`${error.message}\n`);
  exit(1);
});
