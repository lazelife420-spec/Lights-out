Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"

Name "Lights Out"
OutFile "${OUTPUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\Lights Out"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetDatablockOptimize on
ShowInstDetails show
ShowUninstDetails show
Icon "${APP_ICON}"
UninstallIcon "${APP_ICON}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "Lights Out"
VIAddVersionKey "CompanyName" "The Proof Foundry"
VIAddVersionKey "FileDescription" "Lights Out Setup"
VIAddVersionKey "FileVersion" "${VERSION}.0"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "Copyright (C) 2026 The Proof Foundry"

Var QaMode

!define LO_RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define LO_STARTUP_APPROVED_RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
; main.js calls app.setLoginItemSettings() without a `name`, so Electron names the Run value
; (and its StartupApproved twin) after the app's AppUserModelId (shell/browser/browser_win.cc).
; Nothing sets one, so Electron 43 generates "electron.app.<ProductName>" from the running
; executable's version resource (GetRawAppUserModelID in shell/common/application_info_win.cc),
; not from package.json. stamp-windows-identity.ps1 stamps ProductName "Lights Out" on
; Lights Out.exe. test/packaging-hardening-installer.test.js ties this value to that stamp.
!define ELECTRON_LOGIN_ITEM_NAME "electron.app.Lights Out"
; The package.json-name form, removed too (ownership-checked) in case an Electron version derives
; the default AppUserModelId from app.name instead. Tied to electron/package.json by the same test.
!define ELECTRON_APP_NAME_LOGIN_ITEM_NAME "electron.app.lights-out-electron"
; Per-user scheduled task names; test/packaging-hardening-installer.test.js ties them to
; watchdog.js and alarm.js.
!define LO_WATCHDOG_TASK_NAME "LightsOut-AutopilotWatchdog"
!define LO_FIRST_LIGHT_TASK_NAME "LightsOut_FirstLight"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

; Checks whether $0 is an unsafe top-level or system directory (sets $1 = 1 if unsafe, 0 if safe).
Function IsUnsafeInstDir
  Push $2
  Push $3
  Push $4
  StrCpy $1 0

  ; Strip trailing backslashes
  ${Do}
    StrLen $2 $0
    ${If} $2 <= 0
      ${ExitDo}
    ${EndIf}
    StrCpy $3 $0 1 -1
    ${If} $3 == "\"
      StrCpy $0 $0 -1
    ${Else}
      ${ExitDo}
    ${EndIf}
  ${Loop}

  ; Reject empty path or drive roots (e.g. C:, C:\)
  StrLen $2 $0
  ${If} $2 <= 3
    StrCpy $1 1
    Goto done
  ${EndIf}

  ; Reject exact matches against well-known system or user-profile root directories
  ${If} $0 == "$WINDIR"
  ${OrIf} $0 == "$SYSDIR"
  ${OrIf} $0 == "$PROGRAMFILES"
  ${OrIf} $0 == "$PROGRAMFILES64"
  ${OrIf} $0 == "$PROFILE"
  ${OrIf} $0 == "$LOCALAPPDATA"
  ${OrIf} $0 == "$APPDATA"
  ${OrIf} $0 == "$DESKTOP"
  ${OrIf} $0 == "$DOCUMENTS"
  ${OrIf} $0 == "$TEMP"
  ${OrIf} $0 == "$SMPROGRAMS"
    StrCpy $1 1
    Goto done
  ${EndIf}

  ; Reject anything inside Windows directory
  StrLen $3 "$WINDIR\"
  StrCpy $4 $0 $3
  ${If} $4 == "$WINDIR\"
    StrCpy $1 1
    Goto done
  ${EndIf}

done:
  Pop $4
  Pop $3
  Pop $2
FunctionEnd

; Recursively removes the directory named in $0, but only when it is a real directory and
; not a junction or symbolic link that could lead outside the install folder.
Function RemoveAppOwnedSubtree
  Push $1
  Push $2
  System::Call 'kernel32::GetFileAttributesW(w "$0") i .r1'
  ${If} $1 <> -1
    ; Require FILE_ATTRIBUTE_DIRECTORY (16) set and FILE_ATTRIBUTE_REPARSE_POINT (1024) clear.
    IntOp $2 $1 & 1040
    ${If} $2 = 16
      RMDir /r "$0"
    ${EndIf}
  ${EndIf}
  Pop $2
  Pop $1
