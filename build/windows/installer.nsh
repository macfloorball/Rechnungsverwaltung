; Keep installation scope stable even if the installer is launched by an admin.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend
