param(
  [Parameter(Mandatory = $true)]
  [string]$TargetsPath,

  [Parameter(Mandatory = $true)]
  [string]$OutputPath
)

$ErrorActionPreference = "Stop"

$resolvedTargets = (Resolve-Path -LiteralPath $TargetsPath).Path
$targets = Get-Content -LiteralPath $resolvedTargets -Raw | ConvertFrom-Json

$results = foreach ($target in $targets) {
  $resolvedFile = (Resolve-Path -LiteralPath ([string]$target.absolutePath)).Path
  $signature = Get-AuthenticodeSignature -LiteralPath $resolvedFile

  [ordered]@{
    role = [string]$target.role
    path = [string]$target.path
    status = [string]$signature.Status
    statusMessage = [string]$signature.StatusMessage
    signerSubject = [string]$signature.SignerCertificate.Subject
    signerIssuer = [string]$signature.SignerCertificate.Issuer
    signerThumbprint = [string]$signature.SignerCertificate.Thumbprint
    signerNotBefore = if ($signature.SignerCertificate) {
      $signature.SignerCertificate.NotBefore.ToUniversalTime().ToString("o")
    } else { $null }
    signerNotAfter = if ($signature.SignerCertificate) {
      $signature.SignerCertificate.NotAfter.ToUniversalTime().ToString("o")
    } else { $null }
    timestampSubject = [string]$signature.TimeStamperCertificate.Subject
    timestampIssuer = [string]$signature.TimeStamperCertificate.Issuer
    timestampThumbprint = [string]$signature.TimeStamperCertificate.Thumbprint
    timestampNotBefore = if ($signature.TimeStamperCertificate) {
      $signature.TimeStamperCertificate.NotBefore.ToUniversalTime().ToString("o")
    } else { $null }
    timestampNotAfter = if ($signature.TimeStamperCertificate) {
      $signature.TimeStamperCertificate.NotAfter.ToUniversalTime().ToString("o")
    } else { $null }
  }
}

$outputDirectory = Split-Path -Parent $OutputPath
if ($outputDirectory) {
  New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
}
@($results) | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
