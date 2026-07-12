import { createHash } from "node:crypto";
import { readFile, stat, appendFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import process from "node:process";

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const RELEASE_ASSETS = ["main.js", "manifest.json", "styles.css"];

const packageJson = await readJson("package.json");
const packageLock = await readJson("package-lock.json");
const manifest = await readJson("manifest.json");
const versions = await readJson("versions.json");
const changelog = await readFile("CHANGELOG.md", "utf8");
const thirdPartyNotices = (await readFile("THIRD_PARTY_NOTICES.md", "utf8")).trim();
const allowUnreleased = process.argv.includes("--allow-unreleased");
const requestedVersion = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
const expectedVersion = process.env.RELEASE_TAG || requestedVersion || manifest.version;

assert(
  typeof expectedVersion === "string" && VERSION_PATTERN.test(expectedVersion),
  `Release version must use x.y.z without a v prefix: ${String(expectedVersion)}`
);
assert(packageJson.version === expectedVersion, "package.json version does not match");
assert(packageLock.version === expectedVersion, "package-lock.json version does not match");
assert(
  packageLock.packages?.[""]?.version === expectedVersion,
  "package-lock.json root package version does not match"
);
assert(manifest.version === expectedVersion, "manifest.json version does not match");
assert(
  versions[expectedVersion] === manifest.minAppVersion,
  "versions.json must map the release to manifest.minAppVersion"
);
if (expectedVersion === "0.1.0") {
  assert(manifest.isDesktopOnly === true, "0.1.0 must be marked desktop-only");
}

const hasDatedChangelogEntry = new RegExp(
  `^## \\[${escapeRegex(expectedVersion)}\\] - \\d{4}-\\d{2}-\\d{2}$`,
  "m"
).test(changelog);
if (allowUnreleased) {
  assert(
    hasDatedChangelogEntry || /^## \[Unreleased\]$/m.test(changelog),
    "CHANGELOG.md needs either an Unreleased section or a dated release heading"
  );
} else {
  assert(hasDatedChangelogEntry, "CHANGELOG.md needs a dated release heading");
  assert(
    !new RegExp(`^## \\[?${escapeRegex(expectedVersion)}\\]? - Unreleased$`, "m").test(
      changelog
    ),
    "The release version cannot remain marked Unreleased"
  );
}

const checksums = [];
for (const asset of RELEASE_ASSETS) {
  const assetStat = await stat(asset);
  assert(assetStat.isFile() && assetStat.size > 0, `${asset} is missing or empty`);
  const contents = await readFile(asset);
  checksums.push(`${createHash("sha256").update(contents).digest("hex")}  ${asset}`);
}

const mainJs = await readFile("main.js", "utf8");
assert(!/sourceMappingURL/.test(mainJs), "Production main.js must not reference a source map");
assert(
  thirdPartyNotices.includes("Permission is hereby granted") &&
    thirdPartyNotices.includes("Copyright (c) Facebook, Inc. and its affiliates."),
  "THIRD_PARTY_NOTICES.md must contain the complete bundled MIT notice"
);
assert(
  mainJs.includes(thirdPartyNotices),
  "Production main.js must embed THIRD_PARTY_NOTICES.md"
);

for (const [packageName, noticeName] of [
  ["react", "React"],
  ["react-dom", "React DOM"],
  ["scheduler", "Scheduler"]
]) {
  const bundledVersion = packageLock.packages?.[`node_modules/${packageName}`]?.version;
  assert(typeof bundledVersion === "string", `${packageName} is missing from package-lock.json`);
  assert(
    thirdPartyNotices.includes(`${noticeName} ${bundledVersion}`),
    `THIRD_PARTY_NOTICES.md must list ${noticeName} ${bundledVersion}`
  );
  const installedLicense = (
    await readFile(`node_modules/${packageName}/LICENSE`, "utf8")
  ).trim();
  assert(
    thirdPartyNotices.includes(installedLicense),
    `THIRD_PARTY_NOTICES.md must include the installed ${noticeName} license verbatim`
  );
}

const forbiddenTrackedFiles = runGit([
  "ls-files",
  "main.js",
  "*.map",
  "data.json",
  "index-cache.json"
]);
assert(
  forbiddenTrackedFiles.length === 0,
  `Runtime/generated files must not be tracked: ${forbiddenTrackedFiles}`
);

const summary = [
  `Release ${expectedVersion} metadata and assets verified.`,
  "",
  "SHA-256:",
  ...checksums
].join("\n");
console.log(summary);

if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(
    process.env.GITHUB_STEP_SUMMARY,
    `## PalmWiki Home release verification\n\n\u0060\u0060\u0060text\n${summary}\n\u0060\u0060\u0060\n`
  );
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function runGit(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  assert(result.status === 0, result.stderr || `git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
