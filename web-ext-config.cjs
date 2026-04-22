// Configuration for the `web-ext` CLI.
// Keeps the uploaded zip clean by excluding repo infrastructure and docs.
module.exports = {
  ignoreFiles: [
    ".git/**",
    ".github/**",
    ".gitignore",
    "web-ext-artifacts/**",
    "node_modules/**",
    "CHANGELOG.md",
    "LICENSE",
    "README.md",
    "web-ext-config.cjs",
    "package.json",
    "package-lock.json",
  ],
  build: {
    overwriteDest: true,
  },
};
