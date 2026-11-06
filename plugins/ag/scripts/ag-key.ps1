<#
  ag-key.ps1 - set, check or find an ag API key, from any folder.
    ag-key.ps1 set|check|where <fireworks|gemini|openai> [-ClaudeHome <dir>]
  scripts/install.ps1 copies this file to ~/.claude/ag/ag-key.ps1 and fills in the checkout path.
  It runs the scripts of the newest installed ag
  (<ClaudeHome>/plugins/cache/agents-plugin/ag/<version>/scripts/), else the checkout's.
    set <p>         -> ext-build.ps1 -SetKey fireworks | design-image.ps1 -SetKey <p>
    check fireworks -> ext-build.ps1 -Check
    check <p>       -> design-image.ps1 -Check <p>
    where <p>       -> ext-build.ps1 -Where fireworks | design-image.ps1 -Where <p>
  The same PowerShell that runs this file runs the script; its exit code is passed through.
  Usage errors exit 2. The key is never printed. Dot-sourcing only defines the functions.
  Windows PowerShell 5.1 and PowerShell 7 compatible.
#>
param(
    [Parameter(Position = 0)]
    [string]$Action,
    [Parameter(Position = 1)]
    [string]$Provider,
    [string]$ClaudeHome = (Join-Path $HOME '.claude')
)

$ErrorActionPreference = 'Stop'

# install.ps1 replaces the token with the checkout path.
$script:AgCheckout = '__AG_CHECKOUT__'

# The scripts folder: the newest installed version, else the checkout baked in at install time.
function Resolve-AgKeyScripts([string]$ClaudeDir, [string]$Checkout) {
    $cache = Join-Path $ClaudeDir 'plugins/cache/agents-plugin/ag'
    if (Test-Path -LiteralPath $cache -PathType Container) {
        $best = $null; $bestVer = $null
        foreach ($d in (Get-ChildItem -LiteralPath $cache -Directory)) {
            $v = $null
            if (-not [version]::TryParse($d.Name, [ref]$v)) { continue }
            $s = Join-Path $d.FullName 'scripts'
            if (-not (Test-Path -LiteralPath $s -PathType Container)) { continue }
            if ($null -eq $bestVer -or $v -gt $bestVer) { $best = $s; $bestVer = $v }
        }
        if ($best) { return $best }
    }
    if ($Checkout -and $Checkout -ne ('__AG_' + 'CHECKOUT__')) {
        $s = Join-Path $Checkout 'plugins/ag/scripts'
        if (Test-Path -LiteralPath $s -PathType Container) { return $s }
    }
    return $null
}

# Script name and arguments for one action and provider.
function Get-AgKeyCommand([string]$Act, [string]$Prov) {
    $file = if ($Prov -eq 'fireworks') { 'ext-build.ps1' } else { 'design-image.ps1' }
    switch ($Act) {
        'set' { return @($file, '-SetKey', $Prov) }
        'check' { if ($Prov -eq 'fireworks') { return @($file, '-Check') } else { return @($file, '-Check', $Prov) } }
        'where' { return @($file, '-Where', $Prov) }
    }
}

# The PowerShell command line to run, or a message when the arguments or scripts are wrong.
function Get-AgKeyRun([string]$Act, [string]$Prov, [string]$ClaudeDir, [string]$Checkout) {
    $usage = 'usage: ag-key.ps1 set|check|where <fireworks|gemini|openai>'
    $a = ([string]$Act).Trim().ToLowerInvariant()
    $p = ([string]$Prov).Trim().ToLowerInvariant()
    if (@('set', 'check', 'where') -notcontains $a -or @('fireworks', 'gemini', 'openai') -notcontains $p) {
        return [pscustomobject]@{ Error = "ag-key: $usage"; Exe = ''; ArgList = @() }
    }
    $dir = Resolve-AgKeyScripts $ClaudeDir $Checkout
    if (-not $dir) { return [pscustomobject]@{ Error = 'ag-key: no ag scripts found; install the ag plugin or run scripts/install.ps1 again'; Exe = ''; ArgList = @() } }
    $cmd = Get-AgKeyCommand $a $p
    $target = Join-Path $dir $cmd[0]
    if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { return [pscustomobject]@{ Error = "ag-key: not found: $target"; Exe = ''; ArgList = @() } }
    # The same PowerShell that runs this file: powershell on 5.1, pwsh on 7.
    $exe = [Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
    $argList = @('-NoProfile')
    if ($env:OS -eq 'Windows_NT') { $argList += @('-ExecutionPolicy', 'Bypass') }
    $argList += @('-File', $target) + @($cmd[1..($cmd.Count - 1)])
    return [pscustomobject]@{ Error = ''; Exe = $exe; ArgList = $argList }
}

if ($MyInvocation.InvocationName -ne '.') {
    $run = Get-AgKeyRun $Action $Provider $ClaudeHome $script:AgCheckout
    if ($run.Error) { Write-Output $run.Error; exit 2 }
    # Not piped, so the child keeps the console (the hidden key prompt of set works).
    & $run.Exe @($run.ArgList)
    exit $LASTEXITCODE
}
