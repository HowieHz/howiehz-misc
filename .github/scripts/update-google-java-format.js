import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const formatJavaScriptPath = path.join("scripts", "format-java.js");
const mavenMetadataUrl =
  "https://repo1.maven.org/maven2/com/google/googlejavaformat/google-java-format/maven-metadata.xml";
const mavenArtifactBaseUrl = "https://repo1.maven.org/maven2/com/google/googlejavaformat/google-java-format";
const dryRun = process.argv.includes("--dry-run");
// Keep the same release holdback policy as the Node.js / pnpm updater: the
// current latest must age for 24 hours before automation opens a PR.
const latestReleaseMinAgeMs = 24 * 60 * 60 * 1000;

const appendGitHubOutput = async (name, value) => {
  const outputPath = process.env.GITHUB_OUTPUT;

  if (!outputPath) {
    return;
  }

  await fs.appendFile(outputPath, `${name}=${value}\n`, "utf8");
};

const stripUtf8Bom = (content) => content.replace(/^\uFEFF/u, "");

const readUtf8File = async (filePath) => {
  const absolutePath = path.resolve(process.cwd(), filePath);
  return stripUtf8Bom(await fs.readFile(absolutePath, "utf8"));
};

const maybeWriteFile = async (filePath, nextContent) => {
  if (dryRun) {
    return;
  }

  await fs.writeFile(path.resolve(process.cwd(), filePath), nextContent, "utf8");
};

const parseSemVer = (version) => {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?$/u.exec(version);

  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3] ?? 0),
  };
};

const compareSemVer = (left, right) => left.major - right.major || left.minor - right.minor || left.patch - right.patch;

const parseMavenLastUpdated = (value) => {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/u.exec(value);

  if (!match) {
    return null;
  }

  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
};

const hasReachedLatestReleaseMinAge = (mavenLastUpdated, now = Date.now()) => {
  const publishedTimestamp = parseMavenLastUpdated(mavenLastUpdated);

  if (publishedTimestamp === null) {
    throw new Error(`Invalid Maven lastUpdated value: ${mavenLastUpdated || "<empty>"}`);
  }

  return now - publishedTimestamp >= latestReleaseMinAgeMs;
};

const matchXmlText = (content, tagName) => {
  const match = new RegExp(`<${tagName}>([^<]+)</${tagName}>`, "u").exec(content);
  return match ? match[1].trim() : "";
};

const matchAllXmlText = (content, tagName) =>
  [...content.matchAll(new RegExp(`<${tagName}>([^<]+)</${tagName}>`, "gu"))].map((match) => match[1].trim());

const fetchText = async (url) => {
  const response = await fetch(url, {
    headers: {
      Accept: "application/xml,text/xml,text/plain",
      "User-Agent": "howiehz-misc-google-java-format-updater",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return response.text();
};

const fetchBytes = async (url) => {
  const response = await fetch(url, {
    headers: {
      Accept: "application/java-archive,application/octet-stream",
      "User-Agent": "howiehz-misc-google-java-format-updater",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  return Buffer.from(await response.arrayBuffer());
};

const readCurrentFormatterConstants = async () => {
  const content = await readUtf8File(formatJavaScriptPath);
  const version = matchScriptConst(content, "GOOGLE_JAVA_FORMAT_VERSION");
  const sha256 = matchScriptConst(content, "GOOGLE_JAVA_FORMAT_SHA256");

  if (!parseSemVer(version)) {
    throw new Error(`Invalid GOOGLE_JAVA_FORMAT_VERSION in ${formatJavaScriptPath}: ${version || "<empty>"}`);
  }

  if (!/^[0-9a-f]{64}$/u.test(sha256)) {
    throw new Error(`Invalid GOOGLE_JAVA_FORMAT_SHA256 in ${formatJavaScriptPath}: ${sha256 || "<empty>"}`);
  }

  return {
    content,
    sha256,
    version,
  };
};

const matchScriptConst = (content, name) => {
  const match = new RegExp(`^const ${name} = "([^"]+)";$`, "mu").exec(content);
  return match ? match[1].trim() : "";
};

const fetchLatestFormatterVersion = async () => {
  const metadata = await fetchText(mavenMetadataUrl);
  const versions = matchAllXmlText(metadata, "version");
  const release = matchXmlText(metadata, "release") || versions.at(-1) || "";
  const lastUpdated = matchXmlText(metadata, "lastUpdated");

  if (!parseSemVer(release)) {
    throw new Error(`Invalid google-java-format release version in Maven metadata: ${release || "<empty>"}`);
  }

  if (!lastUpdated) {
    throw new Error("Missing google-java-format Maven metadata lastUpdated timestamp");
  }

  return {
    lastUpdated,
    version: release,
  };
};

const createFormatterJarUrl = (version) =>
  `${mavenArtifactBaseUrl}/${version}/google-java-format-${version}-all-deps.jar`;

const calculateSha256 = (content) => createHash("sha256").update(content).digest("hex");

const replaceScriptConst = (content, name, value) =>
  content.replace(new RegExp(`^(const ${name} = ")([^"]+)(";$)`, "mu"), `$1${value}$3`);

const updateFormatterScript = async (current, next) => {
  let nextContent = replaceScriptConst(current.content, "GOOGLE_JAVA_FORMAT_VERSION", next.version);
  nextContent = replaceScriptConst(nextContent, "GOOGLE_JAVA_FORMAT_SHA256", next.sha256);

  if (nextContent === current.content) {
    return false;
  }

  await maybeWriteFile(formatJavaScriptPath, nextContent);
  return true;
};

const current = await readCurrentFormatterConstants();
const latest = await fetchLatestFormatterVersion();
const currentVersion = parseSemVer(current.version);
const latestVersion = parseSemVer(latest.version);

console.log(`Current google-java-format version: ${current.version}`);
console.log(`Resolved google-java-format latest version: ${latest.version}`);

let changed = false;
let targetSha256 = current.sha256;

if (compareSemVer(latestVersion, currentVersion) <= 0) {
  console.log("No google-java-format version update was required");
} else if (!hasReachedLatestReleaseMinAge(latest.lastUpdated)) {
  console.log(
    `Skipping google-java-format update because latest ${latest.version} was published at Maven lastUpdated ${latest.lastUpdated} and is still within the 24-hour holdback`,
  );
} else {
  const jarUrl = createFormatterJarUrl(latest.version);
  targetSha256 = calculateSha256(await fetchBytes(jarUrl));
  changed = await updateFormatterScript(current, {
    sha256: targetSha256,
    version: latest.version,
  });

  if (changed) {
    console.log(`Updated ${formatJavaScriptPath}`);
    console.log(`- GOOGLE_JAVA_FORMAT_VERSION -> ${latest.version}`);
    console.log(`- GOOGLE_JAVA_FORMAT_SHA256 -> ${targetSha256}`);
  }
}

await appendGitHubOutput("changed", changed ? "true" : "false");
await appendGitHubOutput("version", latest.version);
await appendGitHubOutput("sha256", targetSha256);
await appendGitHubOutput("updated_files", changed ? formatJavaScriptPath : "");
await appendGitHubOutput("update_count", changed ? "2" : "0");

if (dryRun && changed) {
  process.exitCode = 10;
}
