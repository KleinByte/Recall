const signedConfig = require("./electron-builder.azure.cjs")

// Keep the existing application identity and NSIS GUID by extending the
// production signing configuration. This is intentionally an offline NSIS
// package: Partner Center invokes it with /S and Recall continues to use its
// existing GitHub update channel after installation.
module.exports = {
  ...signedConfig,
  win: {
    ...signedConfig.win,
    target: [
      {
        target: "nsis",
        arch: ["x64"],
      },
    ],
  },
}
