[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$AppRoot,
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$AppRoot = [IO.Path]::GetFullPath($AppRoot)
$RuntimeRoot = Join-Path (Split-Path $AppRoot -Parent) "runtime"
$LogRoot = Join-Path $RuntimeRoot "logs"
$PidFile = Join-Path $RuntimeRoot "requirement-platform.pid"
$Node = (Get-Command node -ErrorAction Stop).Source

New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null
if (Test-Path -LiteralPath $PidFile) {
  $oldPid = (Get-Content -LiteralPath $PidFile -Raw).Trim()
  if ($oldPid -match '^\d+$') {
    $oldProcess = Get-Process -Id ([int]$oldPid) -ErrorAction SilentlyContinue
    if ($oldProcess) { Stop-Process -Id $oldProcess.Id -Force }
  }
  Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
}

$arguments = @(".\node_modules\next\dist\bin\next", "start", "--hostname", "127.0.0.1", "--port", "$Port")
$process = Start-Process -FilePath $Node -ArgumentList $arguments -WorkingDirectory $AppRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $LogRoot "requirement-platform.out.log") -RedirectStandardError (Join-Path $LogRoot "requirement-platform.err.log") -PassThru
Set-Content -LiteralPath $PidFile -Value $process.Id -NoNewline

Start-Sleep -Seconds 2
$started = $false
for ($attempt = 1; $attempt -le 8; $attempt += 1) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/" -TimeoutSec 3
    if ($response.StatusCode -eq 200) { $started = $true; break }
  } catch {}
  Start-Sleep -Seconds 1
}
if (-not $started) {
  Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
  throw "新版本启动失败，未能通过本机 HTTP 健康检查。"
}

Write-Output "Requirement platform restarted: PID=$($process.Id), Port=$Port"
