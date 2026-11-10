# 用 Windows SAPI 把文本合成为 WAV（由 大夕瓜语音.exe 调用）
# 用法: pwsh -NoProfile -File say.ps1 -InTextFile req.txt -OutFile out.wav [-Voice "Microsoft Huihui Desktop"]
param(
    [Parameter(Mandatory = $true)][string]$InTextFile,
    [Parameter(Mandatory = $true)][string]$OutFile,
    [string]$Voice = ''
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech

$text = [System.IO.File]::ReadAllText($InTextFile, [System.Text.Encoding]::UTF8)
if ([string]::IsNullOrWhiteSpace($text)) { exit 2 }

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    if ($Voice) {
        try { $synth.SelectVoice($Voice) } catch { }
    }
    if (-not $synth.Voice) {
        try { $synth.SelectVoice('Microsoft Huihui Desktop') } catch { }
    }
    # 语速略慢一点，听着更稳
    $synth.Rate = 0
    $synth.Volume = 100
    $synth.SetOutputToWaveFile($OutFile)
    $synth.Speak($text)
    $synth.SetOutputToNull()
}
finally {
    $synth.Dispose()
}

if (-not (Test-Path $OutFile)) { exit 3 }
if ((Get-Item $OutFile).Length -le 44) { exit 4 }
exit 0
