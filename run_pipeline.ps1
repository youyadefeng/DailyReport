$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function T([string]$hexValues) {
  return -join (($hexValues -split ' ') | ForEach-Object { [char][Convert]::ToInt32($_, 16) })
}

Set-Location -LiteralPath $PSScriptRoot

$stamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$logDir = Join-Path $PSScriptRoot "logs"
if (-not (Test-Path -LiteralPath $logDir)) {
  New-Item -ItemType Directory -Path $logDir | Out-Null
}

$logFile = Join-Path $logDir "pipeline_$stamp.log"
$nodePath = "C:\Program Files\nodejs\node.exe"

$titleText = T "0041 0049 0020 8D44 8BAF 7BA1 7EBF"
$workingDirText = T "5DE5 4F5C 76EE 5F55 003A 0020"
$logFileText = T "65E5 5FD7 6587 4EF6 003A 0020"
$startTimeText = T "5F00 59CB 65F6 95F4 003A 0020"
$runningText = T "6B63 5728 8FD0 884C 7BA1 7EBF 002E 002E 002E"
$successText = T "7BA1 7EBF 6267 884C 6210 529F"
$savedText = T "65E5 5FD7 5DF2 4FDD 5B58 5230 003A 0020"
$failedText = T "7BA1 7EBF 6267 884C 5931 8D25"
$checkLogText = T "8BF7 68C0 67E5 65E5 5FD7 003A 0020"
$endTimeText = T "7ED3 675F 65F6 95F4 003A 0020"
$pauseText = T "6309 4EFB 610F 952E 540E 56DE 8F66 7EE7 7EED"

$Host.UI.RawUI.WindowTitle = $titleText

Write-Host "========================================"
Write-Host $titleText
Write-Host "========================================"
Write-Host ""
Write-Host ($workingDirText + $PSScriptRoot)
Write-Host ($logFileText + $logFile)
Write-Host ($startTimeText + (Get-Date -Format "yyyy/MM/dd ddd HH:mm:ss.ff"))
Write-Host ""
Write-Host $runningText
Write-Host ""

try {
  & $nodePath "src/bootstrap.mjs" "--verbose" 2>&1 | Tee-Object -FilePath $logFile
  $exitCode = $LASTEXITCODE
} catch {
  $_ | Tee-Object -FilePath $logFile -Append | Out-Host
  $exitCode = 1
}

Write-Host ""
Write-Host "========================================"

if ($exitCode -eq 0) {
  Write-Host $successText
  Write-Host ($savedText + $logFile)
} else {
  Write-Host $failedText
  Write-Host ($checkLogText + $logFile)
}

Write-Host ($endTimeText + (Get-Date -Format "yyyy/MM/dd ddd HH:mm:ss.ff"))
Write-Host "========================================"
Write-Host ""
Read-Host $pauseText
exit $exitCode
