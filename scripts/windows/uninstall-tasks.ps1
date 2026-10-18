# Elimina las tareas programadas del agente.
Get-ScheduledTask -TaskName "ClaudeTrader-*" -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false
Write-Host "Tareas eliminadas."
