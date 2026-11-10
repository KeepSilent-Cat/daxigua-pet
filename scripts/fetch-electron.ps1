# 下载 Electron 运行时（只需跑一次）
#   用法:  .\scripts\fetch-electron.ps1
#          .\scripts\fetch-electron.ps1 -Force     # 已存在也重下
param(
    [switch]$Force
)
$ErrorActionPreference = 'Stop'

$root      = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$runtime   = Join-Path $root 'runtime'
$version   = '45.2.3'
$zipName   = "electron-v$version-win32-x64.zip"

if ((Test-Path (Join-Path $runtime 'electron.exe')) -and -not $Force) {
    Write-Host "已经装好了: $runtime\electron.exe" -ForegroundColor Green
    Write-Host "要重新下载加 -Force"
    return
}

# 国内优先 npmmirror，失败再走 GitHub
$urls = @(
    "https://registry.npmmirror.com/-/binary/electron/$version/$zipName",
    "https://npmmirror.com/mirrors/electron/$version/$zipName",
    "https://github.com/electron/electron/releases/download/v$version/$zipName"
)

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) $zipName
$ok = $false

foreach ($u in $urls) {
    Write-Host "尝试下载: $u"
    try {
        if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
            & curl.exe -L --fail --retry 2 --connect-timeout 15 -o $tmp $u
            if ($LASTEXITCODE -eq 0 -and (Test-Path $tmp) -and (Get-Item $tmp).Length -gt 50MB) { $ok = $true }
        } else {
            Invoke-WebRequest -Uri $u -OutFile $tmp -UseBasicParsing -TimeoutSec 300
            if ((Get-Item $tmp -ErrorAction SilentlyContinue).Length -gt 50MB) { $ok = $true }
        }
    } catch {
        Write-Host "  失败: $($_.Exception.Message)" -ForegroundColor Yellow
    }
    if ($ok) { break }
}

if (-not $ok) {
    throw "下载失败。请手动下载 $zipName 解压到 $runtime 目录。"
}

Write-Host "解压到 $runtime ..."
New-Item -ItemType Directory -Force -Path $runtime | Out-Null
Expand-Archive -Path $tmp -DestinationPath $runtime -Force
Remove-Item $tmp -Force -ErrorAction SilentlyContinue

if (-not (Test-Path (Join-Path $runtime 'electron.exe'))) {
    # zip 里可能带一层目录，拍平
    $inner = Get-ChildItem $runtime -Directory | Select-Object -First 1
    if ($inner -and (Test-Path (Join-Path $inner.FullName 'electron.exe'))) {
        Get-ChildItem $inner.FullName | Move-Item -Destination $runtime -Force
        Remove-Item $inner.FullName -Recurse -Force
    }
}

Write-Host "完成: $(Join-Path $runtime 'electron.exe')" -ForegroundColor Green
Write-Host "接下来运行:  .\scripts\start.ps1"
