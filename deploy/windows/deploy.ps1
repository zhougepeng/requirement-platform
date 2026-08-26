[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$DeployRoot,
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$ExpectedRemotes = @(
  "https://github.com/zhougepeng/requirement-platform.git",
  "git@github.com:zhougepeng/requirement-platform.git"
)
$DeployRoot = [IO.Path]::GetFullPath($DeployRoot)

function Invoke-Git([string[]]$Arguments) {
  & git -C $DeployRoot @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Git 命令执行失败：git $($Arguments -join ' ')" }
}

if (-not (Test-Path -LiteralPath (Join-Path $DeployRoot ".git"))) {
  throw "部署目录不是 Git 仓库：$DeployRoot"
}

$branch = (& git -C $DeployRoot branch --show-current).Trim()
$remote = (& git -C $DeployRoot remote get-url origin).Trim()
if ($branch -ne "main") { throw "部署目录必须在 main 分支，当前为：$branch" }
if ($ExpectedRemotes -notcontains $remote) { throw "部署目录 origin 不是需求库 GitHub 仓库，已拒绝部署。" }

Invoke-Git -Arguments @("fetch", "--quiet", "origin", "main")
$changes = (& git -C $DeployRoot status --porcelain)
if ($changes) { throw "部署目录存在未提交修改，已停止部署以保护本地配置。" }
Invoke-Git -Arguments @("pull", "--ff-only", "origin", "main")

Push-Location $DeployRoot
try {
  & npm ci
  if ($LASTEXITCODE -ne 0) { throw "npm ci 失败。" }
  & npm run build
  if ($LASTEXITCODE -ne 0) { throw "npm run build 失败，旧服务保持运行。" }
} finally {
  Pop-Location
}

& (Join-Path $PSScriptRoot "restart-platform.ps1") -AppRoot $DeployRoot -Port $Port
