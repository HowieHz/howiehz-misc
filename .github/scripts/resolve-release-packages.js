import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const workspacePackagesDirectory = path.resolve("packages");
const npmRegistryBaseUrl = "https://registry.npmjs.org";
const githubRepository = process.env.GITHUB_REPOSITORY;
const githubToken = process.env.GITHUB_TOKEN;

const appendGitHubOutput = async (name, value) => {
  const outputPath = process.env.GITHUB_OUTPUT;

  if (!outputPath) {
    return;
  }

  await fs.appendFile(outputPath, `${name}=${value}\n`, "utf8");
};

const readJsonFile = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

const fetchGitHubRelease = async (tagName) => {
  if (!githubRepository || !githubToken) return undefined;

  const response = await fetch(
    `https://api.github.com/repos/${githubRepository}/releases/tags/${encodeURIComponent(tagName)}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${githubToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Failed to fetch GitHub Release ${tagName}: ${response.status} ${response.statusText}`);
  }

  return response.json();
};

const readPreviousPackageJson = (packageJsonPath) => {
  const relativePath = path.relative(process.cwd(), packageJsonPath).split(path.sep).join("/");
  const result = spawnSync("git", ["show", `HEAD^:${relativePath}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

  if (result.status !== 0) return null;

  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
};

const fetchPublishedVersions = async (packageName) => {
  const response = await fetch(`${npmRegistryBaseUrl}/${encodeURIComponent(packageName)}`, {
    headers: {
      Accept: "application/json",
    },
  });

  if (response.status === 404) {
    return new Set();
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch npm metadata for ${packageName}: ${response.status} ${response.statusText}`);
  }

  const metadata = await response.json();
  const versions = metadata && typeof metadata === "object" ? metadata.versions : null;
  return new Set(Object.keys(versions && typeof versions === "object" ? versions : {}));
};

const resolveReleasePackages = async () => {
  const directoryEntries = await fs.readdir(workspacePackagesDirectory, { withFileTypes: true });
  const releasePackages = [];
  const releaseUserscripts = [];

  for (const entry of directoryEntries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const packageDirectory = path.join(workspacePackagesDirectory, entry.name);
    const packageJsonPath = path.join(packageDirectory, "package.json");

    try {
      await fs.access(packageJsonPath);
    } catch {
      continue;
    }

    const packageJson = await readJsonFile(packageJsonPath);

    if (
      typeof packageJson.name === "string" &&
      typeof packageJson.version === "string" &&
      typeof packageJson.releaseAsset === "string"
    ) {
      const releaseTag = `${packageJson.name}@${packageJson.version}`;
      const release = await fetchGitHubRelease(releaseTag);
      const hasReleaseAsset =
        release &&
        Array.isArray(release.assets) &&
        release.assets.some((asset) => asset && asset.name === path.basename(packageJson.releaseAsset));
      const shouldReleaseUserscript =
        release === undefined
          ? (() => {
              const previousPackageJson = readPreviousPackageJson(packageJsonPath);
              return !previousPackageJson || previousPackageJson.version !== packageJson.version;
            })()
          : !hasReleaseAsset || release.draft === true;

      if (shouldReleaseUserscript) {
        releaseUserscripts.push({
          directory: path.posix.join("packages", entry.name),
          name: packageJson.name,
          version: packageJson.version,
        });
      }
    }

    if (
      packageJson.private === true ||
      typeof packageJson.name !== "string" ||
      typeof packageJson.version !== "string"
    ) {
      continue;
    }

    const publishedVersions = await fetchPublishedVersions(packageJson.name);

    if (publishedVersions.has(packageJson.version)) {
      console.log(`Skipped ${packageJson.name}@${packageJson.version} because that version is already on npm`);
      continue;
    }

    releasePackages.push({
      directory: path.posix.join("packages", entry.name),
      name: packageJson.name,
      version: packageJson.version,
    });
  }

  return { releasePackages, releaseUserscripts };
};

const { releasePackages, releaseUserscripts } = await resolveReleasePackages();
const packageDirectoriesJson = JSON.stringify(releasePackages.map(({ directory }) => directory));
const userscriptDirectoriesJson = JSON.stringify(releaseUserscripts.map(({ directory }) => directory));

if (releasePackages.length === 0 && releaseUserscripts.length === 0) {
  console.log("No unpublished workspace packages found for npm release");
} else {
  if (releasePackages.length > 0) {
    console.log(
      `Resolved unpublished workspace packages: ${releasePackages
        .map(({ name, version }) => `${name}@${version}`)
        .join(", ")}`,
    );
  }
  if (releaseUserscripts.length > 0) {
    console.log(
      `Resolved userscript release assets: ${releaseUserscripts
        .map(({ name, version }) => `${name}@${version}`)
        .join(", ")}`,
    );
  }
}

await appendGitHubOutput("has_packages", releasePackages.length > 0 ? "true" : "false");
await appendGitHubOutput("package_directories_json", packageDirectoriesJson);
await appendGitHubOutput("has_userscripts", releaseUserscripts.length > 0 ? "true" : "false");
await appendGitHubOutput("userscript_directories_json", userscriptDirectoriesJson);
