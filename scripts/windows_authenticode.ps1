param(
  [Parameter(Mandatory=$true)][ValidateSet('Sign','Verify')][string]$Mode,
  [Parameter(Mandatory=$true)][string]$Path,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{40}$')][string]$CertificateSha1,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{64}$')][string]$CertificateSha256,
  [Parameter(Mandatory=$true)][string]$PublisherSubject,
  [Parameter(Mandatory=$true)][string]$TimestampUrl,
  [Parameter(Mandatory=$true)][string]$ExpectedVersion
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
try {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw 'Datei fehlt.' }
  $tools = @(Get-ChildItem -Path "${env:ProgramFiles(x86)}/Windows Kits/10/bin/*/x64/signtool.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending)
  if ($tools.Count -eq 0) { throw 'Microsoft Windows SDK mit signtool.exe fehlt.' }
  $tool = $tools[0].FullName
  if ($Mode -eq 'Sign') {
    $certificate = Get-Item -LiteralPath "Cert:/CurrentUser/My/$CertificateSha1"
    if (-not $certificate.HasPrivateKey -or $certificate.Subject -cne $PublisherSubject -or
        $certificate.GetCertHashString([System.Security.Cryptography.HashAlgorithmName]::SHA256).ToLowerInvariant() -cne $CertificateSha256) {
      throw 'Signierzertifikat entspricht nicht der freigegebenen Identität.'
    }
    $uri = [uri]$TimestampUrl
    if ($uri.Scheme -ne 'https' -or $uri.UserInfo -or $uri.Fragment) { throw 'HTTPS-Zeitstempeldienst erforderlich.' }
    & $tool sign /sha1 $CertificateSha1 /s My /fd SHA256 /tr $TimestampUrl /td SHA256 $Path | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Authenticode-Signierung fehlgeschlagen.' }
  }
  & $tool verify /pa /all /q $Path | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Signaturprüfung mit Windows SDK fehlgeschlagen.' }
  $signature = Get-AuthenticodeSignature -LiteralPath $Path
  if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate -or $null -eq $signature.TimeStamperCertificate) {
    throw 'Gültige vertrauenswürdige Signatur mit Zeitstempel erforderlich.'
  }
  $fingerprint = $signature.SignerCertificate.GetCertHashString([System.Security.Cryptography.HashAlgorithmName]::SHA256).ToLowerInvariant()
  if ($fingerprint -cne $CertificateSha256 -or $signature.SignerCertificate.Subject -cne $PublisherSubject) {
    throw 'Signatur stammt nicht vom freigegebenen Herausgeber.'
  }
  $version = (Get-Item -LiteralPath $Path).VersionInfo.ProductVersion
  if ($version -cne $ExpectedVersion) { throw 'Signierte Programmversion stimmt nicht mit dem Release überein.' }
  @{ status='Valid'; certificateSha256=$fingerprint; publisherSubject=$signature.SignerCertificate.Subject; timestamped=$true; version=$version } | ConvertTo-Json -Compress
} catch {
  [Console]::Error.WriteLine("Windows-Signaturprüfung fehlgeschlagen: $($_.Exception.Message)")
  exit 1
}
