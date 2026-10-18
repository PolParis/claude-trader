# Lanza una ejecucion del agente y guarda el log en agent\logs.
# Lo usa el Programador de tareas: run-agent.ps1 -Slot S1  (16:30)  /  -Slot S2  (21:00)
param([Parameter(Mandatory = $true)][ValidateSet("S1", "S2")][string]$Slot)

$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repo
New-Item -ItemType Directory -Force -Path "agent\logs" | Out-Null
$log = Join-Path $repo ("agent\logs\{0}_{1}.log" -f (Get-Date -Format "yyyy-MM-dd"), $Slot)
cmd.exe /c "npm run run-agent -- --slot $Slot >> `"$log`" 2>&1"
exit $LASTEXITCODE
