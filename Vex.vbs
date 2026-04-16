Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Claude code free\vex"
WshShell.Run "cmd /C npx electron .", 0, False
