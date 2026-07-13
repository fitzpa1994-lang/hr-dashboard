param(
  [string]$ProtocolName = 'sporton-outlook'
)

$ErrorActionPreference = 'Stop'

$scriptPath = Join-Path $PSScriptRoot 'open_outlook_recommendation_mail.ps1'
if (-not (Test-Path -LiteralPath $scriptPath)) {
  throw "Open helper not found: $scriptPath"
}

$resolvedScriptPath = (Resolve-Path -LiteralPath $scriptPath).Path
$powershellPath = Join-Path $PSHOME 'powershell.exe'
$baseKey = "HKCU:\Software\Classes\$ProtocolName"
$commandKey = Join-Path $baseKey 'shell\open\command'
$command = '"' + $powershellPath + '" -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $resolvedScriptPath + '" "%1"'

New-Item -Path $baseKey -Force | Out-Null
New-Item -Path $commandKey -Force | Out-Null

Set-Item -Path $baseKey -Value "URL:SPORTON Outlook Mail"
Set-ItemProperty -Path $baseKey -Name 'URL Protocol' -Value ''
Set-Item -Path $commandKey -Value $command

Write-Host "Registered ${ProtocolName}:// for current Windows user."
Write-Host "Command: $command"
