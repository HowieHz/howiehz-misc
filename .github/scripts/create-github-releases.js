import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const packageDirectories = JSON.parse(process.env.PACKAGE_DIRECTORIES_JSON ?? "[]");
const userscriptDirectories = JSON.parse(process.env.USERSCRIPT_DIRECTORIES_JSON ?? "[]");
const releaseAssetRoot = path.resolve(process.env.RELEASE_ASSET_ROOT ?? "dist/userscript-assets");
const repository = process.env.GITHUB_REPOSITORY;
const githubToken = process.env.GITHUB_TOKEN;
const githubSha = process.env.GITHUB_SHA;

if (!Array.isArray(packageDirectories) || !Array.isArray(userscriptDirectories)) {
  throw new Error("PACKAGE_DIRECTORIES_JSON and USERSCRIPT_DIRECTORIES_JSON must be arrays.");
}

const allPackageDirectories = [...new Set([...packageDirectories, ...userscriptDirectories])];

if (allPackageDirectories.length === 0) {
  console.log("No package directories were provided for GitHub releases.");
  process.exit(0);
}

if (!repository || !githubToken || !githubSha) {
  throw new Error("GITHUB_REPOSITORY, GITHUB_TOKEN, and GITHUB_SHA are required.");
}

const [repositoryOwner, repositoryName] = repository.split("/");

if (!repositoryOwner || !repositoryName) {
  throw new Error(`Invalid GITHUB_REPOSITORY value: ${repository}`);
}

const apiBaseUrl = `https://api.github.com/repos/${repositoryOwner}/${repositoryName}`;
const uploadsApiBaseUrl = `https://uploads.github.com/repos/${repositoryOwner}/${repositoryName}`;
const userscriptDirectorySet = new Set(userscriptDirectories);

const readJsonFile = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

const runGit = (args, options = {}) => {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });

  return result;
};

const ensureGitSuccess = (result, command) => {
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${result.stderr.trim() || result.stdout.trim()}`);
  }
};

const githubRequest = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${githubToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API request failed: ${response.status} ${response.statusText}\n${body}`);
  }

  return response.json();
};

const ensureTag = (tagName) => {
  const remoteTag = runGit(["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${tagName}`]);
  if (remoteTag.status === 0) {
    console.log(`Reusing Git tag ${tagName}.`);
    return;
  }

  const localTag = runGit(["tag", "--list", tagName]);
  if (!localTag.stdout.trim()) {
    ensureGitSuccess(runGit(["tag", tagName]), `git tag ${tagName}`);
  }
  ensureGitSuccess(runGit(["push", "origin", `refs/tags/${tagName}`]), `git push origin refs/tags/${tagName}`);
  console.log(`Pushed Git tag ${tagName}.`);
};

const getGitHubRelease = async (tagName) => {
  const response = await fetch(`${apiBaseUrl}/releases/tags/${encodeURIComponent(tagName)}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${githubToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub Release lookup failed: ${response.status} ${response.statusText}\n${body}`);
  }

  return response.json();
};

const createGitHubRelease = async ({ body, hasAssets, prerelease, tagName }) => {
  return githubRequest(`${apiBaseUrl}/releases`, {
    method: "POST",
    body: JSON.stringify({
      body,
      draft: hasAssets,
      name: tagName,
      prerelease,
      tag_name: tagName,
    }),
  });
};

const uploadReleaseAsset = async (release, filePath, assetName) => {
  if (Array.isArray(release.assets) && release.assets.some((asset) => asset.name === assetName)) {
    console.log(`Reusing ${assetName} on GitHub Release.`);
    return;
  }

  const content = await fs.readFile(filePath);
  const response = await fetch(
    `${uploadsApiBaseUrl}/releases/${release.id}/assets?name=${encodeURIComponent(assetName)}`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${githubToken}`,
        "Content-Type": "application/javascript",
        "Content-Length": String(content.byteLength),
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: content,
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub release asset upload failed: ${response.status} ${response.statusText}\n${body}`);
  }

  console.log(`Uploaded ${assetName} to GitHub Release.`);
};

for (const directory of allPackageDirectories) {
  if (typeof directory !== "string" || directory.length === 0) {
    throw new Error(`Invalid package directory: ${directory}`);
  }

  const packageDirectory = path.resolve(directory);
  const packageJson = await readJsonFile(path.join(packageDirectory, "package.json"));

  const isUserscript = userscriptDirectorySet.has(directory);
  if (
    (!isUserscript && packageJson.private === true) ||
    typeof packageJson.name !== "string" ||
    typeof packageJson.version !== "string"
  ) {
    continue;
  }

  const tagName = `${packageJson.name}@${packageJson.version}`;
  const changelogPath = path.posix.join(directory, "CHANGELOG.md");
  const changelogUrl = `https://github.com/${repository}/blob/main/${changelogPath}`;
  let assetName = null;
  let assetPath = null;
  if (isUserscript) {
    if (typeof packageJson.releaseAsset !== "string" || path.isAbsolute(packageJson.releaseAsset)) {
      throw new Error(`releaseAsset must be a relative path: ${directory}`);
    }

    const packageAssetPath = path.resolve(packageDirectory, packageJson.releaseAsset);
    const relativeAssetPath = path.relative(packageDirectory, packageAssetPath);
    if (relativeAssetPath.length === 0 || relativeAssetPath.startsWith("..") || path.isAbsolute(relativeAssetPath)) {
      throw new Error(`releaseAsset must stay inside its package: ${directory}`);
    }

    assetName = path.basename(packageAssetPath);
    assetPath = path.join(releaseAssetRoot, path.basename(directory), assetName);
  }

  ensureTag(tagName);
  const release =
    (await getGitHubRelease(tagName)) ??
    (await createGitHubRelease({
      body: `Please refer to the [changelog](${changelogUrl}) for details.`,
      hasAssets: assetName !== null,
      prerelease: packageJson.version.includes("-"),
      tagName,
    }));

  if (assetName !== null) {
    await uploadReleaseAsset(release, assetPath, assetName);
    if (release.draft) {
      await githubRequest(`${apiBaseUrl}/releases/${release.id}`, {
        method: "PATCH",
        body: JSON.stringify({ draft: false }),
      });
    }
  }

  console.log(`Created GitHub Release ${tagName}.`);
}