FunctionEnd

; Removes a Run-at-login value, and its Task Manager StartupApproved twin, only when the value
; launches this install's Lights Out.exe. Electron writes it as "<quoted exe path>" <args>, so a
; login item of another Lights Out copy (for example a portable one) is left alone.
!macro REMOVE_OWNED_LOGIN_ITEM VALUE_NAME
  Push $0
  Push $1
  Push $2
  ClearErrors
  ReadRegStr $0 HKCU "${LO_RUN_KEY}" "${VALUE_NAME}"
  ${If} ${Errors}
  ${OrIf} $0 == ""
    ; No Run value under this name, so an approval entry under it is an orphan.
    DeleteRegValue HKCU "${LO_STARTUP_APPROVED_RUN_KEY}" "${VALUE_NAME}"
  ${Else}
    StrCpy $1 '"$INSTDIR\Lights Out.exe"'
    StrLen $2 $1
    StrCpy $2 $0 $2
    ${If} $2 == $1
      DeleteRegValue HKCU "${LO_RUN_KEY}" "${VALUE_NAME}"
      DeleteRegValue HKCU "${LO_STARTUP_APPROVED_RUN_KEY}" "${VALUE_NAME}"
    ${EndIf}
  ${EndIf}
  Pop $2
  Pop $1
  Pop $0
!macroend

; Removes a per-user scheduled task only when its action launches this install's Lights Out.exe,
; the ownership rule watchdog.js deleteTask follows. Task names are per Windows user, not per
; install: a task another Lights Out copy armed (for example a permanently extracted portable one,
; whose autopilot watchdog or First Light wake alarm it is) is left alone, and so is a task that is
; missing, has no program action, or cannot be read. The install directory reaches PowerShell
; through an environment variable, as in CHECK_LIGHTS_OUT_RUNNING, so no path is ever quoted into
; the command line.
!macro REMOVE_OWNED_SCHEDULED_TASK TASK_NAME
  Push $0
  Push $1
  System::Call 'kernel32::SetEnvironmentVariableW(w "LO_CHECK_DIR", w "$INSTDIR")'
  nsExec::ExecToStack `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -WindowStyle Hidden -Command "$$ErrorActionPreference = 'Stop'; try { $$t = @(Get-ScheduledTask -TaskPath '\' -TaskName '${TASK_NAME}' -ErrorAction SilentlyContinue); if ($$t.Count -ne 1) { exit 0 }; $$exe = [string](@($$t[0].Actions)[0].Execute); if (-not $$exe.Trim()) { exit 0 }; if ([IO.Path]::GetFullPath($$exe.Trim().Trim([char]34)) -ieq [IO.Path]::GetFullPath((Join-Path $$env:LO_CHECK_DIR 'Lights Out.exe'))) { Unregister-ScheduledTask -TaskPath '\' -TaskName '${TASK_NAME}' -Confirm:$$false; exit 20 }; exit 0 } catch { exit 1 }"`
  Pop $0
  Pop $1
  System::Call 'kernel32::SetEnvironmentVariableW(w "LO_CHECK_DIR", i 0)'
  ${If} $0 == 20
    DetailPrint "Removed this install's ${TASK_NAME} scheduled task."
  ${ElseIf} $0 != 0
    ; Fail safe (task left in place), but never silently.
    DetailPrint "Could not check the ${TASK_NAME} scheduled task ($0); it was left in place."
  ${EndIf}
  Pop $1
  Pop $0
!macroend

