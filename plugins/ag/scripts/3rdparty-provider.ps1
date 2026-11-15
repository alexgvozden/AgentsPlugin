<#
    3rdparty-provider.ps1 - pick the provider the third-party builders run on, or show it.

    The builders of goal-prompt-3rdparty run through ext-build.ps1 on Fireworks or OpenRouter.
    The choice is "provider" in ~/.claude/ext-build.json (the file is created when missing).
    A legacy flat file (baseUrl, keyFile, defaultModel, modelPrefix at the top) is moved into
    "providers": { "<its provider, default fireworks>": { ... } } first; other keys are kept.
    ext-build.ps1 reads the file on every run, so the change applies to the next build.

    Usage
        3rdparty-provider.ps1 [fireworks|status] [-ConfigPath <file>]
        3rdparty-provider.ps1 openrouter [<provider>[,<provider>...]|cheapest|fastest|quickest-start|auto]
                              [-ConfigPath <file>] [-EndpointsJson <file>]
    Empty means status. Status prints the provider, its default model, the OpenRouter routing,
    the config file and whether a key is set (never the key), with the command that sets a missing key.

    OpenRouter routing (which upstream provider serves the model) is providers.openrouter.routing,
    OpenRouter's "provider" routing object; ext-build.ps1 sends it through CLAUDE_CODE_EXTRA_BODY.
        wafer/mxfp4 or deepinfra/fp8,deepseek  {"only":[...]}, OpenRouter picks among them
        cheapest | fastest | quickest-start   {"sort":"price" | "throughput" | "latency"}
        auto                                  no routing (OpenRouter's own choice)
        (none)                                the routing is kept as it is
    Provider slugs are checked against the public endpoints list of the OpenRouter default model
    (https://openrouter.ai/api/v1/models/<model>/endpoints, no key); an unknown one is a warning
    and is still saved. -EndpointsJson <file> (or env AG_OPENROUTER_ENDPOINTS_JSON) reads that
    list from a file instead (tests); a missing or unreadable file reads as offline.

    Exit 0 ok, 2 bad argument, invalid JSON or a config ext-build.ps1 cannot use.
    Windows PowerShell 5.1 and PowerShell 7 compatible.
#>
param(
    [Parameter(Position = 0)][string]$Mode = 'status',
    [Parameter(Position = 1, ValueFromRemainingArguments = $true)][string[]]$Route = @(),
    [string]$ConfigPath = '',
    [string]$EndpointsJson = $env:AG_OPENROUTER_ENDPOINTS_JSON
)

$ErrorActionPreference = 'Stop'

# Dot-sourcing only defines the functions (Read-ExtConfig, Test-ProviderKey, ...).
. (Join-Path $PSScriptRoot 'ext-build.ps1')

$choices = @('fireworks', 'openrouter')
$flatKeys = @('baseUrl', 'keyFile', 'defaultModel', 'modelPrefix')
$PSCO = [System.Management.Automation.PSCustomObject]

$Mode = ([string]$Mode).Trim().ToLowerInvariant()
if (-not $Mode) { $Mode = 'status' }
if (@($choices + 'status') -notcontains $Mode) {
    Write-Host ('error: use fireworks, openrouter or status (got "' + $Mode + '").')
    exit 2
}

# The second argument: 'keep' (none), 'remove' (auto) or 'set' with $newRouting.
# Spaces after commas split it into several arguments; they are joined back.
$routeText = ((@($Route) | ForEach-Object { [string]$_ }) -join ',').Trim()
$newRouting = $null
$routeAction = 'keep'
if ($routeText) {
    if ($Mode -ne 'openrouter') {
        Write-Host ('error: a route ("' + $routeText + '") only goes with openrouter, e.g. openrouter wafer/mxfp4.')
        exit 2
    }
    $sorts = @{ cheapest = 'price'; fastest = 'throughput'; 'quickest-start' = 'latency' }
    $word = $routeText.ToLowerInvariant()
    if ($word -eq 'auto') { $routeAction = 'remove' }
    elseif ($sorts.ContainsKey($word)) {
        $routeAction = 'set'
        $newRouting = [pscustomobject][ordered]@{ sort = $sorts[$word] }
    }
    else {
        $slugs = @($routeText -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
        $bad = @($slugs | Where-Object { $_ -cnotmatch '^[a-z0-9._/-]+$' })
        if ($slugs.Count -eq 0 -or $bad.Count -gt 0) {
            Write-Host ('error: "' + ($bad -join '", "') + '" is not a provider slug (lower-case letters, digits, - _ . /; e.g. wafer/mxfp4 or deepinfra/fp8,deepseek) and not cheapest, fastest, quickest-start or auto.')
            exit 2
        }
        $routeAction = 'set'
        $newRouting = [pscustomobject][ordered]@{ only = @($slugs | Select-Object -Unique) }
    }
}

if (-not $ConfigPath) { $ConfigPath = Join-Path (Join-Path (Get-KeyHome) '.claude') 'ext-build.json' }
$ConfigPath = [IO.Path]::GetFullPath($ConfigPath)

function Read-UserConfig([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    $text = [IO.File]::ReadAllText($Path)
    $obj = $null
    if ($text.Trim()) {
        try { $obj = $text | ConvertFrom-Json } catch { $obj = $null }
    }
    if ($null -eq $obj -or $obj -isnot $PSCO) {
        Write-Host ('error: ' + $Path + ' is not a valid JSON object; fix it first, nothing was changed.')
        exit 2
    }
    return $obj
}

function Save-UserConfig([string]$Path, $Obj) {
    $dir = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $json = $Obj | ConvertTo-Json -Depth 100
    [IO.File]::WriteAllText($Path, $json + "`n", (New-Object System.Text.UTF8Encoding($false)))
}

function ConvertTo-CompactJson($Value) {
    if ($null -eq $Value) { return '' }
    return [string]($Value | ConvertTo-Json -Compress -Depth 20)
}

# The "routing" property of providers.openrouter in the user file (any value), or $null.
function Get-FileRoutingProp($Obj) {
    $e = Get-ExtProp (Get-ExtProp $Obj 'providers') 'openrouter'
    if ($e -isnot $PSCO) { return $null }
    return $e.PSObject.Properties['routing']
}

# The file with "provider" set to $Name, flat provider keys moved under "providers" and the
# OpenRouter routing set ($Action 'set' with $Routing), removed ('remove') or kept ('keep').
# Returns $null when nothing would change.
function Get-UpdatedConfig($Obj, [string]$Name, [string]$Action = 'keep', $Routing = $null) {
    $names = @($Obj.PSObject.Properties | ForEach-Object { $_.Name })
    $flat = @($flatKeys | Where-Object { $names -contains $_ })
    $cur = ([string](Get-ExtProp $Obj 'provider' '')).Trim().ToLowerInvariant()
    $rp = Get-FileRoutingProp $Obj
    $routingChange = $false
    if ($Action -eq 'set') { $routingChange = ($null -eq $rp) -or ((ConvertTo-CompactJson $rp.Value) -ne (ConvertTo-CompactJson $Routing)) }
    elseif ($Action -eq 'remove') { $routingChange = ($null -ne $rp) }
    if ($flat.Count -eq 0 -and $cur -eq $Name -and -not $routingChange) { return $null }

    $provs = [ordered]@{}
    $old = Get-ExtProp $Obj 'providers'
    if ($null -ne $old) {
        foreach ($pp in $old.PSObject.Properties) { $provs[$pp.Name] = $pp.Value }
    }
    if ($flat.Count -gt 0) {
        $owner = if ($cur) { $cur } else { 'fireworks' }
        $entry = [ordered]@{}
        foreach ($k in $flat) { $entry[$k] = $Obj.$k }
        # An existing providers entry wins over the flat keys, as in ext-build.ps1.
        if ($provs.Contains($owner) -and $provs[$owner] -is $PSCO) {
            foreach ($pp in $provs[$owner].PSObject.Properties) { $entry[$pp.Name] = $pp.Value }
        }
        $provs[$owner] = [pscustomobject]$entry
    }
    if ($routingChange) {
        $entry = [ordered]@{}
        if ($provs.Contains('openrouter') -and $provs['openrouter'] -is $PSCO) {
            foreach ($pp in $provs['openrouter'].PSObject.Properties) { if ($pp.Name -ne 'routing') { $entry[$pp.Name] = $pp.Value } }
        }
        if ($Action -eq 'set') { $entry['routing'] = $Routing }
        if ($entry.Count -gt 0) { $provs['openrouter'] = [pscustomobject]$entry }
        elseif ($provs.Contains('openrouter')) { $provs.Remove('openrouter') }
    }

    $out = [ordered]@{ provider = $Name }
    if ($provs.Count -gt 0) { $out['providers'] = [pscustomobject]$provs }
    foreach ($p in $Obj.PSObject.Properties) {
        if (@('provider', 'providers') -contains $p.Name -or $flatKeys -contains $p.Name) { continue }
        $out[$p.Name] = $p.Value
    }
    return [pscustomobject]$out
}

# The routing in words: auto, only a, b, cheapest, fastest, quickest-start, or its JSON.
function Format-Routing($Routing) {
    if ($null -eq $Routing) { return 'auto (OpenRouter picks)' }
    $props = @($Routing.PSObject.Properties | ForEach-Object { $_.Name })
    $only = Get-ExtProp $Routing 'only'
    if ($null -ne $only -and @($props | Where-Object { @('only', 'allow_fallbacks') -notcontains $_ }).Count -eq 0) {
        $t = 'only ' + (@($only) -join ', ')
        return $t
    }
    $sort = Get-ExtProp $Routing 'sort'
    $words = @{ price = 'cheapest'; throughput = 'fastest'; latency = 'quickest-start' }
    if ($props.Count -eq 1 -and $sort -is [string] -and $words.ContainsKey($sort)) { return $words[$sort] }
    return (ConvertTo-CompactJson $Routing)
}

# The endpoints of an OpenRouter model (data.endpoints), from -EndpointsJson or the public list;
# $null when they cannot be read (offline, unknown model).
$script:EndpointsCache = @{}
function Get-OrEndpoints([string]$ModelId) {
    if ($script:EndpointsCache.ContainsKey($ModelId)) { return $script:EndpointsCache[$ModelId] }
    $list = $null
    try {
        if ($EndpointsJson) {
            $data = [IO.File]::ReadAllText([IO.Path]::GetFullPath($EndpointsJson)) | ConvertFrom-Json
        }
        else {
            try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }
            $url = 'https://openrouter.ai/api/v1/models/' + $ModelId + '/endpoints'
            $data = Invoke-RestMethod -Uri $url -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
        }
        $eps = Get-ExtProp (Get-ExtProp $data 'data') 'endpoints'
        if ($null -ne $eps) { $list = @($eps) }
    }
    catch { $list = $null }
    $script:EndpointsCache[$ModelId] = $list
    return $list
}

function Get-EndpointTag($Ep) {
    $t = [string](Get-ExtProp $Ep 'tag' '')
    if (-not $t) { $t = [string](Get-ExtProp $Ep 'provider_name' '') }
    return $t.ToLowerInvariant()
}

# The endpoints a slug picks: the tag itself ("wafer/mxfp4"), else every tag under it, as for a
# provider name ("wafer"). An exact tag wins: "deepinfra/fp8" shows that endpoint, not /flex or /priority.
function Find-Endpoints($Endpoints, [string]$Slug) {
    $s = $Slug.ToLowerInvariant()
    $exact = @($Endpoints | Where-Object { (Get-EndpointTag $_) -eq $s })
    if ($exact.Count -gt 0) { return $exact }
    return @($Endpoints | Where-Object { (Get-EndpointTag $_).StartsWith($s + '/') })
}

function Format-PerMillion($PerToken) {
    $d = 0.0
    $ic = [Globalization.CultureInfo]::InvariantCulture
    if (-not [double]::TryParse([string]$PerToken, [Globalization.NumberStyles]::Float, $ic, [ref]$d)) { return '?' }
    return '$' + ($d * 1000000).ToString('0.00##', $ic)
}

function Format-Endpoint($Ep) {
    $pr = Get-ExtProp $Ep 'pricing'
    $q = [string](Get-ExtProp $Ep 'quantization' '')
    if (-not $q) { $q = 'quantization not stated' }
    return ('  ' + (Get-EndpointTag $Ep) + ': ' + [string](Get-ExtProp $Ep 'provider_name' '') + ', ' + $q + ', ' +
        (Format-PerMillion (Get-ExtProp $pr 'prompt')) + ' in / ' + (Format-PerMillion (Get-ExtProp $pr 'completion')) + ' out per 1M tokens')
}

# Warns about slugs no endpoint of the model has, or says the check was skipped.
function Test-RouteSlugs([string[]]$Slugs, [string]$ModelId) {
    $eps = Get-OrEndpoints $ModelId
    if ($null -eq $eps) {
        Write-Host ('note: could not read the OpenRouter endpoints of ' + $ModelId + ' (offline?); the provider check was skipped.')
        return
    }
    $unknown = @($Slugs | Where-Object { @(Find-Endpoints $eps $_).Count -eq 0 })
    if ($unknown.Count -gt 0) {
        $tags = @($eps | ForEach-Object { Get-EndpointTag $_ } | Where-Object { $_ } | Sort-Object -Unique)
        Write-Host ('warning: ' + $ModelId + ' has no OpenRouter endpoint "' + ($unknown -join '", "') + '"; saved anyway (another model= may have it).')
        Write-Host ('  valid for ' + $ModelId + ': ' + ($tags -join ', '))
    }
}

function Write-Status([string]$Path) {
    # A missing user file: the plugin default alone (passed as the config, so no other file is read).
    $exists = Test-Path -LiteralPath $Path -PathType Leaf
    $read = if ($exists) { $Path } else { Join-Path (Split-Path -Parent $PSScriptRoot) 'ext-build.default.json' }
    $cfg = $null
    $or = $null
    try {
        $cfg = Read-ExtConfig $read ''
        $or = if ($cfg.Provider -eq 'openrouter') { $cfg } else { Read-ExtConfig $read 'openrouter' }
    }
    catch {
        if ($_.Exception.Data['ExtSetup']) { Write-Host ('error: ' + $_.Exception.Message); exit 2 }
        throw
    }
    Write-Host ('provider: ' + $cfg.Provider + ' (' + $cfg.ProviderLabel + ')')
    Write-Host ('default model: ' + (Resolve-ExtModel '' $cfg) + ' (another one: model=<id> in the goal)')
    if ($cfg.Provider -eq 'openrouter') { Write-Host ('routing: ' + (Format-Routing $or.Routing)) }
    elseif ($null -ne $or.Routing) { Write-Host ('openrouter routing: ' + (Format-Routing $or.Routing) + ' (applies when the builders run on openrouter)') }
    $only = Get-ExtProp $or.Routing 'only'
    if ($null -ne $only) {
        $eps = Get-OrEndpoints (Resolve-ExtModel '' $or)
        if ($null -ne $eps) {
            foreach ($slug in @($only)) {
                foreach ($ep in @(Find-Endpoints $eps ([string]$slug))) { Write-Host (Format-Endpoint $ep) }
            }
        }
    }
    if ($exists) { Write-Host ('config: ' + $Path) }
    else { Write-Host ('config: ' + $Path + ' (not there yet; the plugin default applies)') }
    $set = $false
    try { $set = Test-ProviderKey -Provider $cfg.Provider -KeyFile $cfg.KeyFile } catch { $set = $false }
    if ($set) { Write-Host ('key: set for ' + $cfg.Provider) }
    else {
        Write-Host ('key: not set for ' + $cfg.Provider + '; set it in your own terminal (never in the chat):')
        Write-Host ('  powershell -NoProfile -ExecutionPolicy Bypass -File $HOME\.claude\ag\ag-key.ps1 set ' + $cfg.Provider)
    }
}

$obj = Read-UserConfig $ConfigPath

if ($Mode -ne 'status') {
    $what = $Mode
    if ($routeAction -eq 'set') { $what += ', routing ' + (Format-Routing $newRouting) }
    elseif ($routeAction -eq 'remove') { $what += ', routing ' + (Format-Routing $null) }
    if ($null -eq $obj) {
        $new = Get-UpdatedConfig ([pscustomobject][ordered]@{ provider = $Mode }) $Mode $routeAction $newRouting
        if ($null -eq $new) { $new = [pscustomobject][ordered]@{ provider = $Mode } }
        Save-UserConfig $ConfigPath $new
        Write-Host ('done: builders run on ' + $what + ' (created ' + $ConfigPath + ')')
    }
    else {
        $new = Get-UpdatedConfig $obj $Mode $routeAction $newRouting
        if ($null -eq $new) { Write-Host ('skip: builders already run on ' + $what + ' (' + $ConfigPath + ')') }
        else {
            Save-UserConfig $ConfigPath $new
            Write-Host ('done: builders run on ' + $what + ' (' + $ConfigPath + ')')
        }
    }
    if ($routeAction -eq 'set' -and $null -ne (Get-ExtProp $newRouting 'only')) {
        # Checked against the OpenRouter default model of the file just written.
        $orCfg = $null
        try { $orCfg = Read-ExtConfig $ConfigPath 'openrouter' } catch { $orCfg = $null }
        if ($null -ne $orCfg) { Test-RouteSlugs @($newRouting.only) (Resolve-ExtModel '' $orCfg) }
    }
}

Write-Status $ConfigPath
exit 0
