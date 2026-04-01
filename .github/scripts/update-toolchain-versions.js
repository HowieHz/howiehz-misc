import fs from "node:fs/promises";
import path from "node:path";

const packageJsonPath = "package.json";
const githubDirPath = ".github";
const workflowsDirPath = path.join(githubDirPath, "workflows");
const actionsDirPath = path.join(githubDirPath, "actions");
const dryRun = process.argv.includes("--dry-run");
const releaseCooldownDays = 1;
const millisecondsPerDay = 24 * 60 * 60 * 1000;

const appendGitHubOutput = async (name, value) => {
  const outputPath = process.env.GITHUB_OUTPUT;

  if (!outputPath) {
    return;
  }

  await fs.appendFile(outputPath, `${name}=${value}\n`, "utf8");
};

const compareNumbers = (left, right) => left - right;

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
  compareNumbers(left.major, right.major) ||
  compareNumbers(left.minor, right.minor) ||
  compareNumbers(left.patch, right.patch);

const parseIsoDateTime = (value) => {
  const normalizedValue = /^\d{4}-\d{2}-\d{2}$/u.test(value) ? `${value}T00:00:00.000Z` : value;
  const timestamp = Date.parse(normalizedValue);

  if (Number.isNaN(timestamp)) {
    return null;
  }

  return timestamp;
};

const getReleaseCooldownThreshold = () => Date.now() - releaseCooldownDays * millisecondsPerDay;