!macro CHECK_LIGHTS_OUT_RUNNING TARGET_DIR ACTION_LABEL
  Push $0
  Push $1
  System::Call 'kernel32::SetEnvironmentVariableW(w "LO_CHECK_DIR", w "${TARGET_DIR}")'
  nsExec::ExecToStack `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -WindowStyle Hidden -Command "$$dir = [IO.Path]::GetFullPath($$env:LO_CHECK_DIR).TrimEnd([char]92); $$hits = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $$_.Name -ieq 'Lights Out.exe' -and $$_.ExecutablePath -and ([IO.Path]::GetFullPath((Split-Path -Parent $$_.ExecutablePath)).TrimEnd([char]92) -ieq $$dir) }); if ($$hits.Count -gt 0) { exit 10 }"`
  Pop $0
  Pop $1
  System::Call 'kernel32::SetEnvironmentVariableW(w "LO_CHECK_DIR", i 0)'
  ${If} $0 == 10
    IfSilent +2 0
      MessageBox MB_OK|MB_ICONSTOP "Lights Out is currently running in:$\r$\n${TARGET_DIR}$\r$\n$\r$\nPlease quit Lights Out before continuing with ${ACTION_LABEL}."
    Pop $1
    Pop $0
    SetErrorLevel 2
    Abort
  ${EndIf}
  Pop $1
  Pop $0
!macroend

Function .onInit
  ReadEnvStr $QaMode "LIGHTS_OUT_INSTALLER_QA"
FunctionEnd

Function .onVerifyInstDir
  Push $0
  Push $1
  StrCpy $0 "$INSTDIR"
  Call IsUnsafeInstDir
  ${If} $1 == 1
    Pop $1
    Pop $0
    Abort
  ${EndIf}
  Pop $1
  Pop $0
FunctionEnd

Function un.onInit
  ReadEnvStr $QaMode "LIGHTS_OUT_INSTALLER_QA"
  !insertmacro CHECK_LIGHTS_OUT_RUNNING "$INSTDIR" "uninstall"
FunctionEnd

Section "Lights Out (required)" SecApp
  SectionIn RO

  ; Enforce install-directory guard in silent mode as well (.onVerifyInstDir is interactive-only).
  Push $0
  Push $1
  StrCpy $0 "$INSTDIR"
  Call IsUnsafeInstDir
  ${If} $1 == 1
    Pop $1
    Pop $0
    IfSilent +2 0
      MessageBox MB_OK|MB_ICONSTOP "Cannot install Lights Out directly into a drive root, Windows system folder, or user profile root. Choose a dedicated subfolder such as $\"$LOCALAPPDATA\Programs\Lights Out$\"."
    SetErrorLevel 2
    Abort
  ${EndIf}
  Pop $1
  Pop $0

  ; Refuse to overwrite an active Lights Out instance running from $INSTDIR.
  !insertmacro CHECK_LIGHTS_OUT_RUNNING "$INSTDIR" "installation"

  ; Upgrade over an earlier Lights Out build. The manifest-only uninstaller removes only the files
  ; of the build that wrote it, so files an earlier build shipped and this one does not (v11.2.0's
  ; sharp/libvips modules, for example) would be orphaned. When $INSTDIR verifiably holds an
  ; earlier Lights Out install, clear its app-owned runtime subtrees first. This runs only after
  ; the IsUnsafeInstDir and running-instance guards above and the in-use probe below, never
  ; touches $INSTDIR itself or
  ; other files in it, and never touches user data (settings, receipts and logs live in
  ; %APPDATA%, not in $INSTDIR).
  ${If} ${FileExists} "$INSTDIR\Uninstall.exe"
  ${AndIf} ${FileExists} "$INSTDIR\Lights Out.exe"
  ${AndIf} ${FileExists} "$INSTDIR\resources\app\package.json"
    ; CHECK_LIGHTS_OUT_RUNNING fails open when PowerShell cannot start or its process query
    ; errors, so prove the app is not running before deleting anything: Windows refuses write
    ; access to the image of a running executable. This probe does not depend on PowerShell,
    ; and when it fails nothing has been removed yet.
    Push $3
    ClearErrors
    FileOpen $3 "$INSTDIR\Lights Out.exe" a
    ${If} ${Errors}
      Pop $3
      IfSilent +2 0
        MessageBox MB_OK|MB_ICONSTOP "Lights Out.exe in:$\r$\n$INSTDIR$\r$\nis in use and cannot be replaced.$\r$\n$\r$\nPlease quit Lights Out before continuing with installation."
      SetErrorLevel 2
      Abort
    ${EndIf}
    FileClose $3
    Pop $3
    DetailPrint "Removing the previous Lights Out runtime files before upgrading."
    Push $0
    StrCpy $0 "$INSTDIR\resources"
    Call RemoveAppOwnedSubtree
    StrCpy $0 "$INSTDIR\locales"
    Call RemoveAppOwnedSubtree
    Pop $0
  ${EndIf}

  SetOutPath "$INSTDIR"
  File /r "${APP_DIR}\*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ${If} $QaMode != "1"
    CreateDirectory "$SMPROGRAMS\Lights Out"
    CreateShortcut "$SMPROGRAMS\Lights Out\Lights Out.lnk" "$INSTDIR\Lights Out.exe"
    CreateShortcut "$SMPROGRAMS\Lights Out\Uninstall.lnk" "$INSTDIR\Uninstall.exe"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LightsOut" "DisplayName" "Lights Out"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LightsOut" "DisplayVersion" "${VERSION}"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LightsOut" "Publisher" "The Proof Foundry"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LightsOut" "InstallLocation" "$INSTDIR"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LightsOut" "DisplayIcon" "$INSTDIR\Lights Out.exe"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LightsOut" "UninstallString" '"$INSTDIR\Uninstall.exe"'
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LightsOut" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
    WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LightsOut" "EstimatedSize" ${ESTIMATED_SIZE_KB}
    WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LightsOut" "NoModify" 1
    WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LightsOut" "NoRepair" 1
  ${EndIf}
