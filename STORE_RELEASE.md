# Microsoft Store EXE release

Recall uses the same per-user, x64 NSIS identity for direct and Microsoft Store
installations. The Store build is an offline installer; it does not download
application files during setup. Existing GitHub update behavior remains active
after installation.

## Build gates

Run the complete signed package gate on Windows:

```powershell
pnpm store:package
```

Azure signing credentials and all `AZURE_TRUSTED_SIGNING_*` values used by the
release workflow must be present. The command:

1. runs source, test, renderer, native-runtime, and end-to-end verification;
2. builds the offline x64 NSIS installer through `electron-builder.store.cjs`;
3. updates Microsoft Defender security intelligence and scans the exact
   installer with remediation disabled;
4. extracts the installer and rejects foreign native modules;
5. requires every installed `.exe`, `.dll`, and Windows `.node` file to have a
   trusted Authenticode signature and timestamp; and
6. emits the Defender report, Store inventory, dependency/license inventory,
   and SHA-256 checksum manifest beside the installer.

The expected release files are under `release/<version>/`:

- `Recall-Windows-Setup.exe`
- `Recall-Windows-Setup.exe.blockmap`
- `latest.yml`
- `Recall-Windows-Setup.defender.json`
- `Recall-Windows-Setup.store-inventory.json`
- `Recall-Windows-Setup.sha256`

## Clean Windows client validation

The lifecycle script intentionally refuses to run if Recall or its user-data
directory already exists. Run it only on disposable, clean Windows 10 x64 and
Windows 11 x64 VMs:

```powershell
powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass `
  -File scripts/test-store-installer.ps1 `
  -CurrentInstallerPath release/<version>/Recall-Windows-Setup.exe `
  -PreviousInstallerPath C:/path/to/previous/Recall-Windows-Setup.exe
```

It verifies `/S` install exit codes, upgrade from the previous release, silent
uninstall, reinstall, version replacement, lack of an automatic post-install
launch, and preservation of `%APPDATA%/Recall` data. Omit
`-PreviousInstallerPath` only when no older release exists.

## Publishing

Push a tag that exactly matches `package.json`, such as `v3.3.0`. The release
workflow publishes the verified bytes and records this immutable Partner
Center package URL:

```text
https://github.com/KleinByte/Recall/releases/download/v<version>/Recall-Windows-Setup.exe
```

Never replace an asset under an existing release tag. Publish a new application
version and tag, then create a new Partner Center submission with its URL.
