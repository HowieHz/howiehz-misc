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

const compareSemVer = (left, right) => left.major - right.major || left.minor - right.minor || left.patch - right.patch;
const nodeReleasePublishedAtCache = new Map();
let nodeReleaseIndexPromise;
let activeNodeLtsMajorsPromise;
const latestNodeLtsMajorCache = new Map();
const latestNodeEngineRangeCache = new Map();

const parseNodeEngineMajor = (value) => {
  const match = /^>=(\d+)$/u.exec(typeof value === "string" ? value.trim() : "");

  if (!match) {
    return null;
  }

  return Number(match[1]);
};

const parseNodeEngineSingleFloor = (value) => {
  const nodeMajor = parseNodeEngineMajor(value);

  if (nodeMajor === null) {
    return null;
  }

  return {
    major: nodeMajor,
    mode: "single-floor",
  };
};

const parseNodeEngineLtsTracks = (value) => {
  return typeof value === "string" && value.includes("||") ? { mode: "lts-tracks" } : null;
};

const parseNodeEngineSpec = (value) => parseNodeEngineSingleFloor(value) ?? parseNodeEngineLtsTracks(value);

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
  const nodeEngine = typeof packageJson.engines?.node === "string" ? packageJson.engines.node.trim() : "";
  const parsedNodeEngine = parseNodeEngineSpec(nodeEngine);
  const pnpmVersion = parsePackageManagerPnpmVersion(packageJson.packageManager);

  if (!parsedNodeEngine) {
    throw new Error(`Invalid current Node.js engine range in ${rootPackageJsonPath}`);
  }

  if (!pnpmVersion) {
    throw new Error(`Invalid current pnpm packageManager value in ${rootPackageJsonPath}`);
  }

  return {
    nodeEngine,
    parsedNodeEngine,
    pnpmVersion,
  };
};

const fetchNodeReleasePublishedAt = async (versionTag) => {
  if (nodeReleasePublishedAtCache.has(versionTag)) {
    return nodeReleasePublishedAtCache.get(versionTag);
  }

  const response = await fetch(
    `https://api.github.com/repos/nodejs/node/releases/tags/${encodeURIComponent(versionTag)}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "howiehz-misc-toolchain-updater",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch Node.js release ${versionTag}: ${response.status} ${response.statusText}`);
  }

  const release = await response.json();
  const publishedAt = typeof release.published_at === "string" ? release.published_at.trim() : "";

  if (!publishedAt) {
    throw new Error(`Missing published date for Node.js release ${versionTag}`);
  }

  nodeReleasePublishedAtCache.set(versionTag, publishedAt);
  return publishedAt;
};

const fetchLatestNodeLtsMajor = async (currentNodeMajor) => {
  if (latestNodeLtsMajorCache.has(currentNodeMajor)) {
    return latestNodeLtsMajorCache.get(currentNodeMajor);
  }

  // The official Node.js release index identifies the currently active LTS line.
  // GitHub releases expose an exact published timestamp so the 24-hour holdback remains strict.
  const releases = await fetchNodeReleaseIndex();

  const latestLtsRelease = releases
    .sort((left, right) => compareSemVer(right.parsedVersion, left.parsedVersion))[0];

  if (!latestLtsRelease) {
    throw new Error("Unable to determine the latest Node.js LTS release");
  }

  const publishedAt = await fetchNodeReleasePublishedAt(latestLtsRelease.version);

  if (!hasReachedLatestReleaseMinAge(publishedAt)) {
    console.log(
      `Skipping Node.js update because latest LTS ${latestLtsRelease.version} was published at ${publishedAt} and is still within the 24-hour holdback`,
    );
    latestNodeLtsMajorCache.set(currentNodeMajor, currentNodeMajor);
    return currentNodeMajor;
  }

  latestNodeLtsMajorCache.set(currentNodeMajor, latestLtsRelease.parsedVersion.major);
  return latestLtsRelease.parsedVersion.major;
};

const fetchNodeReleaseIndex = async () => {
  nodeReleaseIndexPromise ??= (async () => {
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

    return releases
      .map((release) => {
        const version = typeof release.version === "string" ? release.version.trim() : "";
        const parsedVersion = parseSemVer(version);

        if (!release.lts || !parsedVersion) {
          return null;
        }

        return {
          parsedVersion,
          version,
        };
      })
      .filter((release) => release !== null);
  })();

  return nodeReleaseIndexPromise;
};

