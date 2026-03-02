# Must run as Administrator
#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"

$InstallDir = "$env:ProgramFiles\LaTeX Worker"
$BinaryPath = "$InstallDir\latex-daemon.exe"
$ServiceName = "LaTeXDaemon"

if (-not (Test-Path ".\latex-daemon.exe")) {
    Write-Error "latex-daemon.exe not found. Run this script from the directory containing the binary."
    exit 1
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item ".\latex-daemon.exe" -Destination $BinaryPath -Force

New-Service -Name $ServiceName `
    -DisplayName "LaTeX Worker Daemon" `
    -Description "Local LaTeX compilation daemon for LaTeX Worker" `
    -BinaryPathName $BinaryPath `
    -StartupType Automatic

Start-Service -Name $ServiceName
Write-Host "latex-daemon installed and started on port 7878"
