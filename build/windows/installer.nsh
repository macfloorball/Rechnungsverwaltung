; Keep installation scope stable even if the installer is launched by an admin.
!include WordFunc.nsh

!macro customInit
  ReadRegStr $R0 HKCU "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
  ${If} $R0 != ""
    ${VersionCompare} $R0 "${VERSION}" $R1
    ${If} $R1 == "1"
      ${IfNot} ${Silent}
        MessageBox MB_OK|MB_ICONSTOP "Eine neuere App-Version ist installiert. Ein Downgrade kann den Datenbestand gefährden. Bitte die passende Version verwenden."
      ${EndIf}
      SetErrorLevel 3
      Quit
    ${EndIf}
  ${EndIf}
!macroend

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; electron-builder's stock uninstaller also accepts --delete-app-data even
; when deleteAppDataOnUninstall is false. This application deliberately does
; not offer profile deletion through its uninstaller.
!macro customUnInit
  ClearErrors
  ${GetParameters} $R0
  ${GetOptions} $R0 "--delete-app-data" $R1
  ${IfNot} ${Errors}
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONSTOP "Persönliche Rechnungsdaten werden nicht durch die Deinstallation gelöscht. Bitte ohne --delete-app-data erneut starten."
    ${EndIf}
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend
