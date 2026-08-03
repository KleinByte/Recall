const baseConfig = require("./electron-builder.json")

const signingEnvironment = {
  publisherName: "AZURE_TRUSTED_SIGNING_PUBLISHER_NAME",
  endpoint: "AZURE_TRUSTED_SIGNING_ENDPOINT",
  certificateProfileName: "AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME",
  codeSigningAccountName: "AZURE_TRUSTED_SIGNING_ACCOUNT_NAME",
}

const missingVariables = Object.values(signingEnvironment).filter(
  variableName => !process.env[variableName]?.trim()
)

if (missingVariables.length > 0) {
  throw new Error(
    `Azure Trusted Signing is not configured. Missing environment variables: ${missingVariables.join(", ")}`
  )
}

module.exports = {
  ...baseConfig,
  win: {
    ...baseConfig.win,
    azureSignOptions: {
      publisherName: process.env[signingEnvironment.publisherName],
      endpoint: process.env[signingEnvironment.endpoint],
      certificateProfileName: process.env[signingEnvironment.certificateProfileName],
      codeSigningAccountName: process.env[signingEnvironment.codeSigningAccountName],
      fileDigest: "SHA256",
      timestampRfc3161: "http://timestamp.acs.microsoft.com",
      timestampDigest: "SHA256",
    },
  },
}
