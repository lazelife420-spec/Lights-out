; Dependency-minimal Inno Setup installer definition for Lights Out v11.1.2
; Per-user install, no admin required, no automatic launch, preserves user data.

#define MyAppName "Lights Out"
#define MyAppVersion "11.1.2"
#define MyAppPublisher "Lights Out"
#define MyAppURL "https://github.com/lazelife420-spec/Lights-out"
#define MyAppExeName "Lights Out.exe"
#define MyAppId "com.lightsout.sleep-timer"
#define SourceDir "..\\..\\dist-native\\win-unpacked"
#define OutputDir "..\\..\\dist-native"
#define IconPath "..\\assets\\icon.ico"

[Setup]
AppId={#MyAppId}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={localappdata}\Programs\{#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=Lights-Out-Setup-{#MyAppVersion}
SetupIconFile={#IconPath}
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
DisableFinishedPage=yes
DisableReadyPage=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
; No automatic launch during unattended validation.
