module.exports = {
  branches: ["main"],
  tagFormat: "${version}",
  plugins: [
    ["@semantic-release/commit-analyzer", { preset: "conventionalcommits" }],
    ["@semantic-release/release-notes-generator", { preset: "conventionalcommits" }],
    ["@semantic-release/exec", {
      prepareCmd: "python3 bin/package ${nextRelease.version}",
    }],
    ["@semantic-release/github", {
      assets: [{ path: "dist/manyfold_openscad.zip" }],
      successCommentCondition: false,
      failCommentCondition: false,
      failTitle: false,
      releasedLabels: false,
    }],
  ],
};
