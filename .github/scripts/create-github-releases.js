import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const packageDirectories = JSON.parse(process.env.PACKAGE_DIRECTORIES_JSON ?? "[]");
const repository = process.env.GITHUB_REPOSITORY;
const githubToken = process.env.GITHUB_TOKEN;
const githubSha = process.env.GITHUB_SHA;

if (!Array.isArray(packageDirectories) || packageDirectories.length === 0) {
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

const createTag = (tagName) => {
  ensureGitSuccess(runGit(["tag", tagName]), `git tag ${tagName}`);
  ensureGitSuccess(runGit(["push", "origin", `refs/tags/${tagName}`]), `git push origin refs/tags/${tagName}`);
  console.log(`Created Git tag ${tagName}.`);
};

const createGitHubRelease = async ({ body, prerelease, tagName }) => {
  await githubRequest(`${apiBaseUrl}/releases`, {
    method: "POST",
    body: JSON.stringify({
      body,
      name: tagName,
      prerelease,
      tag_name: tagName,
    }),
  });

  console.log(`Created GitHub Release ${tagName}.`);
};

for (const directory of packageDirectories) {
  if (typeof directory !== "string" || directory.length === 0) {
    throw new Error(`Invalid package directory: ${directory}`);
  }

  const packageDirectory = path.resolve(directory);
  const packageJson = await readJsonFile(path.join(packageDirectory, "package.json"));

  if (packageJson.private === true || typeof packageJson.name !== "string" || typeof packageJson.version !== "string") {
    continue;
  }

  const tagName = `${packageJson.name}@${packageJson.version}`;
  const changelogPath = path.posix.join(directory, "CHANGELOG.md");
  const changelogUrl = `https://github.com/${repository}/blob/main/${changelogPath}`;

  createTag(tagName);
  await createGitHubRelease({
    body: `Please refer to [Changelog](${changelogUrl}) for details.`,
    prerelease: packageJson.version.includes("-"),
    tagName,
  });
}
