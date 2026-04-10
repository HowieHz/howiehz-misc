import fs from "node:fs/promises";
import path from "node:path";

const rootPackageJsonPath = "package.json";
const githubDirPath = ".github";
const workflowsDirPath = path.join(githubDirPath, "workflows");
const actionsDirPath = path.join(githubDirPath, "actions");
const dryRun = process.argv.includes("--dry-run");
// Only promote a toolchain release after the current latest itself has aged for at least 24 hours.
// We intentionally do not fall back to an older version when a newer latest is still within this holdback window.
const latestReleaseMinAgeMs = 24 * 60 * 60 * 1000;
const resolveRelativePath = (directoryPath, entryName) =>
  directoryPath === "." ? entryName : path.join(directoryPath, entryName);

const appendGitHubOutput = async (name, value) => {
  const outputPath = process.env.GITHUB_OUTPUT;

  if (!outputPath) {
    return;
  }

  await fs.appendFile(outputPath, `${name}=${value}\n`, "utf8");
};

const parseSemVer = (version) => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/u.exec(version);

  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
};

const compareSemVer = (left, right) =>
  left.major - right.major || left.minor - right.minor || left.patch - right.patch;

const parseNodeEngineMajor = (value) => {
  const match = /^>=(\d+)$/u.exec(typeof value === "string" ? value.trim() : "");

  if (!match) {
    return null;
  }

  return Number(match[1]);
};

const parsePackageManagerPnpmVersion = (value) => {
  const match = /^pnpm@(.+)$/u.exec(typeof value === "string" ? value.trim() : "");

  if (!match) {
    return null;
  }

  const version = match[1].trim();

  return parseSemVer(version) ? version : null;
};

const parseTimestamp = (value) => {
  const timestamp = Date.parse(typeof value === "string" ? value.trim() : "");

  if (Number.isNaN(timestamp)) {
    return null;
  }

  return timestamp;
};

const hasReachedLatestReleaseMinAge = (publishedAt, now = Date.now()) => {
  const publishedTimestamp = parseTimestamp(publishedAt);

  if (publishedTimestamp === null) {
    throw new Error(`Invalid published date: ${publishedAt || "<empty>"}`);
  }

  return now - publishedTimestamp >= latestReleaseMinAgeMs;
};

const stripUtf8Bom = (content) => content.replace(/^\uFEFF/u, "");

const readUtf8FileWithLineEnding = async (filePath) => {
  const absolutePath = path.resolve(process.cwd(), filePath);
  const content = stripUtf8Bom(await fs.readFile(absolutePath, "utf8"));

  return {
    content,
    lineEnding: content.includes("\r\n") ? "\r\n" : "\n",
  };
};

const maybeWriteFile = async (filePath, nextContent) => {
  if (dryRun) {
    return;
  }

  await fs.writeFile(path.resolve(process.cwd(), filePath), nextContent, "utf8");
};

const readCurrentToolchainVersions = async () => {
  const { content } = await readUtf8FileWithLineEnding(rootPackageJsonPath);
  const packageJson = JSON.parse(content);
  const nodeMajor = parseNodeEngineMajor(packageJson.engines?.node);
  const pnpmVersion = parsePackageManagerPnpmVersion(packageJson.packageManager);

  if (nodeMajor === null) {
    throw new Error(`Invalid current Node.js engine range in ${rootPackageJsonPath}`);
  }

  if (!pnpmVersion) {
    throw new Error(`Invalid current pnpm packageManager value in ${rootPackageJsonPath}`);
  }

  return {
    nodeMajor,
    pnpmVersion,
  };
};

const fetchNodeReleasePublishedAt = async (versionTag) => {
  const response = await fetch(`https://api.github.com/repos/nodejs/node/releases/tags/${encodeURIComponent(versionTag)}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "howiehz-misc-toolchain-updater",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Node.js release ${versionTag}: ${response.status} ${response.statusText}`);
  }

  const release = await response.json();
  const publishedAt = typeof release.published_at === "string" ? release.published_at.trim() : "";

  if (!publishedAt) {
    throw new Error(`Missing published date for Node.js release ${versionTag}`);
  }

  return publishedAt;
};

