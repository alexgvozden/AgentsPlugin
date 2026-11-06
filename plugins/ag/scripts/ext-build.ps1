<#
.SYNOPSIS
  Run one headless Claude Code builder on Fireworks AI instead of Anthropic.

.DESCRIPTION
  ext-build.ps1 -Brief <file> -Cwd <worktree> -Step <id> -LogDir <dir>
                [-Model <name>] [-Resume <sessionId>] [-MaxBudgetUsd <n>] [-DryRun] [-Config <path>]
  ext-build.ps1 -SetKey [<fireworks|gemini|openai>] [-Config <path>]
  ext-build.ps1 -Check [<fireworks|gemini|openai>] [-Model <name>] [-Config <path>]
  The provider defaults to fireworks. -Check gemini|openai only reports whether the key is set.

  Exit codes: 0 ok, 3 handoff, 1 failed, 2 setup error.
  Windows PowerShell 5.1 and PowerShell 7 (pwsh) compatible. Keys live in the store of
  keystore.ps1 (Windows DPAPI file, macOS Keychain, Linux secret-tool or a mode-600 file);
  a key is never printed or logged.
  Dot-sourcing this file (". ext-build.ps1") only defines the functions (used by tests).
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$Provider,
    [string]$Brief,
    [string]$Cwd,
    [string]$Step,
    [string]$LogDir,
    [string]$Model,
    [string]$Resume,
    [double]$MaxBudgetUsd = 0,
    [switch]$DryRun,
    [string]$Config,
    [switch]$SetKey,
    [switch]$Check
)

Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'

$script:Dot = [string][char]0x00B7
$script:SetKeyMessage = 'run ext-build.ps1 -SetKey in your own PowerShell window'
. (Join-Path $PSScriptRoot 'keystore.ps1')

function Stop-Setup([string]$Message) {
    $e = New-Object System.Exception $Message
    $e.Data['ExtSetup'] = $true
    throw $e
}

