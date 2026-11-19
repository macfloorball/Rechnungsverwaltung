!ifndef TTC_NATIVE_HELPERS
!define TTC_NATIVE_HELPERS
!include LogicLib.nsh
!include Win\COM.nsh
!include Win\Propkey.nsh

; NSIS uses an x86 Unicode stub even for the x64 application.
; Status: 0 = confirmed absent, 1 = present, 2 = inspection failed.
Var TTCNativeStatus
!macro TTC_CheckProcess executable
  System::Store "S"
  StrCpy $TTCNativeStatus 2
  System::Call 'kernel32::CreateToolhelp32Snapshot(i2,i0)p.r0'
  ${If} $0 P<> -1
    System::Alloc 556
    Pop $1
    ${If} $1 P<> 0
      System::Call '*$1(i556)'
      System::Call 'kernel32::Process32FirstW(p r0,p r1)i.r2 ?e'
      Pop $3
      ${Do}
        ${If} $2 == 0
          ${If} $3 == 18 ; ERROR_NO_MORE_FILES is the only safe negative result.
            StrCpy $TTCNativeStatus 0
          ${EndIf}
          ${ExitDo}
        ${EndIf}
        IntOp $4 $1 + 36 ; PROCESSENTRY32W.szExeFile
        System::Call 'kernel32::lstrcmpiW(p r4,w "${executable}")i.r3'
        ${If} $3 == 0
          StrCpy $TTCNativeStatus 1
          ${ExitDo}
        ${EndIf}
        System::Call 'kernel32::Process32NextW(p r0,p r1)i.r2 ?e'
        Pop $3
      ${Loop}
      System::Free $1
    ${EndIf}
    System::Call 'kernel32::CloseHandle(p r0)'
  ${EndIf}
  System::Store "L"
!macroend

; Set the documented PKEY_AppUserModel_ID through the Shell property store.
; No WinShell plugin is embedded. Every allocation/interface is released.
!macro TTC_SetLnkAUMI shortcut appId
  System::Store "S"
  System::Call 'ole32::CoInitializeEx(p0,i2)i.r9'
  StrCpy $TTCNativeStatus 2
  StrCpy $0 0
  StrCpy $1 0
  StrCpy $2 0
  StrCpy $3 0
  StrCpy $4 0
  StrCpy $5 0
  !insertmacro ComHlpr_CreateInProcInstance ${CLSID_ShellLink} ${IID_IShellLink} r0 ""
  ${Do}
    ${If} $0 P= 0
      ${ExitDo}
    ${EndIf}
    ${IUnknown::QueryInterface} $0 '("${IID_IPersistFile}",.r1)'
    ${If} $1 P= 0
      ${ExitDo}
    ${EndIf}
    ${IPersistFile::Load} $1 '("${shortcut}",2).r6'
    ${If} $6 != 0
      ${ExitDo}
    ${EndIf}
    ${IUnknown::QueryInterface} $0 '("${IID_IPropertyStore}",.r2)'
    ${If} $2 P= 0
      ${ExitDo}
    ${EndIf}
    System::Call '*${SYSSTRUCT_PROPERTYKEY}(${PKEY_AppUserModel_ID})p.r3'
    System::Call '*(&w${NSIS_MAX_STRLEN} "${appId}")p.r5'
    ; PROPVARIANT: VT_LPWSTR + reserved fields + pointer + zero padding.
    System::Call '*(i${VT_LPWSTR},i0,p r5,i0)p.r4'
    ${If} $3 P= 0
    ${OrIf} $4 P= 0
    ${OrIf} $5 P= 0
      ${ExitDo}
    ${EndIf}
    ${IPropertyStore::SetValue} $2 '($3,$4).r6'
    ${If} $6 != 0
      ${ExitDo}
    ${EndIf}
    ${IPropertyStore::Commit} $2 '().r6'
    ${If} $6 != 0
      ${ExitDo}
    ${EndIf}
    ${IPersistFile::Save} $1 '("${shortcut}",1).r6'
    ${If} $6 == 0
      StrCpy $TTCNativeStatus 0
    ${EndIf}
    ${ExitDo}
  ${Loop}
  System::Free $3
  System::Free $4
  System::Free $5
  !insertmacro ComHlpr_SafeRelease $2
  !insertmacro ComHlpr_SafeRelease $1
  !insertmacro ComHlpr_SafeRelease $0
  ${If} $9 >= 0
    System::Call 'ole32::CoUninitialize()'
  ${EndIf}
  System::Store "L"
  ${If} $TTCNativeStatus != 0
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONSTOP "Die Windows-Verknüpfung konnte nicht eingerichtet werden. Bitte Installation erneut ausführen."
    ${EndIf}
    SetErrorLevel 6
    Quit
  ${EndIf}
!macroend

; Cleanup remains best effort, as in electron-builder's original templates.
!macro TTC_UninstShortcut shortcut
  System::Store "S"
  System::Call 'ole32::CoInitializeEx(p0,i2)i.r9'
  StrCpy $0 0
  StrCpy $1 0
  System::Call 'shell32::SHCreateItemFromParsingName(w "${shortcut}",p0,g "${IID_IShellItem}",*p.r0)i'
  ${If} $0 P<> 0
    !insertmacro ComHlpr_CreateInProcInstance ${CLSID_StartMenuPin} ${IID_IStartMenuPinnedList} r1 ""
    ${If} $1 P<> 0
      ${IStartMenuPinnedList::RemoveFromList} $1 '($0)'
    ${EndIf}
  ${EndIf}
  !insertmacro ComHlpr_SafeRelease $1
  !insertmacro ComHlpr_SafeRelease $0
  ${If} $9 >= 0
    System::Call 'ole32::CoUninitialize()'
  ${EndIf}
  System::Store "L"
!macroend

!macro TTC_UninstAppUserModelId appId
  System::Store "S"
  System::Call 'ole32::CoInitializeEx(p0,i2)i.r9'
  StrCpy $0 0
  !insertmacro ComHlpr_CreateInProcInstance {86c14003-4d6b-4ef3-a7b4-0506663b2e68} {12337d35-94c6-48a0-bce7-6a9c69d4d600} r0 ""
  ${If} $0 P<> 0
    System::Call '$0->3(w "${appId}")i.r1' ; IApplicationDestinations::SetAppID
    ${If} $1 == 0
      System::Call '$0->5()i' ; RemoveAllDestinations
    ${EndIf}
    ${IUnknown::Release} $0 ""
  ${EndIf}
  StrCpy $0 0
  !insertmacro ComHlpr_CreateInProcInstance {77f10cf0-3db5-4966-b520-b7c54fd35ed6} {6332debf-87b5-4670-90c0-5e57b408a49e} r0 ""
  ${If} $0 P<> 0
    System::Call '$0->10(w "${appId}")i' ; ICustomDestinationList::DeleteList
    ${IUnknown::Release} $0 ""
  ${EndIf}
  ${If} $9 >= 0
    System::Call 'ole32::CoUninitialize()'
  ${EndIf}
  System::Store "L"
!macroend
!endif