const fetchLatestNodeLtsMajor = async (currentNodeMajor) => {
  // The official Node.js release index identifies the currently active LTS line.
  // GitHub releases expose an exact published timestamp so the 24-hour holdback remains strict.
  const response = await fetch("https://nodejs.org/download/release/index.json", {
    headers: {
      Accept: "application/json",
      "User-Agent": "howiehz-misc-toolchain-updater",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Node.js release index: ${response.status} ${response.statusText}`);
  }

  const releases = await response.json();

  if (!Array.isArray(releases)) {
    throw new Error("Invalid Node.js release index response");
  }

  const latestLtsRelease = releases
    .map((release) => {
      const version = typeof release.version === "string" ? release.version.trim() : "";
      const parsedVersion = parseSemVer(version);

      if (!release.lts || !parsedVersion) {
        return null;
      }

      return {
        version,
        parsedVersion,
      };
    })
    .filter((release) => release !== null)
    .sort((left, right) => compareSemVer(right.parsedVersion, left.parsedVersion))[0];

  if (!latestLtsRelease) {
    throw new Error("Unable to determine the latest Node.js LTS release");
  }

  const publishedAt = await fetchNodeReleasePublishedAt(latestLtsRelease.version);

  if (!hasReachedLatestReleaseMinAge(publishedAt)) {
    console.log(
      `Skipping Node.js update because latest LTS ${latestLtsRelease.version} was published at ${publishedAt} and is still within the 24-hour holdback`,
    );
    return currentNodeMajor;
  }

  return latestLtsRelease.parsedVersion.major;
};

const fetchLatestPnpmVersion = async (currentPnpmVersion) => {
  const response = await fetch("https://registry.npmjs.org/pnpm", {
    headers: {
      Accept: "application/json",
      "User-Agent": "howiehz-misc-toolchain-updater",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch pnpm package metadata: ${response.status} ${response.statusText}`);
  }

  const metadata = await response.json();
  const latestVersion = typeof metadata["dist-tags"]?.latest === "string" ? metadata["dist-tags"].latest.trim() : "";

  if (!parseSemVer(latestVersion)) {
    throw new Error(`Invalid pnpm latest version: ${latestVersion || "<empty>"}`);
  }

  const publishedAt = metadata.time?.[latestVersion];

  if (typeof publishedAt !== "string") {
    throw new Error(`Missing published time for pnpm latest version: ${latestVersion}`);
  }

  if (!hasReachedLatestReleaseMinAge(publishedAt)) {
    console.log(
      `Skipping pnpm update because latest ${latestVersion} was published at ${publishedAt} and is still within the 24-hour holdback`,
    );
    return currentPnpmVersion;
  }

  return latestVersion;
};

const collectFilesByName = async (directoryPath, fileName) => {
  const absoluteDirectoryPath = path.resolve(process.cwd(), directoryPath);
  const entries = await fs.readdir(absoluteDirectoryPath, { withFileTypes: true });
  const filePaths = [];

  for (const entry of entries) {
    const relativePath = resolveRelativePath(directoryPath, entry.name);

    if (entry.isDirectory()) {
      filePaths.push(...(await collectFilesByName(relativePath, fileName)));
      continue;
    }

    if (entry.isFile() && entry.name === fileName) {
      filePaths.push(relativePath);
    }
  }

  return filePaths.sort((left, right) => left.localeCompare(right));
};

const collectPackageJsonFiles = async (directoryPath = ".") => {
  const absoluteDirectoryPath = path.resolve(process.cwd(), directoryPath);
  const entries = await fs.readdir(absoluteDirectoryPath, { withFileTypes: true });
  const filePaths = [];

  for (const entry of entries) {
    const relativePath = resolveRelativePath(directoryPath, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) {
        continue;
      }

      filePaths.push(...(await collectPackageJsonFiles(relativePath)));
      continue;
    }

    if (entry.isFile() && entry.name === "package.json") {
      filePaths.push(relativePath);
    }
  }

  return filePaths.sort((left, right) => left.localeCompare(right));
};

const updatePackageJson = async (filePath, nodeMajor, pnpmVersion) => {
  const { content, lineEnding } = await readUtf8FileWithLineEnding(filePath);
  const packageJson = JSON.parse(content);
  const updatedFields = [];

  packageJson.engines ??= {};

  const nextNodeRange = `>=${nodeMajor}`;

  if (packageJson.engines.node !== nextNodeRange) {
    packageJson.engines.node = nextNodeRange;
    updatedFields.push(`engines.node -> ${nextNodeRange}`);
  }

  if (filePath === rootPackageJsonPath) {
    const nextPnpmRange = `^${pnpmVersion}`;
    const nextPackageManager = `pnpm@${pnpmVersion}`;

    if (packageJson.engines.pnpm !== nextPnpmRange) {
      packageJson.engines.pnpm = nextPnpmRange;
      updatedFields.push(`engines.pnpm -> ${nextPnpmRange}`);
    }

    if (packageJson.packageManager !== nextPackageManager) {
      packageJson.packageManager = nextPackageManager;
      updatedFields.push(`packageManager -> ${nextPackageManager}`);
    }
  }

  if (updatedFields.length === 0) {
    return [];
  }

  const nextContent = `${JSON.stringify(packageJson, null, 2)}${lineEnding}`.replace(/\n/gu, lineEnding);
  await maybeWriteFile(filePath, nextContent);
  return updatedFields;
};

