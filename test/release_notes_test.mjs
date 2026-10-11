import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import releaseConfig from "../release.config.cjs";

const localRequire = createRequire(import.meta.url);
const releaseRequire = createRequire(localRequire.resolve("semantic-release"));
const { generateNotes } = await import(pathToFileURL(
  releaseRequire.resolve("@semantic-release/release-notes-generator"),
).href);
const { analyzeCommits } = await import(pathToFileURL(
  releaseRequire.resolve("@semantic-release/commit-analyzer"),
).href);
const root = fileURLToPath(new URL("../", import.meta.url));
const repositoryUrl = "https://github.com/cmeister2/manyfold_openscad";
const pluginOptions = (name) => releaseConfig.plugins.find(
  (plugin) => Array.isArray(plugin) && plugin[0] === name,
)[1];

test("release notes render Conventional Commits templates and links", async () => {
  const notes = await generateNotes(pluginOptions("@semantic-release/release-notes-generator"), {
    cwd: root,
    options: { repositoryUrl },
    lastRelease: { gitTag: "1.0.0" },
    nextRelease: { version: "2.0.0", gitTag: "2.0.0" },
    commits: [
      {
        hash: "1234567890123456789012345678901234567890",
        message: "feat: add library filters",
      },
      {
        hash: "abcdef0123456789abcdef0123456789abcdef01",
        message: "fix: repair import feedback\n\nCloses #42",
      },
      {
        hash: "0123456789abcdef0123456789abcdef01234567",
        message: "feat!: require an import format\n\nBREAKING CHANGE: Imports must specify their format.",
      },
    ],
  });

  for (const expected of [
    `[2.0.0](${repositoryUrl}/compare/1.0.0...2.0.0)`,
    "### Features",
    "### Bug Fixes",
    "BREAKING CHANGES",
    "Imports must specify their format.",
    "add library filters",
    "repair import feedback",
    `${repositoryUrl}/issues/42`,
    `${repositoryUrl}/commit/1234567890123456789012345678901234567890`,
  ]) {
    assert.ok(notes.includes(expected), `Missing ${JSON.stringify(expected)} in release notes:\n${notes}`);
  }
});

for (const [message, expected] of [
  ["feat: add library filters", "minor"],
  ["fix: repair import feedback", "patch"],
  ["feat!: require an import format\n\nBREAKING CHANGE: Imports must specify their format.", "major"],
]) {
  test(`commit analysis selects a ${expected} release`, async () => {
    const release = await analyzeCommits(pluginOptions("@semantic-release/commit-analyzer"), {
      cwd: root,
      commits: [{ hash: "1234567890123456789012345678901234567890", message }],
      logger: { log() {} },
    });
    assert.equal(release, expected);
  });
}
