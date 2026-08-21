param(
  [string]$InstallerPath,
  [switch]$SkipSignatureUpdate
)

$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$package = Get-Content (Join-Path $repositoryRoot "package.json") -Raw | ConvertFrom-Json

if ([string]::IsNullOrWhiteSpace($InstallerPath)) {
  $InstallerPath = Join-Path $repositoryRoot "release\$($package.version)\Recall-Windows-Setup.exe"
}
$installer = (Resolve-Path -LiteralPath $InstallerPath).Path

$defenderCandidates = @()
$platformRoot = Join-Path $env:ProgramData "Microsoft\Windows Defender\Platform"
if (Test-Path -LiteralPath $platformRoot) {
  $defenderCandidates += @(
    Get-ChildItem -LiteralPath $platformRoot -Directory |
      Sort-Object LastWriteTimeUtc -Descending |
      ForEach-Object { Join-Path $_.FullName "MpCmdRun.exe" }
  )
}
$defenderCandidates += Join-Path $env:ProgramFiles "Windows Defender\MpCmdRun.exe"
$defender = $defenderCandidates |
  Where-Object { Test-Path -LiteralPath $_ } |
  Select-Object -First 1
if (-not $defender) {
  throw "Microsoft Defender MpCmdRun.exe is not installed."
}

if (-not $SkipSignatureUpdate) {
  & $defender -SignatureUpdate
  if ($LASTEXITCODE -ne 0) {
    throw "Microsoft Defender security intelligence update failed with exit code $LASTEXITCODE."
  }
}

$status = Get-MpComputerStatus
if (-not $status.AntivirusEnabled) {
  throw "Microsoft Defender Antivirus is not enabled."
}

$scanOutput = @(
  & $defender -Scan -ScanType 3 -File $installer -DisableRemediation 2>&1
) | Out-String
$scanExitCode = $LASTEXITCODE
if ($scanExitCode -ne 0) {
  throw "Microsoft Defender rejected or could not scan the installer (exit $scanExitCode): $($scanOutput.Trim())"
}

$hash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
$reportPath = Join-Path (Split-Path -Parent $installer) "Recall-Windows-Setup.defender.json"
$report = [ordered]@{
  format = "recall-microsoft-defender-scan"
  version = 1
  installer = Split-Path -Leaf $installer
  installerSha256 = $hash
  scannedAt = [DateTime]::UtcNow.ToString("o")
  engineVersion = [string]$status.AMEngineVersion
  platformVersion = [string]$status.AMProductVersion
  antivirusSignatureVersion = [string]$status.AntivirusSignatureVersion
  antivirusSignatureLastUpdated = $status.AntivirusSignatureLastUpdated.ToUniversalTime().ToString("o")
  scanType = "custom"
  scanTarget = $installer
  remediationDisabled = $true
  exitCode = $scanExitCode
  output = $scanOutput.Trim()
}
$report | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $reportPath -Encoding UTF8

Write-Host "Microsoft Defender accepted $($report.installer) with security intelligence $($report.antivirusSignatureVersion)."
Write-Host "Defender report: $reportPath"