const isOutsideReleaseCooldown = (publishedAt, cooldownThreshold = getReleaseCooldownThreshold()) => {
  const publishedTimestamp = parseIsoDateTime(publishedAt);

  if (publishedTimestamp === null) {
    throw new Error(`Invalid published date: ${publishedAt || "<empty>"}`);
  }

  return publishedTimestamp <= cooldownThreshold;
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

const fetchLatestNodeMajor = async () => {
  const response = await fetch("https://nodejs.org/dist/index.json", {
    headers: {
      Accept: "application/json",
      "User-Agent": "howiehz-misc-toolchain-updater",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Node.js releases: ${response.status} ${response.statusText}`);
  }

  const releases = await response.json();
  const cooldownThreshold = getReleaseCooldownThreshold();
  const stableVersions = releases
    .filter((release) => isOutsideReleaseCooldown(release.date, cooldownThreshold))
    .map((release) => parseSemVer(release.version))
    .filter(Boolean)
    .sort((left, right) => compareSemVer(right, left));

  if (stableVersions.length === 0) {
    throw new Error(`No stable Node.js versions found outside the ${releaseCooldownDays}-day cooldown window`);
  }

  return stableVersions[0].major;
};

const fetchLatestPnpmVersion = async () => {
  const latestResponse = await fetch("https://registry.npmjs.org/pnpm/latest", {
    headers: {
      Accept: "application/json",
      "User-Agent": "howiehz-misc-toolchain-updater",
    },
  });

  if (!latestResponse.ok) {
    throw new Error(`Failed to fetch pnpm latest metadata: ${latestResponse.status} ${latestResponse.statusText}`);
  }

  const latestMetadata = await latestResponse.json();
  const latestVersion = typeof latestMetadata.version === "string" ? latestMetadata.version.trim() : "";

  if (!parseSemVer(latestVersion)) {
    throw new Error(`Invalid pnpm latest version: ${latestVersion || "<empty>"}`);
  }

  const metadataResponse = await fetch("https://registry.npmjs.org/pnpm", {
    headers: {
      Accept: "application/json",
      "User-Agent": "howiehz-misc-toolchain-updater",
    },
  });

  if (!metadataResponse.ok) {
    throw new Error(`Failed to fetch pnpm package metadata: ${metadataResponse.status} ${metadataResponse.statusText}`);
  }

  const metadata = await metadataResponse.json();
  const cooldownThreshold = getReleaseCooldownThreshold();
  const eligibleVersions = Object.entries(metadata.time ?? {})
    .filter(([version]) => parseSemVer(version))
    .filter(
      ([, publishedAt]) => typeof publishedAt === "string" && isOutsideReleaseCooldown(publishedAt, cooldownThreshold),
    )
    .map(([version]) => version)
    .sort((left, right) => compareSemVer(parseSemVer(right), parseSemVer(left)));

  if (eligibleVersions.length === 0) {
    throw new Error(`No pnpm versions found outside the ${releaseCooldownDays}-day cooldown window`);
  }

  return eligibleVersions[0];
};

const collectFilesByName = async (directoryPath, fileName) => {
  const absoluteDirectoryPath = path.resolve(process.cwd(), directoryPath);
  const entries = await fs.readdir(absoluteDirectoryPath, { withFileTypes: true });
  const filePaths = [];

  for (const entry of entries) {
    const relativePath = path.join(directoryPath, entry.name);

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

const updatePackageJson = async (nodeMajor, pnpmVersion) => {
  const { content, lineEnding } = await readUtf8FileWithLineEnding(packageJsonPath);
  const packageJson = JSON.parse(content);
  const updatedFields = [];

  packageJson.engines ??= {};

  const nextNodeRange = `>=${nodeMajor}`;
  const nextPnpmRange = `^${pnpmVersion}`;
  const nextPackageManager = `pnpm@${pnpmVersion}`;

  if (packageJson.engines.node !== nextNodeRange) {
    packageJson.engines.node = nextNodeRange;
    updatedFields.push(`engines.node -> ${nextNodeRange}`);
  }

  if (packageJson.engines.pnpm !== nextPnpmRange) {
    packageJson.engines.pnpm = nextPnpmRange;
    updatedFields.push(`engines.pnpm -> ${nextPnpmRange}`);
  }

  if (packageJson.packageManager !== nextPackageManager) {
    packageJson.packageManager = nextPackageManager;
    updatedFields.push(`packageManager -> ${nextPackageManager}`);
  }

  if (updatedFields.length === 0) {
    return [];
  }

  const nextContent = `${JSON.stringify(packageJson, null, 2)}${lineEnding}`.replace(/\n/gu, lineEnding);
  await maybeWriteFile(packageJsonPath, nextContent);
  return updatedFields;
};

const replaceNodeVersionValue = (content, nodeMajor) => {
  const nodeVersionPattern = /^(\s*node-version:\s*)(["']?)(?:lts\/\*|\d+)\2(\s*(?:#.*)?)$/gmu;
  let changed = false;

  const nextContent = content.replace(nodeVersionPattern, (_, prefix, quote, suffix) => {
    changed = true;
    const wrappedValue = `${quote}${nodeMajor}${quote}`;
    return `${prefix}${wrappedValue}${suffix}`;
  });

  return {
    changed,
    nextContent,
  };
};

const updateNodeVersionFile = async (filePath, nodeMajor) => {
  const { content, lineEnding } = await readUtf8FileWithLineEnding(filePath);

  if (!content.includes("actions/setup-node@")) {
    return [];
  }

  const { changed, nextContent } = replaceNodeVersionValue(content, nodeMajor);

  if (!changed || nextContent === content) {
    return [];
  }

  await maybeWriteFile(filePath, nextContent.replace(/\n/gu, lineEnding));
  return [`node-version -> ${nodeMajor}`];
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

const nodeMajor = await fetchLatestNodeMajor();
const pnpmVersion = await fetchLatestPnpmVersion();

console.log(`Resolved latest Node.js major: ${nodeMajor}`);
console.log(`Resolved latest pnpm version: ${pnpmVersion}`);

const nodeVersionUpdateGroups = await updateNodeVersionFiles(nodeMajor);

const updateGroups = [
  {
    filePath: packageJsonPath,
    updates: await updatePackageJson(nodeMajor, pnpmVersion),
  },
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
