# 启动桌宠
#   用法:  .\scripts\start.ps1
#          .\scripts\start.ps1 -Stop      # 关掉正在跑的
param(
    [switch]$Stop
)
$ErrorActionPreference = 'Stop'

$root     = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$electron = Join-Path $root 'runtime\electron.exe'
$appDir   = Join-Path $root 'app'

if ($Stop) {
    Get-Process electron -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -like "$root*" } |
        Stop-Process -Force
    Write-Host '已关闭。'
    return
}

if (-not (Test-Path $electron)) {
    Write-Host "找不到运行时：$electron" -ForegroundColor Red
    Write-Host "先跑一次：  .\scripts\fetch-electron.ps1"
    exit 1
}
if (-not (Test-Path (Join-Path $appDir 'dist\main.js'))) {
    Write-Host "找不到应用：$appDir\dist\main.js" -ForegroundColor Red
    exit 1
}

Write-Host '启动中…（关掉这个窗口不会关闭桌宠，但父进程退出可能导致它一起退出，建议直接双击或保持窗口）'
& $electron $appDir
