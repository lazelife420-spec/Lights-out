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
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  ReadEnvStr $QaMode "LIGHTS_OUT_INSTALLER_QA"
FunctionEnd
Function un.onInit
  ReadEnvStr $QaMode "LIGHTS_OUT_INSTALLER_QA"
FunctionEnd

Section "Lights Out"
  SetOutPath "$INSTDIR"
  File /r "${APP_DIR}\*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  ${If} $QaMode != "1"
    CreateDirectory "$SMPROGRAMS\Lights Out"
    CreateShortcut "$SMPROGRAMS\Lights Out\Lights Out.lnk" "$INSTDIR\Lights Out.exe"
    CreateShortcut "$SMPROGRAMS\Lights Out\Uninstall.lnk" "$INSTDIR\Uninstall.exe"
    CreateShortcut "$DESKTOP\Lights Out.lnk" "$INSTDIR\Lights Out.exe"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LightsOut" "DisplayName" "Lights Out"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LightsOut" "DisplayVersion" "${VERSION}"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LightsOut" "Publisher" "The Proof Foundry"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LightsOut" "DisplayIcon" "$INSTDIR\Lights Out.exe"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LightsOut" "UninstallString" '"$INSTDIR\Uninstall.exe"'
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LightsOut" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
    WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LightsOut" "NoModify" 1
    WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LightsOut" "NoRepair" 1
  ${EndIf}
SectionEnd

Section "Uninstall"
  ${If} $QaMode != "1"
    Delete "$DESKTOP\Lights Out.lnk"
    Delete "$SMPROGRAMS\Lights Out\Lights Out.lnk"
    Delete "$SMPROGRAMS\Lights Out\Uninstall.lnk"
    RMDir "$SMPROGRAMS\Lights Out"
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LightsOut"
  ${EndIf}
  RMDir /r "$INSTDIR"
SectionEnd
