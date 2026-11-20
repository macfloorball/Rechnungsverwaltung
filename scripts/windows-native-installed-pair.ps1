#Requires -Version 7.4
param(
    [Parameter(Mandatory)][string] $FixtureRoot,
    [Parameter(Mandatory)][ValidateSet('InstallA','LaunchA','LaunchB','CheckB','RemoveTest')][string] $Step
)
$ErrorActionPreference='Stop'
$fixture = (Resolve-Path -LiteralPath $FixtureRoot).Path
$builds = Get-Content -LiteralPath (Join-Path $fixture 'builds.json') -Raw | ConvertFrom-Json
$a,$b = $builds.packages
$guid='da941357-9ae2-5f27-a221-a8db9727ec79'
$installKey="HKCU:\Software\$guid"
$uninstallKey="HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$guid"
$processes = Get-Process -Name 'TT Rechnungsverwaltung','TTC Rechnungsverwaltung' -ErrorAction SilentlyContinue
if ($processes) { throw 'An app process is still running' }
function Registration {
    $path = (Get-ItemProperty -LiteralPath $installKey).InstallLocation
    $entry = Get-ItemProperty -LiteralPath $uninstallKey
    $exe = Get-Item -LiteralPath (Join-Path $path 'TT Rechnungsverwaltung.exe')
    $metadata = Get-Content -LiteralPath (Join-Path $path 'resources/app/package.json') -Raw | ConvertFrom-Json
    [pscustomobject]@{Location=$path; RegistryVersion=$entry.DisplayVersion; ProductVersion=$exe.VersionInfo.ProductVersion;
        FileVersion=$exe.VersionInfo.FileVersion; Exe=$exe.FullName; Metadata=$metadata}
}
function RunInstaller($Package, $ExpectedExit) {
    $actualHash = (Get-FileHash -LiteralPath $Package.path -Algorithm SHA256).Hash
    if ($actualHash -ne $Package.sha256) { throw 'Fixture installer hash changed' }
    if ((Get-AuthenticodeSignature -LiteralPath $Package.path).Status -ne 'NotSigned') { throw 'Unexpected fixture signature' }
    $proc = Start-Process -FilePath $Package.path -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
    if ($proc.ExitCode -ne $ExpectedExit) { throw "Expected NSIS exit code $ExpectedExit, got $($proc.ExitCode)" }
    Write-Output "NSIS $($Package.version) exit $($proc.ExitCode)"
}
function TestRegistration($Registration, $Package) {
    if ($Registration.RegistryVersion -ne $Package.version -or $Registration.ProductVersion -ne $Package.version -or
        $Registration.Metadata.desktopRelease.commit -ne $Package.commit -or
        $Registration.Metadata.desktopUpdateTrust.repository -ne 'macfloorball/ttc-isolated-windows-fixture') { throw 'Unexpected Windows registration' }
}
switch ($Step) {
    'InstallA' {
        if ((Test-Path $installKey) -or (Test-Path $uninstallKey)) {
            throw 'A registered installation exists. Use a clean Windows test account.'
        }
        RunInstaller $a 0
        $current = Registration; TestRegistration $current $a
        $current | Select-Object Location,RegistryVersion,ProductVersion,FileVersion | ConvertTo-Json
    }
    { $_ -in 'LaunchA','LaunchB' } {
        $current = Registration; TestRegistration $current $(if ($_ -eq 'LaunchA') { $a } else { $b })
        $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
        $listener.Start(); $origin = "http://127.0.0.1:$($listener.LocalEndpoint.Port)/"; $listener.Stop()
        $env = @{ TTC_WINDOWS_NATIVE_FIXTURE=$fixture; TTC_DATA_DIRECTORY=(Join-Path $fixture 'data');
            TTC_DOCUMENT_DIRECTORY=(Join-Path $fixture 'Eigene Belege'); TTC_LEGACY_DATABASE=(Join-Path $fixture 'no-legacy.db');
            TTC_DESKTOP_PRODUCTION_URL=$origin }
        # Match a normal GUI launch. Redirecting stdout masks invalid inherited
        # handles in the bundled backend and can hide shutdown failures.
        $proc = Start-Process -FilePath $current.Exe -Environment $env -WorkingDirectory $fixture -PassThru
        [pscustomobject]@{Id=$proc.Id;Origin=$origin} | ConvertTo-Json
    }
    'CheckB' {
        $current = Registration; TestRegistration $current $b
        $result=Get-Content -LiteralPath (Join-Path $fixture 'native-result.json') -Raw | ConvertFrom-Json
        if (!$result.passed) { throw $result.error }
        RunInstaller $a 3
        $current = Registration; TestRegistration $current $b
        $expected = Get-Content -LiteralPath (Join-Path $fixture 'expected.json') -Raw | ConvertFrom-Json
        if ((Get-FileHash -LiteralPath (Join-Path $expected.docs $expected.invoice.pdf_path)).Hash -ne $result.pdfSha -or
            (Get-FileHash -LiteralPath $expected.backup).Hash -ne $result.backupSha) { throw 'Downgrade changed test data' }
        $current | Select-Object Location,RegistryVersion,ProductVersion,FileVersion | ConvertTo-Json
    }
    'RemoveTest' {
        $current = Registration
        $package = @($a,$b) | Where-Object version -eq $current.RegistryVersion
        if (!$package) { throw 'Refusing to remove an installation outside the test pair' }
        TestRegistration $current $package
        $uninstaller=Join-Path $current.Location 'Uninstall TT Rechnungsverwaltung.exe'
        $proc = Start-Process -FilePath $uninstaller -ArgumentList '/S','/currentuser' -PassThru -Wait -WindowStyle Hidden
        if ($proc.ExitCode -ne 0) { throw "Test uninstaller exit $($proc.ExitCode)" }
        if ((Test-Path $installKey) -or (Test-Path $uninstallKey)) { throw 'Test registration remains' }
    }
}