const fetchActiveNodeLtsMajors = async (now = Date.now()) => {
  activeNodeLtsMajorsPromise ??= (async () => {
    const response = await fetch("https://raw.githubusercontent.com/nodejs/Release/main/schedule.json", {
      headers: {
        Accept: "application/json",
        "User-Agent": "howiehz-misc-toolchain-updater",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Node.js release schedule: ${response.status} ${response.statusText}`);
    }

    const schedule = await response.json();

    if (!schedule || typeof schedule !== "object") {
      throw new Error("Invalid Node.js release schedule response");
    }

    return Object.entries(schedule)
      .map(([key, line]) => {
        const majorMatch = /^v(\d+)$/u.exec(key);

        if (!majorMatch || !line || typeof line !== "object") {
          return null;
        }

        const ltsTimestamp = parseTimestamp(line.lts);
        const endTimestamp = parseTimestamp(line.end);

        if (ltsTimestamp === null || endTimestamp === null) {
          return null;
        }

        if (now < ltsTimestamp || now >= endTimestamp) {
          return null;
        }

        return Number(majorMatch[1]);
      })
      .filter((major) => major !== null)
      .sort((left, right) => left - right);
  })();

  return activeNodeLtsMajorsPromise;
};

const formatNodeEngineTrackRange = (releases) =>
  releases
    .map((release, index) => `${index === releases.length - 1 ? ">=" : "^"}${release.version.replace(/^v/u, "")}`)
    .join(" || ");

const resolveLatestLtsReleaseForMajor = (releases, major) => {
  const release = releases
    .filter((candidate) => candidate.parsedVersion.major === major)
    .sort((left, right) => compareSemVer(right.parsedVersion, left.parsedVersion))[0];

  if (!release) {
    throw new Error(`Unable to determine the latest Node.js LTS release for major ${major}`);
  }

  return release;
};

const fetchLatestNodeEngineRange = async (currentNodeEngine, parsedNodeEngine) => {
  if (latestNodeEngineRangeCache.has(currentNodeEngine)) {
    return latestNodeEngineRangeCache.get(currentNodeEngine);
  }

  if (parsedNodeEngine.mode === "single-floor") {
    const nodeMajor = await fetchLatestNodeLtsMajor(parsedNodeEngine.major);

    const result = {
      nodeEngineRange: `>=${nodeMajor}`,
      nodeMajor,
    };

    latestNodeEngineRangeCache.set(currentNodeEngine, result);
    return result;
  }

  const activeLtsMajors = await fetchActiveNodeLtsMajors();

  if (activeLtsMajors.length < 2) {
    throw new Error("Unable to determine enough active Node.js LTS lines for track-based engine updates");
  }

  const releases = await fetchNodeReleaseIndex();
  const selectedReleases = activeLtsMajors.map((major) => resolveLatestLtsReleaseForMajor(releases, major));

  for (const release of selectedReleases) {
    const publishedAt = await fetchNodeReleasePublishedAt(release.version);

    if (!hasReachedLatestReleaseMinAge(publishedAt)) {
      console.log(
        `Skipping Node.js update because latest LTS ${release.version} was published at ${publishedAt} and is still within the 24-hour holdback`,
      );

      const result = {
        nodeEngineRange: currentNodeEngine,
        nodeMajor: selectedReleases.at(-1).parsedVersion.major,
      };

      latestNodeEngineRangeCache.set(currentNodeEngine, result);
      return result;
    }
  }

  const result = {
    nodeEngineRange: formatNodeEngineTrackRange(selectedReleases),
    nodeMajor: selectedReleases.at(-1).parsedVersion.major,
  };

  latestNodeEngineRangeCache.set(currentNodeEngine, result);
  return result;
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

const resolvePackageNodeEngineRange = async (filePath, packageJson, fallbackNodeEngineRange, fallbackParsedNodeEngine) => {
  const currentNodeEngine = typeof packageJson.engines?.node === "string" ? packageJson.engines.node.trim() : "";

  if (currentNodeEngine === "") {
    return {
      nodeEngineRange: fallbackNodeEngineRange,
      nodeMajor: fallbackParsedNodeEngine.major ?? null,
    };
  }

  const parsedNodeEngine = parseNodeEngineSpec(currentNodeEngine);

  if (!parsedNodeEngine) {
    throw new Error(`Invalid current Node.js engine range in ${filePath}`);
  }

  return fetchLatestNodeEngineRange(currentNodeEngine, parsedNodeEngine);
};

const updatePackageJson = async (filePath, fallbackNodeEngineRange, fallbackParsedNodeEngine, pnpmVersion) => {
  const { content, lineEnding } = await readUtf8FileWithLineEnding(filePath);
  const packageJson = JSON.parse(content);
  const updatedFields = [];

  packageJson.engines ??= {};
  const { nodeEngineRange } = await resolvePackageNodeEngineRange(
    filePath,
    packageJson,
    fallbackNodeEngineRange,
    fallbackParsedNodeEngine,
  );

  if (packageJson.engines.node !== nodeEngineRange) {
    packageJson.engines.node = nodeEngineRange;
    updatedFields.push(`engines.node -> ${nodeEngineRange}`);
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

const updatePackageJsonFiles = async (fallbackNodeEngineRange, fallbackParsedNodeEngine, pnpmVersion) => {
  const packageJsonFiles = await collectPackageJsonFiles();
  const updateGroups = [];

  for (const filePath of packageJsonFiles) {
    const updates = await updatePackageJson(filePath, fallbackNodeEngineRange, fallbackParsedNodeEngine, pnpmVersion);

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
const { nodeEngineRange, nodeMajor } = await fetchLatestNodeEngineRange(
  currentToolchainVersions.nodeEngine,
  currentToolchainVersions.parsedNodeEngine,
);
const pnpmVersion = await fetchLatestPnpmVersion(currentToolchainVersions.pnpmVersion);

console.log(`Resolved workflow Node.js LTS major: ${nodeMajor}`);
console.log(`Resolved target pnpm version: ${pnpmVersion}`);

const nodeVersionUpdateGroups = await updateNodeVersionFiles(nodeMajor);
const packageJsonUpdateGroups = await updatePackageJsonFiles(
  nodeEngineRange,
  currentToolchainVersions.parsedNodeEngine,
  pnpmVersion,
);

const updateGroups = [...packageJsonUpdateGroups, ...nodeVersionUpdateGroups].filter(
  ({ updates }) => updates.length > 0,
);

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
