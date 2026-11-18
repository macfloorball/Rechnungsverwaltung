'use strict';
// Static program text only. Context arrives separately over stdin, never as code.
module.exports = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Set-StrictMode -Version Latest
$lock = $null; $package = $null; $context = $null; $committed = $false
function HashBytes($bytes) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
}
function HashStream($stream) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try { $stream.Position = 0; return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
}
function SecurePath([string]$path) {
  $entry = Get-Item -LiteralPath $path -Force
  if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'PATH' }
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $acl = Get-Acl -LiteralPath $path
  $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
  if ($owner -notin @($sid,'S-1-5-18','S-1-5-32-544')) { throw 'ACL' }
  $write = [Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
  foreach ($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
    if (($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0) { continue }
    if ($rule.AccessControlType -eq 'Allow' -and ($rule.FileSystemRights -band $write) -ne 0 -and $rule.IdentityReference.Value -notin @($sid,'S-1-5-18','S-1-5-32-544')) { throw 'ACL' }
  }
}
function Signature([string]$file) {
  $s = Get-AuthenticodeSignature -LiteralPath $file
  if ((Get-Item -LiteralPath $file).VersionInfo.ProductVersion -cne $context.version) { throw 'VERSION' }
  if ($context.windowsMode -ceq 'ed25519-only') {
    if ($s.Status -ne 'NotSigned') { throw 'SIGNATURE' }
    return
  }
  if ($context.windowsMode -cne 'authenticode-required') { throw 'MODE' }
  if ($s.Status -ne 'Valid' -or $null -eq $s.SignerCertificate -or $null -eq $s.TimeStamperCertificate) { throw 'SIGNATURE' }
  if ((HashBytes $s.SignerCertificate.RawData) -cne $context.certificate -or $s.SignerCertificate.Subject -cne $context.publisher) { throw 'PUBLISHER' }
}
function Journal([string]$phase) {
  $json = @{formatVersion=1; phase=$phase; version=$context.version; previousVersion=$context.currentVersion; time=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json -Compress
  $temporary = $context.journal + '.tmp-' + [Guid]::NewGuid().ToString('N')
  [IO.File]::WriteAllText($temporary,$json,[Text.UTF8Encoding]::new($false))
  if (Test-Path -LiteralPath $context.journal) { [IO.File]::Replace($temporary,$context.journal,$null) } else { [IO.File]::Move($temporary,$context.journal) }
}
function Installed {
  $root = [IO.Path]::Combine($context.directory,'resources','app')
  $metadata = Get-Content -LiteralPath ([IO.Path]::Combine($root,'package.json')) -Raw | ConvertFrom-Json
  if ($metadata.version -cne $context.version -or $metadata.desktopAppId -cne 'de.mac-floorball.ttc-rechnungsverwaltung' -or $metadata.ttcDistribution -cne 'installer' -or $metadata.desktopRelease.channel -cne 'stable' -or $metadata.desktopRelease.version -cne $context.version -or $metadata.desktopRelease.commit -cne $context.commit) { throw 'INCOMPLETE' }
  $trust = $metadata.desktopUpdateTrust
  if ($trust.enabled -ne $true -or ($trust.publicKeyPem -replace '\s','') -cne ($context.publicKeyPem -replace '\s','')) { throw 'TRUST' }
  $mode = 'authenticode-required'
  if ($null -ne $trust.windows.PSObject.Properties['mode']) { $mode = $trust.windows.mode }
  if ($mode -cne $context.windowsMode) { throw 'TRUST' }
  foreach ($field in @('repository','repositoryId','visibility','keyId')) {
    if ($trust.$field -cne $context.trust.$field) { throw 'TRUST' }
  }
  if ($mode -ceq 'authenticode-required' -and ($trust.windows.certificateSha256 -cne $context.certificate -or $trust.windows.publisherSubject -cne $context.publisher)) { throw 'TRUST' }
  $manifest = Get-Content -LiteralPath ([IO.Path]::Combine($root,'installation-manifest.json')) -Raw | ConvertFrom-Json
  if ($manifest.formatVersion -ne 1 -or @($manifest.files.PSObject.Properties).Count -lt 20) { throw 'INCOMPLETE' }
  foreach ($name in $context.requiredFiles) { if ($null -eq $manifest.files.PSObject.Properties[$name]) { throw 'INCOMPLETE' } }
  foreach ($property in $manifest.files.PSObject.Properties) {
    if ($property.Name -match '(^/|\\|:|(^|/)\.\.(/|$))' -or $property.Value -notmatch '^[a-f0-9]{64}$') { throw 'INCOMPLETE' }
    $file = [IO.Path]::GetFullPath([IO.Path]::Combine($root,$property.Name.Replace('/','\')))
    if (-not $file.StartsWith($root + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'INCOMPLETE' }
    SecurePath $file
    if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -cne $property.Value) { throw 'INCOMPLETE' }
  }
  Signature $context.executable
  $installed = Get-ItemProperty -LiteralPath $context.uninstallKey
  if ($installed.DisplayVersion -cne $context.version) { throw 'INCOMPLETE' }
}
try {
  $line = [Console]::In.ReadLine()
  if ($line.Length -gt 65536) { throw 'CONTEXT' }
  $context = $line | ConvertFrom-Json
  if ($context.version -notmatch '^\d+\.\d+\.\d+$' -or [version]$context.version -le [version]$context.currentVersion -or $context.hash -notmatch '^[a-f0-9]{64}$') { throw 'VERSION' }
  foreach ($p in @($context.profile,$context.updates,$context.downloads,$context.slot,$context.file)) { SecurePath $p }
  $ancestor = [IO.DirectoryInfo]::new($context.profile)
  while ($null -ne $ancestor) { if (($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'PATH' }; $ancestor = $ancestor.Parent }
  if (Test-Path -LiteralPath $context.lock) { SecurePath $context.lock }
  $lock = [IO.File]::Open($context.lock,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
  $package = [IO.File]::Open($context.file,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
  if ($package.Length -ne $context.size -or (HashStream $package) -cne $context.hash) { throw 'HASH' }
  Signature $context.file
  $registered = Get-ItemProperty -LiteralPath $context.installKey
  if (-not ([IO.Path]::GetFullPath($registered.InstallLocation).TrimEnd('\')).Equals($context.directory.TrimEnd('\'),[StringComparison]::OrdinalIgnoreCase)) { throw 'INSTALLATION' }
  $registeredVersion = (Get-ItemProperty -LiteralPath $context.uninstallKey).DisplayVersion
  if ($registeredVersion -cne $context.currentVersion -or [version]$registeredVersion -ge [version]$context.version) { throw 'DOWNGRADE' }
  $parent = [Diagnostics.Process]::GetProcessById($context.parentPid)
  if (-not $parent.MainModule.FileName.Equals($context.executable,[StringComparison]::OrdinalIgnoreCase)) { throw 'PARENT' }
  [Console]::Out.WriteLine('TTC_UPDATE_READY'); [Console]::Out.Flush()
  if ([Console]::In.ReadLine() -cne 'commit') { throw 'CANCELLED' }
  Journal 'handoff'
  $committed = $true
  [Console]::Out.WriteLine('TTC_UPDATE_COMMITTED'); [Console]::Out.Flush()
  if ([Console]::In.ReadLine() -cne 'launch') { throw 'CANCELLED' }
  if (-not $parent.WaitForExit(60000)) { throw 'PARENT' }
  # The exact installer remains locked against write/delete until it finishes.
  Signature $context.file
  if ((HashStream $package) -cne $context.hash) { throw 'HASH' }
  $psi = [Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $context.file; $psi.UseShellExecute = $false; $psi.WorkingDirectory = $context.slot
  # No /S, elevation, user-selected path or arbitrary command arguments.
  if ([DateTimeOffset]::Parse($context.expiresAt).UtcDateTime -le [DateTime]::UtcNow) { throw 'EXPIRED' }
  $installer = [Diagnostics.Process]::Start($psi)
  $installer.WaitForExit()
  if ($installer.ExitCode -ne 0) { throw 'INSTALLER' }
  Installed
  Journal 'installed'
  $package.Dispose(); $package = $null
  Remove-Item -LiteralPath $context.slot -Recurse -Force
  $lock.Dispose(); $lock = $null
  $restart = [Diagnostics.ProcessStartInfo]::new()
  $restart.FileName = $context.executable; $restart.WorkingDirectory = $context.directory; $restart.UseShellExecute = $false
  [void][Diagnostics.Process]::Start($restart)
} catch {
  if ($null -ne $context -and $committed) {
    try { Journal 'failed' } catch {}
    try { Add-Type -AssemblyName System.Windows.Forms; [void][Windows.Forms.MessageBox]::Show('Das Update wurde abgebrochen oder konnte nicht vollständig geprüft werden. Persönliche Daten bleiben erhalten. Bitte die App manuell starten oder den vollständigen geprüften Installer verwenden.','TT Rechnungsverwaltung - Update') } catch {}
  } else { try { [Console]::Out.WriteLine('TTC_UPDATE_REJECTED'); [Console]::Out.Flush() } catch {} }
  exit 1
} finally {
  if ($null -ne $package) { $package.Dispose() }
  if ($null -ne $lock) { $lock.Dispose() }
}
`;
