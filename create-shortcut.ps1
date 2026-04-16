$WshShell = New-Object -ComObject WScript.Shell
$DesktopPath = [System.Environment]::GetFolderPath('Desktop')
$ShortcutPath = "$DesktopPath\Vex.lnk"
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)

# Point to the VBS launcher, not the batch file
$Shortcut.TargetPath = "wscript.exe"
$Shortcut.Arguments = "`"C:\Claude code free\vex\launch-vex.vbs`""
$Shortcut.WorkingDirectory = "C:\Claude code free\vex"

# Use the icon if it exists
$IconPath = "C:\Claude code free\vex\assets\icon.ico"
if (Test-Path $IconPath) {
    $Shortcut.IconLocation = $IconPath
}

$Shortcut.Description = "Vex Browser"
$Shortcut.Save()

# Also create in Start Menu
$StartMenuPath = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Vex.lnk"
$StartShortcut = $WshShell.CreateShortcut($StartMenuPath)
$StartShortcut.TargetPath = "wscript.exe"
$StartShortcut.Arguments = "`"C:\Claude code free\vex\launch-vex.vbs`""
$StartShortcut.WorkingDirectory = "C:\Claude code free\vex"
if (Test-Path $IconPath) {
    $StartShortcut.IconLocation = $IconPath
}
$StartShortcut.Description = "Vex Browser"
$StartShortcut.Save()

Write-Host ""
Write-Host "Done! Vex.lnk created on Desktop and Start Menu." -ForegroundColor Green
Write-Host ""
Write-Host "To pin to taskbar:" -ForegroundColor Cyan
Write-Host "  1. Right-click Vex on your desktop"
Write-Host "  2. Select 'Show more options' (Win 11) or right-click (Win 10)"
Write-Host "  3. Click 'Pin to taskbar'"
Write-Host ""
Write-Host "Or drag the desktop icon onto the taskbar." -ForegroundColor Cyan
