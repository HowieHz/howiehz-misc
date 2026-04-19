import fs from "node:fs/promises";
import path from "node:path";

const workspacePackagesDirectory = path.resolve("packages");
const npmRegistryBaseUrl = "https://registry.npmjs.org";

const appendGitHubOutput = async (name, value) => {
  const outputPath = process.env.GITHUB_OUTPUT;

  if (!outputPath) {
    return;
  }

  await fs.appendFile(outputPath, `${name}=${value}\n`, "utf8");
};

const readJsonFile = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

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

  return releasePackages;
};

const releasePackages = await resolveReleasePackages();
const packageDirectoriesJson = JSON.stringify(releasePackages.map(({ directory }) => directory));

if (releasePackages.length === 0) {
  console.log("No unpublished workspace packages found for npm release");
} else {
  console.log(
    `Resolved unpublished workspace packages: ${releasePackages.map(({ name, version }) => `${name}@${version}`).join(", ")}`,
  );
}

await appendGitHubOutput("has_packages", releasePackages.length > 0 ? "true" : "false");
await appendGitHubOutput("package_directories_json", packageDirectoriesJson);
