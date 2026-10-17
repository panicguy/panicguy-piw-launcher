$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
New-Item -ItemType Directory -Force -Path (Join-Path $root '.runtime') | Out-Null
$log = Join-Path $root '.runtime\launcher.log'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'update-source.ps1') 2>&1 | ForEach-Object { $_.ToString() } | Out-File $log -Encoding utf8
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'start-rust.ps1') 2>&1 | ForEach-Object { $_.ToString() } | Out-File $log -Encoding utf8 -Append
if ($LASTEXITCODE -ne 0) {
    $shell = New-Object -ComObject WScript.Shell
    $null = $shell.Popup("Nao foi possivel abrir PIO Nailo. Consulte o log: $log", 0, 'PIO Nailo - falha ao iniciar', 16)
    exit 1
}
