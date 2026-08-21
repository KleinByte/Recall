param(
  [string]$CurrentInstallerPath,
  [string]$PreviousInstallerPath
)

$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$package = Get-Content (Join-Path $repositoryRoot "package.json") -Raw | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($CurrentInstallerPath)) {
  $CurrentInstallerPath = Join-Path $repositoryRoot "release\$($package.version)\Recall-Windows-Setup.exe"
}
$currentInstaller = (Resolve-Path -LiteralPath $CurrentInstallerPath).Path
$previousInstaller = if ([string]::IsNullOrWhiteSpace($PreviousInstallerPath)) {
  $null
} else {
  (Resolve-Path -LiteralPath $PreviousInstallerPath).Path
}

$expectedInstallDirectory = Join-Path $env:LOCALAPPDATA "Programs\Recall"
$expectedExecutable = Join-Path $expectedInstallDirectory "Recall.exe"
$userDataDirectory = Join-Path $env:APPDATA "Recall"
$sentinelPath = Join-Path $userDataDirectory "store-installer-preservation-sentinel.json"
$uninstallRegistryPaths = @(
  "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
  "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
  "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
)

function Get-RecallUninstallEntry {
  @(
    Get-ItemProperty -Path $uninstallRegistryPaths -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName -eq "Recall" }
  ) | Select-Object -First 1
}

function Assert-CleanMachine {
  $reasons = @()
  if (Get-RecallUninstallEntry) { $reasons += "Recall has an uninstall registry entry" }
  if (Test-Path -LiteralPath $expectedInstallDirectory) {
    $reasons += "$expectedInstallDirectory already exists"
  }
  if (Test-Path -LiteralPath $userDataDirectory) {
    $reasons += "$userDataDirectory already exists"
  }
  if (Get-Process -Name "Recall" -ErrorAction SilentlyContinue) {
    $reasons += "Recall is already running"
  }
  if ($reasons.Count -gt 0) {
    throw "Silent installer testing requires a clean disposable VM: $($reasons -join '; ')."
  }
}

function Invoke-SilentInstaller([string]$installer, [string]$label) {
  $process = Start-Process -FilePath $installer -ArgumentList "/S" -PassThru -Wait
  if ($process.ExitCode -ne 0) {
    throw "$label installer exited with $($process.ExitCode)."
  }
  if (-not (Test-Path -LiteralPath $expectedExecutable)) {
    throw "$label installer exited successfully but $expectedExecutable is missing."
  }
  if (Get-Process -Name "Recall" -ErrorAction SilentlyContinue) {
    throw "$label silent install unexpectedly launched Recall."
  }
  Write-Host "$label silent install completed with exit code 0."
}

function Assert-InstalledVersion([string]$expectedVersion, [string]$label) {
  $actualVersion = (Get-Item -LiteralPath $expectedExecutable).VersionInfo.ProductVersion
  $actualParts = ([version]$actualVersion).ToString(3)
  $expectedParts = ([version]$expectedVersion).ToString(3)
  if ($actualParts -ne $expectedParts) {
    throw "$label installed version $actualVersion; expected $expectedVersion."
  }
}

function Invoke-SilentUninstall([string]$label) {
  $entry = Get-RecallUninstallEntry
  $uninstaller = Join-Path $expectedInstallDirectory "Uninstall Recall.exe"
  if ($entry -and -not [string]::IsNullOrWhiteSpace($entry.UninstallString)) {
    $candidate = ([string]$entry.UninstallString).Trim().Trim('"')
    if (Test-Path -LiteralPath $candidate) { $uninstaller = $candidate }
  }
  if (-not (Test-Path -LiteralPath $uninstaller)) {
    throw "$label uninstaller is missing at $uninstaller."
  }
  $process = Start-Process -FilePath $uninstaller -ArgumentList "/S" -PassThru -Wait
  if ($process.ExitCode -ne 0) {
    throw "$label uninstaller exited with $($process.ExitCode)."
  }
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  while ((Test-Path -LiteralPath $expectedExecutable) -and [DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Milliseconds 250
  }
  if (Test-Path -LiteralPath $expectedExecutable) {
    throw "$label uninstaller exited successfully but Recall.exe remains installed."
  }
  Write-Host "$label silent uninstall completed with exit code 0."
}

Assert-CleanMachine

try {
  if ($previousInstaller) {
    $previousVersion = (Get-Item -LiteralPath $previousInstaller).VersionInfo.ProductVersion
    if ([version]$previousVersion -ge [version]([string]$package.version)) {
      throw "Previous installer version $previousVersion is not older than $($package.version)."
    }
    Invoke-SilentInstaller $previousInstaller "Previous-version"
    Assert-InstalledVersion $previousVersion "Previous-version"
  } else {
    Invoke-SilentInstaller $currentInstaller "Initial"
    Assert-InstalledVersion $package.version "Initial"
  }

  New-Item -ItemType Directory -Path $userDataDirectory -Force | Out-Null
  [ordered]@{
    format = "recall-store-installer-preservation-sentinel"
    createdAt = [DateTime]::UtcNow.ToString("o")
  } | ConvertTo-Json | Set-Content -LiteralPath $sentinelPath -Encoding UTF8

  if ($previousInstaller) {
    Invoke-SilentInstaller $currentInstaller "Upgrade"
    Assert-InstalledVersion $package.version "Upgrade"
    if (-not (Test-Path -LiteralPath $sentinelPath)) {
      throw "Upgrade removed Recall user data."
    }
  }

  Invoke-SilentUninstall "First"
  if (-not (Test-Path -LiteralPath $sentinelPath)) {
    throw "Uninstall removed Recall user data even though deleteAppDataOnUninstall is false."
  }

  Invoke-SilentInstaller $currentInstaller "Reinstall"
  Assert-InstalledVersion $package.version "Reinstall"
  if (-not (Test-Path -LiteralPath $sentinelPath)) {
    throw "Reinstall did not preserve Recall user data."
  }

  Invoke-SilentUninstall "Final"
  if (-not (Test-Path -LiteralPath $sentinelPath)) {
    throw "Final uninstall removed Recall user data."
  }

  Write-Host "Silent install, upgrade/reinstall, uninstall, data preservation, and exit-code checks passed."
} finally {
  if (Test-Path -LiteralPath $expectedExecutable) {
    try { Invoke-SilentUninstall "Cleanup" } catch { Write-Warning $_ }
  }
  if (Test-Path -LiteralPath $sentinelPath) {
    Remove-Item -LiteralPath $sentinelPath -Force
  }
  if ((Test-Path -LiteralPath $userDataDirectory) -and
      -not (Get-ChildItem -LiteralPath $userDataDirectory -Force | Select-Object -First 1)) {
    Remove-Item -LiteralPath $userDataDirectory -Force
  }
}
