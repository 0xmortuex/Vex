!macro customInstall
  ; Register Vex as a browser in Windows

  ; File class for HTML documents
  WriteRegStr HKCU "Software\Classes\VexHTML" "" "Vex HTML Document"
  WriteRegStr HKCU "Software\Classes\VexHTML\DefaultIcon" "" "$INSTDIR\Vex.exe,0"
  WriteRegStr HKCU "Software\Classes\VexHTML\shell\open\command" "" '"$INSTDIR\Vex.exe" "%1"'

  ; Application capabilities — required for Windows 10/11 default apps
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Vex" "" "Vex"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Vex\Capabilities" "ApplicationName" "Vex"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Vex\Capabilities" "ApplicationDescription" "A browser built just for you"
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
!macroend
