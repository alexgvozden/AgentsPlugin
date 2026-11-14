<#
  review-page-entry.ps1 - run review-page.ps1 from any folder or chat, by a path that never changes.
    powershell -NoProfile -ExecutionPolicy Bypass -File ~/.claude/ag/review-page.ps1 -Title <text> [<item> ...]
  scripts/install.ps1 copies this file to ~/.claude/ag/review-page.ps1 and fills in the checkout path.
  It runs review-page.ps1 of the newest installed ag that has it
  (~/.claude/plugins/cache/agents-plugin/ag/<version>/scripts/), else the checkout's, with the same
  arguments (see review-page.ps1 for them), in the same PowerShell; the exit code is passed through.
  No param block, so every argument reaches review-page.ps1 as given. Dot-sourcing only defines the function.
  Windows PowerShell 5.1 and PowerShell 7 compatible.
#>
$ErrorActionPreference = 'Stop'

# install.ps1 replaces the token with the checkout path.
$script:AgCheckout = '__AG_CHECKOUT__'

# review-page.ps1 of the newest installed version that has it, else the checkout's, else $null.
function Resolve-ReviewPage([string]$ClaudeDir, [string]$Checkout) {
    $cache = Join-Path $ClaudeDir 'plugins/cache/agents-plugin/ag'
    if (Test-Path -LiteralPath $cache -PathType Container) {
        $found = foreach ($d in (Get-ChildItem -LiteralPath $cache -Directory)) {
            $v = $null
            if (-not [version]::TryParse($d.Name, [ref]$v)) { continue }
            $f = Join-Path (Join-Path $d.FullName 'scripts') 'review-page.ps1'
            if (Test-Path -LiteralPath $f -PathType Leaf) { [pscustomobject]@{ Version = $v; File = $f } }
        }
        $best = @($found) | Where-Object { $_ } | Sort-Object Version -Descending | Select-Object -First 1
        if ($best) { return $best.File }
    }
    if ($Checkout -and $Checkout -ne ('__AG_' + 'CHECKOUT__')) {
        $f = Join-Path $Checkout 'plugins/ag/scripts/review-page.ps1'
        if (Test-Path -LiteralPath $f -PathType Leaf) { return $f }
    }
    return $null
}

if ($MyInvocation.InvocationName -ne '.') {
    $target = Resolve-ReviewPage (Join-Path $HOME '.claude') $script:AgCheckout
    if (-not $target) { Write-Output 'review-page: no ag scripts found; install the ag plugin or run scripts/install.ps1 again'; exit 2 }
    $exe = [Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
    $argList = @('-NoProfile')
    if ($env:OS -eq 'Windows_NT') { $argList += @('-ExecutionPolicy', 'Bypass') }
    $argList += @('-File', $target) + @($args)
    & $exe @argList
    exit $LASTEXITCODE
}