SectionEnd

Section "Desktop Shortcut" SecDesktop
  ${If} $QaMode != "1"
    CreateShortcut "$DESKTOP\Lights Out.lnk" "$INSTDIR\Lights Out.exe"
  ${EndIf}
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecApp} "Core Lights Out desktop application and uninstaller."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} "Create a Lights Out shortcut on your Desktop."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

Section "Uninstall"
  ; Remove only the exact files and directories packaged by Lights Out (never RMDir /r "$INSTDIR").
  !include "${UNINSTALL_MANIFEST}"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"

  ; Do not orphan an installed app by removing its Add/Remove Programs entry if the main binary stayed locked.
  ${If} ${FileExists} "$INSTDIR\Lights Out.exe"
    IfSilent +2 0
      MessageBox MB_OK|MB_ICONSTOP "Lights Out could not be completely removed because Lights Out.exe is still in use."
    SetErrorLevel 3
    Abort
  ${EndIf}

  ${If} $QaMode != "1"
    Delete "$DESKTOP\Lights Out.lnk"
    Delete "$SMPROGRAMS\Lights Out\Lights Out.lnk"
    Delete "$SMPROGRAMS\Lights Out\Uninstall.lnk"
    RMDir "$SMPROGRAMS\Lights Out"
    ; Clean up per-user login items and scheduled watchdog/alarm tasks. The Run value Electron
    ; actually writes, plus the package.json-name form, each only when it launches this install.
    !insertmacro REMOVE_OWNED_LOGIN_ITEM "${ELECTRON_LOGIN_ITEM_NAME}"
    !insertmacro REMOVE_OWNED_LOGIN_ITEM "${ELECTRON_APP_NAME_LOGIN_ITEM_NAME}"
    ; Legacy Lights Out value names (no Electron build writes these), removed unconditionally.
    DeleteRegValue HKCU "${LO_RUN_KEY}" "Lights Out"
    DeleteRegValue HKCU "${LO_RUN_KEY}" "LightsOut"
    DeleteRegValue HKCU "${LO_STARTUP_APPROVED_RUN_KEY}" "Lights Out"
    DeleteRegValue HKCU "${LO_STARTUP_APPROVED_RUN_KEY}" "LightsOut"
    ; The autopilot watchdog (watchdog.js) and First Light wake alarm (alarm.js) tasks, each only
    ; when it launches this install, so another Lights Out copy keeps its own.
    !insertmacro REMOVE_OWNED_SCHEDULED_TASK "${LO_WATCHDOG_TASK_NAME}"
    !insertmacro REMOVE_OWNED_SCHEDULED_TASK "${LO_FIRST_LIGHT_TASK_NAME}"
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LightsOut"
  ${EndIf}
SectionEnd
