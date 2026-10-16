# 把 Desk Clock 設成「登入後延遲 N 秒自動啟動」(工作排程器,不需系統管理員)
# 安裝:  powershell -ExecutionPolicy Bypass -File install-startup.ps1
# 移除:  powershell -ExecutionPolicy Bypass -File install-startup.ps1 -Remove
param([switch]$Remove, [int]$DelaySeconds = 20)

$name = 'Desk Clock 登入啟動'
if ($Remove) {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "已移除排程:$name"
  return
}
$script = Join-Path $PSScriptRoot 'desk-clock.ps1'
$u = "$env:USERDOMAIN\$env:USERNAME"
$a = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`"" -WorkingDirectory $PSScriptRoot
$t = New-ScheduledTaskTrigger -AtLogOn -User $u
$t.Delay = "PT${DelaySeconds}S"
$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
$p = New-ScheduledTaskPrincipal -UserId $u -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $name -Action $a -Trigger $t -Settings $s -Principal $p -Description "登入後延遲 $DelaySeconds 秒啟動 Desk Clock" -Force | Select-Object TaskName, State
