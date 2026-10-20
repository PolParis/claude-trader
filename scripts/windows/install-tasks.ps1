# Crea (o recrea) las 3 tareas programadas: lunes a viernes 16:30 y 21:00 (Claude) y 22:30 (cierre diario, sin Claude).
# - Se ejecutan con tu usuario cuando has iniciado sesion (claude usa tu suscripcion).
# - WakeToRun: despierta el PC si esta en suspension.
# - StartWhenAvailable: si el PC estaba apagado, se lanza al encenderlo (si la franja
#   ya se cerro, el script lo detecta y no hace nada).
$script = Join-Path $PSScriptRoot "run-agent.ps1"
$days = @("Monday", "Tuesday", "Wednesday", "Thursday", "Friday")
$settings = New-ScheduledTaskSettingsSet -WakeToRun -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew
foreach ($t in @(@{ Slot = "S1"; Time = "16:30" }, @{ Slot = "S2"; Time = "21:00" }, @{ Slot = "CLOSE"; Time = "22:30" })) {
  $name = "ClaudeTrader-" + $t.Slot
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ("-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"{0}`" -Slot {1}" -f $script, $t.Slot)
  $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $days -At $t.Time
  Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Description "Claude vs. el Mercado: ejecucion $($t.Slot)" -Force | Out-Null
  Write-Host "Tarea $name creada para las $($t.Time) (L-V)."
}
Get-ScheduledTask -TaskName "ClaudeTrader-*" | Get-ScheduledTaskInfo | Select-Object TaskName, NextRunTime | Format-Table -AutoSize
