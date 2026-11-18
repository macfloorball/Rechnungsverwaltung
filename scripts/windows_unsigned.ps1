param(
  [Parameter(Mandatory=$true)][string]$Path,
  [Parameter(Mandatory=$true)][string]$ExpectedVersion
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
try {
  $signature = Get-AuthenticodeSignature -LiteralPath $Path
  if ($signature.Status -ne 'NotSigned') { throw 'Explizit unsigniertes Paket erwartet; kein Fallback bei Signaturfehlern.' }
  if ((Get-Item -LiteralPath $Path).VersionInfo.ProductVersion -cne $ExpectedVersion) { throw 'Falsche Produktversion.' }
  @{ status='NotSigned'; certificateSha256=$null; publisherSubject=$null; timestamped=$false; version=$ExpectedVersion } | ConvertTo-Json -Compress
} catch {
  [Console]::Error.WriteLine("Windows-Paketprüfung fehlgeschlagen: $($_.Exception.Message)")
  exit 1
}
