# Must run as Administrator
#Requires -RunAsAdministrator

$ErrorActionPreference = "SilentlyContinue"

$ServiceName = "LaTeXDaemon"
$InstallDir = "$env:ProgramFiles\LaTeX Worker"

Stop-Service -Name $ServiceName -Force
# Remove-Service requires PowerShell 6+; fall back to sc.exe for older systems
if (Get-Command Remove-Service -ErrorAction SilentlyContinue) {
    Remove-Service -Name $ServiceName
} else {
    sc.exe delete $ServiceName | Out-Null
}
Remove-Item -Recurse -Force $InstallDir
Write-Host "latex-daemon removed"
