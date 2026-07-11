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
      "tests/fileSnapshot.test.ts",
      "tests/indexCache.test.ts",
      "tests/mapWithConcurrency.test.ts",
      "tests/rebuildRequest.test.ts"
    ],
    bundle: true,
    external: ["obsidian"],
    format: "esm",
    logLevel: "silent",
    outdir: workDir,
    platform: "node",
    target: "node22"
  });

  const result = spawnSync(
    process.execPath,
    [
      "--test",
      join(workDir, "fileSnapshot.test.js"),
      join(workDir, "indexCache.test.js"),
      join(workDir, "mapWithConcurrency.test.js"),
      join(workDir, "rebuildRequest.test.js")
    ],
    { stdio: "inherit" }
  );

  process.exitCode = result.status ?? 1;
} finally {
  await rm(workDir, { recursive: true, force: true });
}