const updatePackageJsonFiles = async (nodeMajor, pnpmVersion) => {
  const packageJsonFiles = await collectPackageJsonFiles();
  const updateGroups = [];

  for (const filePath of packageJsonFiles) {
    const updates = await updatePackageJson(filePath, nodeMajor, pnpmVersion);

    if (updates.length > 0) {
      updateGroups.push({ filePath, updates });
    }
  }

  return updateGroups;
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const replaceWorkflowStepInputValue = (content, actionPattern, inputName, nextValue) => {
  const lines = content.split(/\r?\n/u);
  const inputPattern = new RegExp(`^(\\s*${escapeRegExp(inputName)}:\\s*)(["']?)([^"'#\\s]+)\\2(\\s*(?:#.*)?)$`, "u");
  let changed = false;
  let stepUsesTargetAction = false;
  let withinWithBlock = false;
  let withIndent = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const normalizedLine = line.replace(/^(\s*)-\s+/u, "$1");
    const trimmed = line.trim();
    const indent = line.match(/^\s*/u)?.[0].length ?? 0;

    if (/^\s*-\s+/u.test(line)) {
      stepUsesTargetAction = false;
      withinWithBlock = false;
      withIndent = -1;
    }

    if (withinWithBlock && trimmed && indent <= withIndent) {
      withinWithBlock = false;
      withIndent = -1;
    }

    if (/^\s*uses:\s*/u.test(normalizedLine)) {
      stepUsesTargetAction = actionPattern.test(normalizedLine);
    }

    if (stepUsesTargetAction && /^\s*with:\s*$/u.test(normalizedLine)) {
      withinWithBlock = true;
      withIndent = indent;
      continue;
    }

    if (!stepUsesTargetAction || !withinWithBlock) {
      continue;
    }

    const match = line.match(inputPattern);

    if (!match || match[3] === nextValue) {
      continue;
    }

    lines[index] = `${match[1]}${match[2]}${nextValue}${match[2]}${match[4]}`;
    changed = true;
  }

  return {
    changed,
    nextContent: lines.join("\n"),
  };
};

const updateNodeVersionFile = async (filePath, nodeMajor) => {
  const { content, lineEnding } = await readUtf8FileWithLineEnding(filePath);

  if (!content.includes("actions/setup-node@")) {
    return [];
  }

  const nextNodeVersion = String(nodeMajor);

  const { changed, nextContent } = replaceWorkflowStepInputValue(
    content,
    /uses:\s*actions\/setup-node@/u,
    "node-version",
    nextNodeVersion,
  );

  if (!changed || nextContent === content) {
    return [];
  }

  await maybeWriteFile(filePath, nextContent.replace(/\n/gu, lineEnding));
  return [`node-version -> ${nextNodeVersion}`];
};

const updateNodeVersionFiles = async (nodeMajor) => {
  const workflowEntries = await fs.readdir(path.resolve(process.cwd(), workflowsDirPath), { withFileTypes: true });
  const workflowFiles = workflowEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".yml"))
    .map((entry) => path.join(workflowsDirPath, entry.name))
    .sort((left, right) => left.localeCompare(right));
  const actionFiles = await collectFilesByName(actionsDirPath, "action.yml");
  const targetFiles = [...actionFiles, ...workflowFiles];
  const updateGroups = [];

  for (const filePath of targetFiles) {
    const updates = await updateNodeVersionFile(filePath, nodeMajor);

    if (updates.length > 0) {
      updateGroups.push({ filePath, updates });
    }
  }

  return updateGroups;
};

const currentToolchainVersions = await readCurrentToolchainVersions();
const nodeMajor = await fetchLatestNodeLtsMajor(currentToolchainVersions.nodeMajor);
const pnpmVersion = await fetchLatestPnpmVersion(currentToolchainVersions.pnpmVersion);

console.log(`Resolved target Node.js LTS major: ${nodeMajor}`);
console.log(`Resolved target pnpm version: ${pnpmVersion}`);

const nodeVersionUpdateGroups = await updateNodeVersionFiles(nodeMajor);
const packageJsonUpdateGroups = await updatePackageJsonFiles(nodeMajor, pnpmVersion);

const updateGroups = [
  ...packageJsonUpdateGroups,
  ...nodeVersionUpdateGroups,
].filter(({ updates }) => updates.length > 0);

if (updateGroups.length === 0) {
  console.log("No toolchain version updates were required");
} else {
  for (const { filePath, updates } of updateGroups) {
    console.log(`Updated ${filePath}`);

    for (const update of updates) {
      console.log(`- ${update}`);
    }
  }
}

await appendGitHubOutput("changed", updateGroups.length > 0 ? "true" : "false");
await appendGitHubOutput("node_major", String(nodeMajor));
await appendGitHubOutput("pnpm_version", pnpmVersion);
await appendGitHubOutput("updated_files", updateGroups.map(({ filePath }) => filePath).join(","));
await appendGitHubOutput(
  "update_count",
  String(updateGroups.reduce((count, group) => count + group.updates.length, 0)),
);

if (dryRun && updateGroups.length > 0) {
  process.exitCode = 10;
}