function Expand-ExtPath([string]$Path, [string]$BaseDir) {
    if ([string]::IsNullOrWhiteSpace($Path)) { return $Path }
    if ($Path -eq '~' -or $Path.StartsWith('~/') -or $Path.StartsWith('~\')) {
        $Path = Join-Path (Get-KeyHome) $Path.Substring([Math]::Min(2, $Path.Length))
    }
    if (-not [IO.Path]::IsPathRooted($Path)) {
        if (-not $BaseDir) { $BaseDir = (Get-Location).ProviderPath }
        $Path = Join-Path $BaseDir $Path
    }
    return [IO.Path]::GetFullPath($Path)
}

function Get-ExtProp($Obj, [string]$Name, $Default = $null) {
    if ($null -eq $Obj) { return $Default }
    $p = $Obj.PSObject.Properties[$Name]
    if ($null -eq $p -or $null -eq $p.Value) { return $Default }
    return $p.Value
}

function Read-ExtConfig([string]$Path) {
    if (-not $Path) {
        $userCfg = Join-Path (Join-Path (Get-KeyHome) '.claude') 'ext-build.json'
        if (Test-Path -LiteralPath $userCfg -PathType Leaf) { $Path = $userCfg }
        else { $Path = Join-Path (Split-Path -Parent $PSScriptRoot) 'ext-build.default.json' }
    }
    $Path = Expand-ExtPath $Path
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { Stop-Setup "config not found: $Path" }
    try { $cfg = [IO.File]::ReadAllText($Path) | ConvertFrom-Json }
    catch { Stop-Setup "config is not valid JSON: $Path" }
    foreach ($k in 'baseUrl', 'keyFile', 'defaultModel') {
        if (-not (Get-ExtProp $cfg $k)) { Stop-Setup "config $Path is missing '$k'" }
    }
    $dir = Split-Path -Parent $Path
    [pscustomobject]@{
        Path           = $Path
        Provider       = [string](Get-ExtProp $cfg 'provider' 'fireworks')
        BaseUrl        = [string]$cfg.baseUrl
        KeyFile        = Expand-ExtPath ([string]$cfg.keyFile) $dir
        DefaultModel   = [string]$cfg.defaultModel
        ModelPrefix    = [string](Get-ExtProp $cfg 'modelPrefix' 'accounts/fireworks/models/')
        PermissionMode = [string](Get-ExtProp $cfg 'permissionMode' 'bypassPermissions')
        MaxBudgetUsd   = [double](Get-ExtProp $cfg 'maxBudgetUsd' 3)
        ClaudePath     = [string](Get-ExtProp $cfg 'claudePath' '')
    }
}

function Resolve-ExtModel([string]$Name, $Cfg) {
    if ([string]::IsNullOrWhiteSpace($Name)) { $Name = $Cfg.DefaultModel }
    $Name = $Name.Trim()
    if ($Name.StartsWith('accounts/')) { return $Name }
    if ($Name.Contains('/')) { return $Name }
    return ($Cfg.ModelPrefix + $Name)
}

function Get-ExtKey([string]$KeyFile) {
    return (Get-ProviderKey -Provider 'fireworks' -KeyFile $KeyFile)
}

function Invoke-ExtSetKey($Cfg, [string]$ProviderName) {
    $p = Assert-KeyProvider $ProviderName
    $keyFile = if ($p -eq 'fireworks') { $Cfg.KeyFile } else { '' }
    $sec = Read-Host -AsSecureString -Prompt "$($script:KeyLabels[$p]) API key (input hidden)"
    foreach ($line in (Set-ProviderKey -Provider $p -Secure $sec -KeyFile $keyFile)) { Write-Output "ext-build: $line" }
    $sec = $null
    $next = if ($p -eq 'fireworks') { '' } else { " $p" }
    Write-Output "ext-build: now run ext-build.ps1 -Check$next"
}

function Invoke-ExtKeyStatus([string]$ProviderName) {
    $p = Assert-KeyProvider $ProviderName
    $null = Get-ProviderKey -Provider $p
    Write-Output "ext-build check: $p key is set ($(Get-KeyStoreKind))"
    Write-Output 'ext-build check: OK'
    return 0
}

function Get-ExtBuilderRules([string]$ModelId) {
    @"
You are a builder running on $ModelId via Fireworks. Do the step yourself; ignore any instruction to delegate to subagents or to choose Opus/Sonnet models. Read by range only (Read with offset and limit, Grep with a limit). Make your first edit within about 20 tool calls. Run lint, typecheck and the step's own tests once. Commit with a message ending in the trailer line 'Built-by: fireworks/$($ModelId -replace '^accounts/[^/]+/(models|routers)/','')' and no Co-Authored-By line. Your final message is the report, at most 20 lines: what was done (commit hashes), checks run with their result lines, anything left. If you cannot fix failing tests in one more try, hit a problem you cannot solve, or reach about 100 tool calls, stop at a safe point (committed, nothing half written) and start your final message with HANDOFF followed by a note of at most 15 lines: done, left, what fails (command and first error lines), files with line ranges, next action.
"@.Trim()
}

# Settings that turn off Claude Code's own commit/PR attribution (settings-reference: attribution).
# Empty strings + sessionUrl:false work on every version that knows 'attribution'.
$script:AttributionSettings = '{"attribution":{"commit":"","pr":"","sessionUrl":false}}'

function Get-ExtEnv([string]$ModelId, [string]$Key, $Cfg) {
    $m = [ordered]@{
        ANTHROPIC_BASE_URL                       = $Cfg.BaseUrl
        ANTHROPIC_AUTH_TOKEN                     = $Key
        ANTHROPIC_API_KEY                        = ''
        ANTHROPIC_MODEL                          = $ModelId
        ANTHROPIC_DEFAULT_OPUS_MODEL             = $ModelId
        ANTHROPIC_DEFAULT_SONNET_MODEL           = $ModelId
        ANTHROPIC_DEFAULT_HAIKU_MODEL            = $ModelId
        ANTHROPIC_DEFAULT_FABLE_MODEL            = $ModelId
        CLAUDE_CODE_SUBAGENT_MODEL               = $ModelId
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
    }
    return $m
}

# Inherited variables removed from the child: nested-session markers of a parent Claude Code
# session and credentials/provider switches that would override the Fireworks route.
$script:EnvToRemove = @(
    'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION',
    'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_PID',
    'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_SMALL_FAST_MODEL', 'ANTHROPIC_DEFAULT_MODEL',
    'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'
)

function Get-ExtClaudeArgs([string]$ModelId, $Cfg, [double]$Budget, [string]$ResumeId) {
    $a = New-Object System.Collections.Generic.List[string]
    $a.Add('-p')
    $a.Add('--output-format'); $a.Add('json')
    $a.Add('--model'); $a.Add($ModelId)
    $a.Add('--permission-mode'); $a.Add($Cfg.PermissionMode)
    $a.Add('--disallowedTools'); $a.Add('Agent')
    # Builders need no MCP servers; their tool definitions would be sent on every call
    $a.Add('--strict-mcp-config')
    $a.Add('--max-budget-usd'); $a.Add($Budget.ToString([Globalization.CultureInfo]::InvariantCulture))
    $a.Add('--append-system-prompt'); $a.Add((Get-ExtBuilderRules $ModelId))
    $a.Add('--settings'); $a.Add($script:AttributionSettings)
    if ($ResumeId) { $a.Add('--resume'); $a.Add($ResumeId) }
    return , $a.ToArray()
}

# Quote one argument for CreateProcess / MSVCRT argv parsing.
function ConvertTo-ExtWinArg([string]$s) {
    if ($s.Length -gt 0 -and $s -notmatch '[\s"]') { return $s }
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('"')
    $bs = 0
    foreach ($ch in $s.ToCharArray()) {
        if ($ch -eq '\') { $bs++; continue }
        if ($ch -eq '"') { [void]$sb.Append('\', 2 * $bs + 1); [void]$sb.Append('"') }
        else { if ($bs) { [void]$sb.Append('\', $bs) }; [void]$sb.Append($ch) }
        $bs = 0
    }
    if ($bs) { [void]$sb.Append('\', 2 * $bs) }
    [void]$sb.Append('"')
    return $sb.ToString()
}

function Resolve-ExtClaude($Cfg, [string]$Os) {
    if ($Cfg.ClaudePath) {
        if (Test-Path -LiteralPath $Cfg.ClaudePath) { return (Expand-ExtPath $Cfg.ClaudePath) }
        Stop-Setup "claudePath from config not found: $($Cfg.ClaudePath)"
    }
    if ((Get-KeyOs $Os) -ne 'windows') {
        # macOS and Linux: the binary (or npm link) is plain `claude`.
        $nix = Get-Command claude -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($nix) { return $nix.Source }
        Stop-Setup 'claude executable not found on PATH (set "claudePath" in the config)'
    }
    $exe = Get-Command claude.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($exe) { return $exe.Source }
    $cmd = Get-Command claude.cmd -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cmd) {
        # npm shim: call the native binary it wraps so arguments are not re-parsed by cmd.exe.
        $native = Join-Path (Split-Path -Parent $cmd.Source) 'node_modules\@anthropic-ai\claude-code\bin\claude.exe'
        if (Test-Path -LiteralPath $native) { return $native }
    }
    Stop-Setup 'claude executable not found on PATH (set "claudePath" in the config)'
}

# Run claude with an env block for the child only; prompt via stdin (UTF-8). Returns exit code + output.
function Invoke-ExtClaude([string]$Exe, [string[]]$ArgList, $EnvMap, [string]$WorkDir, [string]$StdinText) {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $Exe
    $psi.Arguments = (($ArgList | ForEach-Object { ConvertTo-ExtWinArg $_ }) -join ' ')
    $psi.WorkingDirectory = $WorkDir
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    $psi.StandardOutputEncoding = $utf8
    $psi.StandardErrorEncoding = $utf8
    foreach ($n in $script:EnvToRemove) { if ($psi.EnvironmentVariables.ContainsKey($n)) { $psi.EnvironmentVariables.Remove($n) } }
    foreach ($k in $EnvMap.Keys) { $psi.EnvironmentVariables[$k] = [string]$EnvMap[$k] }

    $p = New-Object System.Diagnostics.Process
    $p.StartInfo = $psi
    [void]$p.Start()
    $outTask = $p.StandardOutput.ReadToEndAsync()
    $errTask = $p.StandardError.ReadToEndAsync()
    $bytes = $utf8.GetBytes([string]$StdinText)
    try {
        $p.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
        $p.StandardInput.BaseStream.Flush()
    }
    catch { }  # child may exit early; its stderr explains why
    finally { try { $p.StandardInput.Close() } catch { } }
    $p.WaitForExit()
    [pscustomobject]@{ ExitCode = $p.ExitCode; Stdout = $outTask.Result; Stderr = $errTask.Result }
}

# Parse claude --output-format json output. Tolerates a JSON array of messages (takes the result one).
function ConvertFrom-ExtResult([string]$Text) {
    if ([string]::IsNullOrWhiteSpace($Text)) { return $null }
    try { $obj = $Text | ConvertFrom-Json } catch { return $null }
    if ($obj -is [array]) {
        $r = @($obj | Where-Object { (Get-ExtProp $_ 'type') -eq 'result' }) | Select-Object -Last 1
        if (-not $r) { $r = $obj | Select-Object -Last 1 }
        $obj = $r
    }
    return $obj
}

function Format-ExtK($n) {
    return ([double]$n / 1000).ToString('0.0', [Globalization.CultureInfo]::InvariantCulture) + 'k'
}

# Summarise a parsed result. Returns Status (ok|HANDOFF|failed), ExitCode, Handoff, Lines (stdout text),
# and the run-record fields. $Parsed may be $null (unparsable output).
function Format-ExtReport {
    param($Parsed, [string]$Step, [string]$ModelId, [double]$DurationSec, [int]$ChildExitCode = 0, [string]$LogFile = '', [string]$Stderr = '')
    $usage = Get-ExtProp $Parsed 'usage'
    $inTok = [long](Get-ExtProp $usage 'input_tokens' 0)
    $outTok = [long](Get-ExtProp $usage 'output_tokens' 0)
    $cRead = [long](Get-ExtProp $usage 'cache_read_input_tokens' 0)
    $cMake = [long](Get-ExtProp $usage 'cache_creation_input_tokens' 0)
    $turns = Get-ExtProp $Parsed 'num_turns' 0
    $result = [string](Get-ExtProp $Parsed 'result' '')
    $isError = [bool](Get-ExtProp $Parsed 'is_error' $false)
    $handoff = $result.TrimStart().StartsWith('HANDOFF')

    if ($null -eq $Parsed -or $isError -or $ChildExitCode -ne 0) { $status = 'failed'; $code = 1 }
    elseif ($handoff) { $status = 'HANDOFF'; $code = 3 }
    else { $status = 'ok'; $code = 0 }

    $secs = [int][Math]::Round($DurationSec)
    $dur = '{0}m{1:00}s' -f [int][Math]::Floor($secs / 60), ($secs % 60)
    $d = $script:Dot
    $first = "ext-build: $Step $d $ModelId $d $turns turns $d $(Format-ExtK ($inTok + $cRead + $cMake)) in ($(Format-ExtK $cRead) cached) / $(Format-ExtK $outTok) out $d $dur $d $status"

    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add($first)
    $body = $result
    if ($null -eq $Parsed) {
        $body = 'claude output was not parsable JSON (exit ' + $ChildExitCode + ').'
        if ($Stderr) { $body += "`n" + (($Stderr -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -First 5) -join "`n") }
    }
    $bl = @($body -split "`r?`n")
    while ($bl.Count -gt 0 -and -not $bl[-1].Trim()) { $bl = @($bl | Select-Object -First ($bl.Count - 1)) }
    if ($bl.Count -gt 20) {
        foreach ($l in ($bl | Select-Object -First 19)) { $lines.Add($l) }
        $lines.Add("... ($($bl.Count - 19) more lines in the log)")
    }
    else { foreach ($l in $bl) { $lines.Add($l) } }
    if ($LogFile) { $lines.Add("log: $LogFile") }

    [pscustomobject]@{
        Status = $status; ExitCode = $code; Handoff = $handoff; IsError = $isError
        NumTurns = $turns; Lines = $lines.ToArray(); FirstLine = $first
        Usage = [ordered]@{ input_tokens = $inTok; output_tokens = $outTok; cache_read_input_tokens = $cRead; cache_creation_input_tokens = $cMake }
        SessionId = Get-ExtProp $Parsed 'session_id'
        ReportedCostUsd = Get-ExtProp $Parsed 'total_cost_usd'
    }
}

function Write-ExtUtf8Line([string]$Path, [string]$Line) {
    [IO.File]::AppendAllText($Path, $Line + "`n", (New-Object System.Text.UTF8Encoding($false)))
}

function Invoke-ExtCheck($Cfg, [string]$ModelName) {
    $modelId = Resolve-ExtModel $ModelName $Cfg
    $key = Get-ExtKey $Cfg.KeyFile
    $exe = Resolve-ExtClaude $Cfg
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ('ext-build-check-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path $tmp | Out-Null
    try {
        $argList = @('-p', 'Reply with the single word OK', '--output-format', 'json', '--model', $modelId,
            '--strict-mcp-config', '--max-budget-usd', '1', '--no-session-persistence', '--settings', $script:AttributionSettings)
        $r = Invoke-ExtClaude $exe $argList (Get-ExtEnv $modelId $key $Cfg) $tmp ''
    }
    finally { $key = $null; Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }
    $parsed = ConvertFrom-ExtResult $r.Stdout
    $mu = Get-ExtProp $parsed 'modelUsage'
    $reported = if ($mu) { ($mu.PSObject.Properties | ForEach-Object { $_.Name }) -join ', ' } else { '(none reported)' }
    $text = [string](Get-ExtProp $parsed 'result' '')
    $ok = ($null -ne $parsed) -and ($r.ExitCode -eq 0) -and -not [bool](Get-ExtProp $parsed 'is_error' $false) -and ($text -match '\bOK\b')
    Write-Output "ext-build check: requested $modelId"
    Write-Output "ext-build check: model reported $reported"
    if ($ok) { Write-Output 'ext-build check: OK'; return 0 }
    $errs = @(Get-ExtProp $parsed 'errors' @()) -join '; '
    $why = if ($text) { $text } elseif ($errs) { "$errs ($(Get-ExtProp $parsed 'terminal_reason' ''))" } elseif ($r.Stderr) { ($r.Stderr -split "`r?`n" | Select-Object -First 5) -join "`n" } else { "exit $($r.ExitCode)" }
    Write-Output "ext-build check: failed`n$why"
    return 1
}

function Invoke-ExtMain {
    $cfg = Read-ExtConfig $Config
    if ($SetKey -or $Check) {
        $prov = Assert-KeyProvider $Provider
        if ($SetKey) { Invoke-ExtSetKey $cfg $prov; return 0 }
        if ($prov -ne 'fireworks') { return (Invoke-ExtKeyStatus $prov) }
        return (Invoke-ExtCheck $cfg $Model)
    }
    if ($Provider) { Stop-Setup "unexpected argument '$Provider' (a provider goes after -SetKey or -Check)" }

    foreach ($pair in @(@('Brief', $Brief), @('Cwd', $Cwd), @('Step', $Step), @('LogDir', $LogDir))) {
        if ([string]::IsNullOrWhiteSpace($pair[1])) { Stop-Setup "missing -$($pair[0])" }
    }
    $briefPath = Expand-ExtPath $Brief
    if (-not (Test-Path -LiteralPath $briefPath -PathType Leaf)) { Stop-Setup "brief not found: $briefPath" }
    $cwdPath = Expand-ExtPath $Cwd
    if (-not (Test-Path -LiteralPath $cwdPath -PathType Container)) { Stop-Setup "cwd not found: $cwdPath" }
    $briefText = [IO.File]::ReadAllText($briefPath)
    if (-not $briefText.Trim()) { Stop-Setup "brief is empty: $briefPath" }

    $modelId = Resolve-ExtModel $Model $cfg
    $budget = if ($MaxBudgetUsd -gt 0) { $MaxBudgetUsd } else { $cfg.MaxBudgetUsd }
    $key = Get-ExtKey $cfg.KeyFile
    $envMap = Get-ExtEnv $modelId $key $cfg
    $argList = Get-ExtClaudeArgs $modelId $cfg $budget $Resume

    $logPath = Expand-ExtPath $LogDir
    $safeStep = ($Step -replace '[\\/:*?"<>|\s]', '_')
    $stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
    $logFile = Join-Path $logPath "$safeStep-$stamp.json"
    $errFile = Join-Path $logPath "$safeStep-$stamp.err.txt"
    $runsFile = Join-Path $logPath 'ext-runs.jsonl'

    if ($DryRun) {
        $exe = '(claude not found)'
        try { $exe = Resolve-ExtClaude $cfg } catch { }
        Write-Output "ext-build dry run: $Step"
        Write-Output "model: $modelId"
        Write-Output "config: $($cfg.Path)"
        Write-Output "cwd: $cwdPath"
        Write-Output "brief: $briefPath ($($briefText.Length) chars, sent on stdin)"
        Write-Output 'env (child only):'
        foreach ($k in $envMap.Keys) {
            $v = if ($k -eq 'ANTHROPIC_AUTH_TOKEN') { '***' } else { $envMap[$k] }
            Write-Output "  $k=$v"
        }
        Write-Output "  removed: $($script:EnvToRemove -join ', ')"
        Write-Output "exe: $exe"
        Write-Output 'args:'
        foreach ($a in $argList) { Write-Output "  $(ConvertTo-ExtWinArg $a)" }
        Write-Output "log: $logFile"
        Write-Output "stderr: $errFile"
        Write-Output "runs: $runsFile"
        return 0
    }

    $exe = Resolve-ExtClaude $cfg
    if (-not (Test-Path -LiteralPath $logPath)) { New-Item -ItemType Directory -Path $logPath -Force | Out-Null }
    $start = Get-Date
    try { $r = Invoke-ExtClaude $exe $argList $envMap $cwdPath $briefText }
    finally { $key = $null; $envMap = $null }
    $end = Get-Date
    $dur = ($end - $start).TotalSeconds

    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($logFile, [string]$r.Stdout, $utf8)
    if ($r.Stderr) { [IO.File]::WriteAllText($errFile, [string]$r.Stderr, $utf8) }

    $parsed = ConvertFrom-ExtResult $r.Stdout
    $rep = Format-ExtReport -Parsed $parsed -Step $Step -ModelId $modelId -DurationSec $dur -ChildExitCode $r.ExitCode -LogFile $logFile -Stderr $r.Stderr

    $rec = [ordered]@{
        step            = $Step
        engine          = 'fireworks'
        model           = $modelId
        start           = $start.ToString('o')
        end             = $end.ToString('o')
        durationSec     = [Math]::Round($dur, 1)
        exitCode        = $r.ExitCode
        isError         = ($rep.IsError -or $null -eq $parsed)
        handoff         = $rep.Handoff
        numTurns        = $rep.NumTurns
        usage           = $rep.Usage
        sessionId       = $rep.SessionId
        logFile         = $logFile
        reportedCostUsd = $rep.ReportedCostUsd
    }
    Write-ExtUtf8Line $runsFile ((New-Object psobject -Property $rec) | ConvertTo-Json -Compress -Depth 5)

    foreach ($l in $rep.Lines) { Write-Output $l }
    return $rep.ExitCode
}

if ($MyInvocation.InvocationName -ne '.') {
    $prevEnc = [Console]::OutputEncoding
    $script:ExtExit = 1
    try {
        try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }
        # Invoke-ExtMain emits text lines and, last, its exit code (an int).
        Invoke-ExtMain | ForEach-Object { if ($_ -is [int]) { $script:ExtExit = $_ } else { Write-Output $_ } }
    }
    catch {
        if ($_.Exception.Data['ExtSetup']) { Write-Output "ext-build: $($_.Exception.Message)"; $script:ExtExit = 2 }
        else { Write-Output "ext-build: failed: $($_.Exception.Message)"; $script:ExtExit = 1 }
    }
    finally {
        try { [Console]::OutputEncoding = $prevEnc } catch { }
    }
    exit $script:ExtExit
}