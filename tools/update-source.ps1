$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if (!(Test-Path .git) -or !(Get-Command git.exe -ErrorAction SilentlyContinue)) {
    Write-Host 'Sem clone Git: atualize baixando o ZIP novamente (veja TUTORIAL.md).'
    exit 0
}
$env:GIT_TERMINAL_PROMPT = '0'
$changes = & git status --porcelain
if ($LASTEXITCODE -ne 0) { exit 1 }
if ($changes) {
    Write-Host 'Alteracoes locais encontradas. Atualizacao automatica ignorada para preservar seu trabalho.'
    exit 0
}
$branch = & git branch --show-current
$upstream = if ($branch) { & git for-each-ref '--format=%(upstream:short)' "refs/heads/$branch" } else { $null }
if ($LASTEXITCODE -ne 0 -or !$upstream) {
    Write-Host 'Branch sem acompanhamento. Configure o upstream do seu fork para atualizar pelo Git.'
    exit 0
}
Write-Host "Atualizando pelo acompanhamento do branch: $upstream"
& git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=5 pull --ff-only --no-rebase
exit $LASTEXITCODE
