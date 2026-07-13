import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import esbuild from "esbuild";

const workDir = await mkdtemp(join(tmpdir(), "palmwiki-home-tests-"));

try {
  await esbuild.build({
    entryPoints: [
      "tests/cardPreview.test.ts",
      "tests/filterPages.test.ts",
      "tests/fileSnapshot.test.ts",
      "tests/fullTextSearch.test.ts",
      "tests/homeNavigation.test.ts",
      "tests/homeSearch.test.ts",
      "tests/indexPhase.test.ts",
      "tests/indexCache.test.ts",
      "tests/mapWithConcurrency.test.ts",
      "tests/obsidianCompat.test.ts",
      "tests/pageRank.test.ts",
      "tests/rebuildRequest.test.ts",
      "tests/settings.test.ts",
      "tests/sortPages.test.ts",
      "tests/searchCache.test.ts",
      "tests/searchIndexManager.test.ts",
      "tests/titleSuggestions.test.ts"
    ],
    bundle: true,
    external: ["obsidian"],
    format: "esm",
    logLevel: "silent",
    outdir: workDir,
    platform: "node",
    target: "node22",
    banner: {
      js: "const window = globalThis;"
    }
  });

  const result = spawnSync(
    process.execPath,
    [
      "--test",
      join(workDir, "cardPreview.test.js"),
      join(workDir, "filterPages.test.js"),
      join(workDir, "fileSnapshot.test.js"),
      join(workDir, "fullTextSearch.test.js"),
      join(workDir, "homeNavigation.test.js"),
      join(workDir, "homeSearch.test.js"),
      join(workDir, "indexPhase.test.js"),
      join(workDir, "indexCache.test.js"),
      join(workDir, "mapWithConcurrency.test.js"),
      join(workDir, "obsidianCompat.test.js"),
      join(workDir, "pageRank.test.js"),
      join(workDir, "rebuildRequest.test.js"),
      join(workDir, "settings.test.js"),
      join(workDir, "sortPages.test.js"),
      join(workDir, "searchCache.test.js"),
      join(workDir, "searchIndexManager.test.js"),
      join(workDir, "titleSuggestions.test.js")
    ],
    { stdio: "inherit" }
  );

  process.exitCode = result.status ?? 1;
} finally {
  await rm(workDir, { recursive: true, force: true });
}
