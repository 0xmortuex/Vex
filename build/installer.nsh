!macro customInstall
  ; The words Windows shows for Vex (Settings > Default apps) are in the language the installer runs in (electron-builder's installer is
  ; multi-language and picks the language of Windows): Turkish (1055) or, for any other, English. Decided when the installer runs, so
  ; no per-language table has to be filled for every language the installer carries.
  StrCpy $R8 "A browser built just for you"
  StrCpy $R9 "Vex HTML Document"
  ${If} $LANGUAGE == 1055
    StrCpy $R8 "Tam size göre yapılmış bir tarayıcı"
    StrCpy $R9 "Vex HTML Belgesi"
  ${EndIf}

  ; Register Vex as a browser in Windows

  ; File class for HTML documents
  WriteRegStr HKCU "Software\Classes\VexHTML" "" "$R9"
  WriteRegStr HKCU "Software\Classes\VexHTML\DefaultIcon" "" "$INSTDIR\Vex.exe,0"
  WriteRegStr HKCU "Software\Classes\VexHTML\shell\open\command" "" '"$INSTDIR\Vex.exe" "%1"'

  ; Application capabilities — required for Windows 10/11 default apps
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Vex" "" "Vex"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Vex\Capabilities" "ApplicationName" "Vex"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Vex\Capabilities" "ApplicationDescription" "$R8"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Vex\Capabilities" "ApplicationIcon" "$INSTDIR\Vex.exe,0"

  ; URL associations (http, https)
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Vex\Capabilities\URLAssociations" "http" "VexHTML"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Vex\Capabilities\URLAssociations" "https" "VexHTML"

  ; File associations (html, htm)
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Vex\Capabilities\FileAssociations" ".html" "VexHTML"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Vex\Capabilities\FileAssociations" ".htm" "VexHTML"

  ; Start menu registration
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Vex\Capabilities\StartMenu" "StartMenuInternet" "Vex"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Vex\DefaultIcon" "" "$INSTDIR\Vex.exe,0"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Vex\shell\open\command" "" '"$INSTDIR\Vex.exe"'

  ; Register Vex in RegisteredApplications so it appears in Windows Default Apps
  WriteRegStr HKCU "Software\RegisteredApplications" "Vex" "Software\Clients\StartMenuInternet\Vex\Capabilities"
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\VexHTML"
  DeleteRegKey HKCU "Software\Clients\StartMenuInternet\Vex"
  DeleteRegValue HKCU "Software\RegisteredApplications" "Vex"

  ; A note for the next install: someone uninstalled Vex themselves, so Vex offers its setup wizard again.
  ; An update runs this uninstaller silently and with --updated (src/main/updates.js INSTALLER_ARGS), and so does an installer
  ; replacing an older one, so only a visible uninstall (Settings > Apps, or the Start menu) writes it. It goes in the profile folder,
  ; which is kept (deleteAppDataOnUninstall is false); the app reads it once and removes it (setup:take-uninstall-marker).
  ${ifNot} ${isUpdated}
  ${ifNot} ${Silent}
    CreateDirectory "$APPDATA\vex"
    FileOpen $0 "$APPDATA\vex\vex-uninstalled.flag" w
    FileWrite $0 "uninstalled by hand"
    FileClose $0
  ${endIf}
  ${endIf}
!macroend
