# Lanza una ejecucion del agente y guarda el log en agent\logs.
# Lo usa el Programador de tareas: run-agent.ps1 -Slot P0 (08:30) / S0 (09:30) / S1 (16:30) / S2 (21:00) / CLOSE (22:30)
param([Parameter(Mandatory = $true)][ValidateSet("P0", "S0", "S1", "S2", "CLOSE")][string]$Slot)

# El cierre solo tiene sentido despues del cierre de EE. UU. y antes de que abra Europa: si Windows
# lo lanza tarde (PC dormido) a media manana, no se hace nada.
$hour = (Get-Date).Hour
if ($Slot -eq "CLOSE" -and $hour -lt 22 -and $hour -ge 9) { exit 0 }

# Si Windows desperto el PC para esta tarea, lo volveria a suspender a los ~2 minutos.
# Pedimos que no se suspenda mientras dure la ejecucion (como hacen los reproductores de video).
Add-Type -Namespace Win32 -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'
$ES_CONTINUOUS = [uint32]"0x80000000"
$ES_SYSTEM_REQUIRED = [uint32]"0x00000001"
[void][Win32.Power]::SetThreadExecutionState($ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED)

try {
  # Al despertar de la suspension el Wi-Fi tarda unos segundos en conectarse: esperamos (max. 2 min)
  # a tener internet antes de empezar. Si no llega, el agente fallara sin reservar la franja.
  for ($i = 0; $i -lt 24; $i++) {
    try { [void][System.Net.Dns]::GetHostAddresses("query1.finance.yahoo.com"); break } catch { Start-Sleep -Seconds 5 }
  }
  $repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
  Set-Location $repo
  New-Item -ItemType Directory -Force -Path "agent\logs" | Out-Null
  $log = Join-Path $repo ("agent\logs\{0}_{1}.log" -f (Get-Date -Format "yyyy-MM-dd"), $Slot)
  if ($Slot -eq "CLOSE") {
    cmd.exe /c "npm run close-day >> `"$log`" 2>&1"
    # Los viernes (o el sabado de madrugada si el cierre se lanzo tarde), la academia revisa la semana.
    $dow = (Get-Date).DayOfWeek
    if ($dow -eq "Friday" -or ($dow -eq "Saturday" -and $hour -lt 9)) {
      $day = if ($dow -eq "Saturday") { (Get-Date).AddDays(-1).ToString("yyyy-MM-dd") } else { (Get-Date).ToString("yyyy-MM-dd") }
      cmd.exe /c "npm run academy -- --day $day >> `"$log`" 2>&1"
    }
  }
  else { cmd.exe /c "npm run run-agent -- --slot $Slot >> `"$log`" 2>&1" }
  $code = $LASTEXITCODE
}
finally {
  [void][Win32.Power]::SetThreadExecutionState($ES_CONTINUOUS)
}
exit $code
