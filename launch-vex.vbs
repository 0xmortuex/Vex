Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Claude code free\vex"
WshShell.Run "cmd /c npm start", 0, False
