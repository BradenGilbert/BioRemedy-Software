# Registers the Windows startup tasks that bring the CRM back after a reboot (2026-10-01).
# Run once from an elevated PowerShell (Run as administrator) in the project folder:
#   powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1
#
#   "BioRemedy CRM live server"  at startup: node server.mjs (port 4173), restarted if it crashes
#   "BioRemedy CRM tunnel"       at startup (+45 s): node scripts\live-tunnel.mjs, which keeps the
#                                 quick tunnel up and registers it with the workers.dev Worker
#   "BioRemedy training reset"   (existing nightly task) also gets an at-startup trigger
#
# Both run as the current user whether or not anyone is signed in (S4U: no password stored).
# Logs: data\live-server.log, data\live-tunnel.log. Remove with scripts\install-autostart.ps1 -Remove.
param([switch]$Remove)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$node = "C:\Users\Braden\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$user = "$env:USERDOMAIN\$env:USERNAME"
$names = @("BioRemedy CRM live server", "BioRemedy CRM tunnel")

if ($Remove) {
  foreach ($name in $names) { Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue }
  Write-Host "Removed the CRM startup tasks."
  return
}
if (-not (Test-Path $node)) { throw "Node not found at $node" }

$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType S4U -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew

$serverAction = New-ScheduledTaskAction -Execute "cmd.exe" -WorkingDirectory $root `
  -Argument "/c `"`"$node`" server.mjs >> data\live-server.log 2>&1`""
$serverTrigger = New-ScheduledTaskTrigger -AtStartup
Register-ScheduledTask -TaskName $names[0] -Action $serverAction -Trigger $serverTrigger -Principal $principal -Settings $settings `
  -Description "BioRemedy CRM live server (port 4173). Installed by scripts\install-autostart.ps1." -Force | Out-Null

$tunnelAction = New-ScheduledTaskAction -Execute "cmd.exe" -WorkingDirectory $root `
  -Argument "/c `"`"$node`" scripts\live-tunnel.mjs`""
$tunnelTrigger = New-ScheduledTaskTrigger -AtStartup
$tunnelTrigger.Delay = "PT45S"
Register-ScheduledTask -TaskName $names[1] -Action $tunnelAction -Trigger $tunnelTrigger -Principal $principal -Settings $settings `
  -Description "Keeps the CRM's workers.dev address pointed at this PC. Installed by scripts\install-autostart.ps1." -Force | Out-Null

$training = Get-ScheduledTask -TaskName "BioRemedy training reset" -ErrorAction SilentlyContinue
if ($training) {
  $hasStartup = $training.Triggers | Where-Object { $_.CimClass.CimClassName -eq "MSFT_TaskBootTrigger" }
  if (-not $hasStartup) {
    $boot = New-ScheduledTaskTrigger -AtStartup
    $boot.Delay = "PT2M"
    Set-ScheduledTask -TaskName "BioRemedy training reset" -Trigger (@($training.Triggers) + $boot) | Out-Null
    Write-Host "Training reset now also runs 2 minutes after startup."
  }
}

Write-Host "Registered: $($names -join ', '). They start at the next boot; run 'Start-ScheduledTask -TaskName `"BioRemedy CRM tunnel`"' to start the tunnel now."
