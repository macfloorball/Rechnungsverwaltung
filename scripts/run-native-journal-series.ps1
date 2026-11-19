#Requires -Version 7.4
param(
    [Parameter(Mandatory)][string] $PairRoot,
    [ValidateRange(1,20)][int] $Count=1
)
$ErrorActionPreference='Stop'
$pair=(Resolve-Path -LiteralPath $PairRoot).Path
$driver=Join-Path $PSScriptRoot 'windows-native-installed-pair.ps1'
$guid='da941357-9ae2-5f27-a221-a8db9727ec79'
$key="HKCU:\Software\$guid"
$uninstall="HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$guid"
if ((Test-Path $key) -or (Test-Path $uninstall)) { throw 'A registered installation exists. Use a clean test installation.' }
$builds=Get-Content -LiteralPath (Join-Path $pair 'builds.json') -Raw | ConvertFrom-Json
$a,$b=$builds.packages
$helper='dist/windows/TT Rechnungsverwaltung-win32-x64/resources/app/electron/windows_update_helper.cjs'
$hashA=(Get-FileHash -LiteralPath (Join-Path (Join-Path $pair 'A') $helper)).Hash
$hashB=(Get-FileHash -LiteralPath (Join-Path (Join-Path $pair 'B') $helper)).Hash
$blob=git hash-object --path=electron/windows_update_helper.cjs (Join-Path (Join-Path $pair 'A') $helper)
if ($hashA -ne $hashB -or $blob -ne (git rev-parse 'HEAD:electron/windows_update_helper.cjs') -or (git rev-parse HEAD) -ne $builds.sha) { throw 'Unexpected source/helper provenance' }
$series=(New-Item -ItemType Directory (Join-Path $pair 'native-series')).FullName
$resultPath=Join-Path $series 'results.jsonl'
[pscustomobject]@{source=$builds.sha;helperSha256=$hashA;packages=$builds.packages;transport='fixture';consent='fixture'} |
    ConvertTo-Json -Depth 8 | Set-Content (Join-Path $series 'provenance.json')
function Wait-Result($Path,$Run) {
    $deadline=[datetime]::UtcNow.AddMinutes(8)
    do {
        if (Test-Path -LiteralPath $Path) {
            $result=$null
            try { $result=Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json } catch {}
            if ($result) {
                if (!$result.passed) { throw $result.error }
                return $result
            }
        }
        $folder=Join-Path $Run 'profile/updates'
        if ((Test-Path -LiteralPath $folder) -and (Get-ChildItem -LiteralPath $folder -Filter '*.error.json')) { throw "Journal failure. Evidence at $Run" }
        Start-Sleep -Milliseconds 250
    } while ([datetime]::UtcNow -lt $deadline)
    throw "No result at $Path"
}
function Get-UpdateProcess($Run) {
    $downloads=Join-Path $Run 'profile\updates\downloads'
    $deadline=[datetime]::UtcNow.AddMinutes(8)
    do {
        $installers=@(Get-CimInstance -ClassName Win32_Process -Filter "Name LIKE 'ttc-rechnungsverwaltung-%-windows-x64-setup.exe'" |
            Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith("$downloads\", [StringComparison]::OrdinalIgnoreCase) })
        if ($installers.Count -eq 1) {
            $installer=$installers[0]
            $helper=Get-CimInstance -ClassName Win32_Process -Filter "ProcessId=$($installer.ParentProcessId)"
            if ($helper.Name -eq 'powershell.exe') {
                return [pscustomobject]@{installer=$installer.ProcessId;helper=$helper.ProcessId}
            }
        }
        if (Test-Path -LiteralPath (Join-Path $Run 'native-result.json')) { break }
        Start-Sleep -Milliseconds 350
    } while ([datetime]::UtcNow -lt $deadline)
    throw "No native installer/helper process evidence at $Run"
}
function Wait-Gone([int]$PidToWait) {
    $running=Get-Process -Id $PidToWait -ErrorAction SilentlyContinue
    if ($running) {
        try { if (!$running.WaitForExit(25000)) { throw "Process $PidToWait did not exit" } }
        catch { if (Get-Process -Id $PidToWait -ErrorAction SilentlyContinue) { throw } }
    }
}
for ($i=1;$i -le $Count;$i++) {
    $run=(New-Item -ItemType Directory (Join-Path $series ('run-{0:D2}' -f $i))).FullName
    Write-Output "Native run $i/$Count starting: $run"
    foreach ($name in @('builds.json','desktop-update.json','desktop-update.json.sig')) { Copy-Item -LiteralPath (Join-Path $pair $name) -Destination $run }
    & $driver -FixtureRoot $run -Step InstallA
    & $driver -FixtureRoot $run -Step LaunchA
    $processes=Get-UpdateProcess $run
    $processes | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $run 'update-processes.json')
    $auto=Wait-Result (Join-Path $run 'native-result.json') $run
    Wait-Gone $auto.pid
    $stop=Get-Content -LiteralPath (Join-Path $run 'native-shutdown.json') -Raw | ConvertFrom-Json
    if ($stop.forced -ne $false -or $stop.pid -ne $auto.pid) { throw 'Automatic B did not stop cooperatively' }
    Wait-Gone $auto.parentPid
    Wait-Gone $auto.previousPid
    Wait-Gone $processes.installer
    Wait-Gone $processes.helper
    $installDirectory=(Get-ItemProperty -LiteralPath $key).InstallLocation
    $registered=(Get-ItemProperty -LiteralPath $uninstall).DisplayVersion
    $installed=(Get-Item -LiteralPath (Join-Path $installDirectory 'TT Rechnungsverwaltung.exe')).VersionInfo.ProductVersion
    if ($auto.to -ne $b.version -or $registered -ne $b.version -or $installed -ne $b.version -or $auto.pid -eq $auto.previousPid -or $auto.observedJournal.phase -ne 'installed') { throw 'Invalid B or update journal' }
    if (!(Select-String -LiteralPath (Join-Path $run 'LaunchA.stderr.log') -Pattern 'Application shutdown complete' -Quiet)) { throw 'Missing backend shutdown evidence' }
    $updates=Join-Path $run 'profile/updates'
    if ((Test-Path (Join-Path $updates 'windows-install-state.json')) -or @(Get-ChildItem -LiteralPath (Join-Path $updates 'downloads') -Force).Count) { throw 'Completed update left staging files' }
    $lock=[IO.File]::Open((Join-Path $updates 'windows-install.lock'),'Open','ReadWrite','None')
    $lock.Dispose()
    & $driver -FixtureRoot $run -Step LaunchB
    $restart=Wait-Result (Join-Path $run 'native-restart.json') $run
    Wait-Gone $restart.pid
    $stop=Get-Content -LiteralPath (Join-Path $run 'native-restart-shutdown.json') -Raw | ConvertFrom-Json
    if ($stop.forced -ne $false -or $stop.pid -ne $restart.pid) { throw 'Restarted B did not stop cooperatively' }
    if ($auto.pdfSha -ne $restart.pdfSha -or $auto.backupSha -ne $restart.backupSha -or $auto.nextNumber -ne $restart.nextNumber -or $auto.pid -eq $restart.pid) { throw 'Restart did not preserve the test result' }
    & $driver -FixtureRoot $run -Step RemoveTest
    [pscustomobject]@{run=$i;status='passed';evidence=$run;auto=$auto;restart=$restart;updateProcesses=$processes;registry=$registered;productVersion=$installed} |
        ConvertTo-Json -Depth 8 -Compress | Add-Content -LiteralPath $resultPath
    Write-Output "Native run $i/$Count passed"
}
