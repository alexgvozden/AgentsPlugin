<#
.SYNOPSIS
  Make design images from a prompt with Gemini or OpenAI.

.DESCRIPTION
  design-image.ps1 -Prompt <text> [-Provider gemini|openai] [-Model <id>] [-Out <folder>] [-Count <n>] [-DryRun] [-Config <path>]
  design-image.ps1 -PromptFile <path> [-Provider gemini|openai] [-Model <id>] [-Out <folder>] [-Count <n>] [-DryRun] [-Config <path>]
  design-image.ps1 -SetKey [<gemini|openai>] [-Config <path>]
  design-image.ps1 -Check [<gemini|openai>] [-Model <id>] [-Config <path>]

  Keys come from the store of keystore.ps1 (Windows DPAPI file, macOS Keychain, Linux
  secret-tool or a mode-600 file); a key is never printed or logged. Models and base URLs
  come from ~/.claude/design.json first, then design.default.json next to the plugin.
  Each image is written as <Out>/<slug>-<n>.png with a sidecar <slug>-<n>.md.
  -DryRun prints the request it would send (key shown as ***) and calls no API.

  Exit codes: 0 ok, 1 failed (API error), 2 setup error.
  Windows PowerShell 5.1 and PowerShell 7 (pwsh) compatible.
  Dot-sourcing this file (". design-image.ps1") only defines the functions (used by tests).
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$Provider,
    [string]$Prompt,
    [string]$PromptFile,
    [string]$Model,
    [string]$Out,
    [int]$Count = 1,
    [string]$Config,
    [switch]$DryRun,
    [switch]$SetKey,
    [switch]$Check
)

Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'keystore.ps1')
# keystore.ps1's own hint names ext-build.ps1; point the launcher's hint at itself instead.
$script:KeySetHint = 'run design-image.ps1 -SetKey{0} in your own PowerShell window'

function Stop-DesignSetup([string]$Message) {
    $e = New-Object System.Exception $Message
    $e.Data['DesignSetup'] = $true
    throw $e
}

function Expand-DesignPath([string]$Path, [string]$BaseDir) {
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

function Get-DesignProp($Obj, [string]$Name, $Default = $null) {
    if ($null -eq $Obj) { return $Default }
    $p = $Obj.PSObject.Properties[$Name]
    if ($null -eq $p -or $null -eq $p.Value) { return $Default }
    return $p.Value
}

# User file first (~/.claude/design.json), then the plugin default (design.default.json).
function Read-DesignConfig([string]$Path) {
    if (-not $Path) {
        $userCfg = Join-Path (Join-Path (Get-KeyHome) '.claude') 'design.json'
        if (Test-Path -LiteralPath $userCfg -PathType Leaf) { $Path = $userCfg }
        else { $Path = Join-Path (Split-Path -Parent $PSScriptRoot) 'design.default.json' }
    }
    $Path = Expand-DesignPath $Path
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { Stop-DesignSetup "config not found: $Path" }
    try { $cfg = [IO.File]::ReadAllText($Path) | ConvertFrom-Json }
    catch { Stop-DesignSetup "config is not valid JSON: $Path" }
    $def = [string](Get-DesignProp $cfg 'defaultProvider' '')
    if (-not $def) { Stop-DesignSetup "config $Path is missing 'defaultProvider'" }
    $def = $def.Trim().ToLowerInvariant()
    if (@('gemini', 'openai') -notcontains $def) { Stop-DesignSetup "config $Path has an unknown defaultProvider '$def'" }
    $provs = Get-DesignProp $cfg 'providers'
    if ($null -eq $provs) { Stop-DesignSetup "config $Path is missing 'providers'" }
    $map = @{}
    foreach ($name in @('gemini', 'openai')) {
        $p = $provs.PSObject.Properties[$name]
        if ($null -eq $p -or $null -eq $p.Value) { Stop-DesignSetup "config $Path is missing provider '$name'" }
        $baseUrl = ([string](Get-DesignProp $p.Value 'baseUrl' '')).TrimEnd('/')
        $model = [string](Get-DesignProp $p.Value 'defaultModel' '')
        if (-not $baseUrl) { Stop-DesignSetup "config $Path provider '$name' is missing 'baseUrl'" }
        if (-not $model) { Stop-DesignSetup "config $Path provider '$name' is missing 'defaultModel'" }
        $map[$name] = [pscustomobject]@{ Name = $name; BaseUrl = $baseUrl; DefaultModel = $model }
    }
    [pscustomobject]@{
        Path            = $Path
        DefaultProvider = $def
        DefaultSize     = [string](Get-DesignProp $cfg 'defaultSize' '1024x1024')
        Providers       = $map
    }
}

function Assert-DesignProvider([string]$Name, $Cfg) {
    $p = if ([string]::IsNullOrWhiteSpace($Name)) { $Cfg.DefaultProvider } else { $Name.Trim().ToLowerInvariant() }
    if (-not $Cfg.Providers.ContainsKey($p)) { Stop-DesignSetup "unknown provider '$p' (use one of: gemini, openai)" }
    return $p
}

# A short, safe file name from the prompt.
function ConvertTo-DesignSlug([string]$Text) {
    $s = if ($Text) { $Text.ToLowerInvariant() } else { '' }
    $s = [regex]::Replace($s, '[^a-z0-9]+', '-').Trim('-')
    if ($s.Length -gt 40) { $s = $s.Substring(0, 40).Trim('-') }
    if (-not $s) { $s = 'design' }
    return $s
}

# The URL, headers and JSON body for one image request (no network).
function Get-DesignRequest($Cfg, [string]$ProviderName, [string]$ModelId, [string]$PromptText, [string]$Key) {
    $pc = $Cfg.Providers[$ProviderName]
    if ($ProviderName -eq 'gemini') {
        $url = "$($pc.BaseUrl)/models/$($ModelId):generateContent"
        $body = [ordered]@{
            contents         = @(@{ parts = @(@{ text = $PromptText }) })
            generationConfig = @{ responseModalities = @('IMAGE') }
        }
        $headers = @{ 'x-goog-api-key' = $Key }
    }
    else {
        $url = "$($pc.BaseUrl)/images/generations"
        $body = [ordered]@{ model = $ModelId; prompt = $PromptText; size = $Cfg.DefaultSize; n = 1 }
        $headers = @{ Authorization = "Bearer $Key" }
    }
    [pscustomobject]@{
        Provider = $ProviderName
        Model    = $ModelId
        Url      = $url
        Headers  = $headers
        Body     = ($body | ConvertTo-Json -Depth 10 -Compress)
    }
}

# The one place that talks to the network. Tests replace this function.
function Invoke-DesignHttpSend {
    param([string]$Url, [string]$Method, [hashtable]$Headers, [string]$Body, [int]$TimeoutSec = 180)
    try {
        $r = Invoke-WebRequest -Uri $Url -Method $Method -Headers $Headers -Body $Body `
            -ContentType 'application/json' -TimeoutSec $TimeoutSec -UseBasicParsing
        return [pscustomobject]@{ StatusCode = [int]$r.StatusCode; Content = [string]$r.Content; ErrorMessage = '' }
    }
    catch {
        $resp = $_.Exception.Response
        $code = 0; $content = ''
        if ($resp) {
            try { $code = [int]$resp.StatusCode } catch { }
            try {
                $stream = $resp.GetResponseStream()
                if ($stream) { $content = (New-Object IO.StreamReader($stream)).ReadToEnd() }
            }
            catch { }
        }
        if (-not $content) { $content = $_.Exception.Message }
        return [pscustomobject]@{ StatusCode = $code; Content = $content; ErrorMessage = $_.Exception.Message }
    }
}

# Pulls the base64 image(s) out of a provider response.
function Get-DesignImages([string]$ProviderName, [string]$Content) {
    $parsed = $null
    try { $parsed = $Content | ConvertFrom-Json }
    catch { throw "the $ProviderName response is not JSON: $(([string]$Content).Substring(0, [Math]::Min(300, ([string]$Content).Length)))" }
    $out = @()
    if ($ProviderName -eq 'gemini') {
        foreach ($cand in @(Get-DesignProp $parsed 'candidates' @())) {
            # not $content: that would collide with the [string]$Content parameter, and
            # PowerShell would coerce the node back to a string on assignment.
            $contentNode = Get-DesignProp $cand 'content'
            foreach ($part in @(Get-DesignProp $contentNode 'parts' @())) {
                $d = Get-DesignProp $part 'inlineData'
                if ($d -and (Get-DesignProp $d 'data')) {
                    $out += [pscustomobject]@{ Data = [string](Get-DesignProp $d 'data'); MimeType = [string](Get-DesignProp $d 'mimeType' 'image/png') }
                }
            }
        }
    }
    else {
        foreach ($d in @(Get-DesignProp $parsed 'data' @())) {
            $b = Get-DesignProp $d 'b64_json'
            if ($b) { $out += [pscustomobject]@{ Data = [string]$b; MimeType = 'image/png' } }
        }
    }
    return $out
}

# Error text for the user: the key is masked and the text is trimmed.
function Get-DesignErrorText($Resp, [string]$Key) {
    $t = [string](Get-DesignProp $Resp 'Content' '')
    if (-not $t) { $t = [string](Get-DesignProp $Resp 'ErrorMessage' '') }
    if ($Key) { $t = $t.Replace($Key, '***') }
    $t = (@($t -split "`r?`n") | Select-Object -First 8) -join "`n"
    if ($t.Length -gt 800) { $t = $t.Substring(0, 800) }
    return $t
}

function Write-DesignSidecar([string]$Path, [string]$PromptText, [string]$ProviderName, [string]$ModelId, [string]$ImageName, [datetime]$Time) {
    $lines = @(
        "# $ImageName",
        '',
        "- prompt: $PromptText",
        "- provider: $ProviderName",
        "- model: $ModelId",
        "- time: $($Time.ToString('yyyy-MM-dd HH:mm:ss'))"
    )
    [IO.File]::WriteAllText($Path, (($lines -join "`n") + "`n"), (New-Object System.Text.UTF8Encoding($false)))
}

function Invoke-DesignSetKey([string]$ProviderName) {
    $p = Assert-KeyProvider $ProviderName
    $sec = Read-Host -AsSecureString -Prompt "$($script:KeyLabels[$p]) API key (input hidden)"
    foreach ($line in (Set-ProviderKey -Provider $p -Secure $sec)) { Write-Output "design-image: $line" }
    $sec = $null
    Write-Output "design-image: now run design-image.ps1 -Check $p"
}

# -Check: one tiny real call, then 'design-image check: OK'.
function Invoke-DesignCheck([string]$ProviderName, $Cfg, [string]$ModelName) {
    $pc = $Cfg.Providers[$ProviderName]
    $modelId = if ($ModelName) { $ModelName } else { $pc.DefaultModel }
    $key = Get-ProviderKey -Provider $ProviderName
    try {
        $req = Get-DesignRequest $Cfg $ProviderName $modelId 'a small blue circle on a white background' $key
        $r = Invoke-DesignHttpSend -Url $req.Url -Method 'POST' -Headers $req.Headers -Body $req.Body
    }
    catch { $key = $null; throw }
    if ($r.StatusCode -lt 200 -or $r.StatusCode -ge 300) {
        $err = Get-DesignErrorText $r $key
        $key = $null
        Write-Output "design-image check: failed ($ProviderName, model $modelId)"
        Write-Output $err
        return 1
    }
    $key = $null
    try { $images = @(Get-DesignImages $ProviderName $r.Content) }
    catch { Write-Output "design-image check: failed ($ProviderName, model $modelId)"; Write-Output $_.Exception.Message; return 1 }
    if ($images.Count -lt 1) { Write-Output "design-image check: failed ($ProviderName, model $modelId)"; Write-Output 'the response had no image'; return 1 }
    Write-Output "design-image check: $ProviderName $modelId returned an image"
    Write-Output 'design-image check: OK'
    return 0
}

function Invoke-DesignDryRun($Cfg, [string]$ProviderName, [string]$ModelName, [string]$PromptText, [string]$OutDir, [int]$ImageCount) {
    $pc = $Cfg.Providers[$ProviderName]
    $modelId = if ($ModelName) { $ModelName } else { $pc.DefaultModel }
    $slug = ConvertTo-DesignSlug $PromptText
    $outPath = if ($OutDir) { Expand-DesignPath $OutDir } else { (Get-Location).ProviderPath }
    for ($i = 1; $i -le $ImageCount; $i++) {
        $req = Get-DesignRequest $Cfg $ProviderName $modelId $PromptText '***'
        Write-Output "design-image dry-run: $ProviderName $modelId"
        Write-Output "design-image dry-run: POST $($req.Url)"
        foreach ($h in $req.Headers.Keys) { Write-Output "design-image dry-run: header $h`: $($req.Headers[$h])" }
        Write-Output "design-image dry-run: body $($req.Body)"
        Write-Output "design-image dry-run: would write $(Join-Path $outPath "$slug-$i.png")"
        Write-Output "design-image dry-run: would write $(Join-Path $outPath "$slug-$i.md")"
    }
    return 0
}

function Invoke-DesignGenerate($Cfg, [string]$ProviderName, [string]$ModelName, [string]$PromptText, [string]$OutDir, [int]$ImageCount) {
    $pc = $Cfg.Providers[$ProviderName]
    $modelId = if ($ModelName) { $ModelName } else { $pc.DefaultModel }
    $key = Get-ProviderKey -Provider $ProviderName
    try {
        $outPath = Expand-DesignPath $OutDir
        if (-not (Test-Path -LiteralPath $outPath -PathType Container)) { New-Item -ItemType Directory -Path $outPath -Force | Out-Null }
        $slug = ConvertTo-DesignSlug $PromptText
        $now = Get-Date
        for ($i = 1; $i -le $ImageCount; $i++) {
            $req = Get-DesignRequest $Cfg $ProviderName $modelId $PromptText $key
            $r = Invoke-DesignHttpSend -Url $req.Url -Method 'POST' -Headers $req.Headers -Body $req.Body
            if ($r.StatusCode -lt 200 -or $r.StatusCode -ge 300) {
                throw "$ProviderName returned HTTP $($r.StatusCode): $(Get-DesignErrorText $r $key)"
            }
            $images = @(Get-DesignImages $ProviderName $r.Content)
            if ($images.Count -lt 1) { throw "$ProviderName returned no image" }
            $png = Join-Path $outPath "$slug-$i.png"
            [IO.File]::WriteAllBytes($png, [Convert]::FromBase64String($images[0].Data))
            $md = Join-Path $outPath "$slug-$i.md"
            Write-DesignSidecar $md $PromptText $ProviderName $modelId "$slug-$i.png" $now
            Write-Output "design-image: wrote $png"
            Write-Output "design-image: wrote $md"
        }
    }
    finally { $key = $null }
    return 0
}

function Invoke-DesignMain {
    $cfg = Read-DesignConfig $Config

    if ($SetKey -or $Check) {
        $asked = if ([string]::IsNullOrWhiteSpace($Provider)) { $cfg.DefaultProvider } else { $Provider }
        $prov = Assert-KeyProvider $asked
        if ($prov -eq 'fireworks') { Stop-DesignSetup 'design-image.ps1 makes images with gemini or openai; pass -SetKey gemini or -Check openai' }
        if ($SetKey) { Invoke-DesignSetKey $prov; return 0 }
        return (Invoke-DesignCheck $prov $cfg $Model)
    }

    $promptText = $Prompt
    if ($PromptFile) {
        $pf = Expand-DesignPath $PromptFile
        if (-not (Test-Path -LiteralPath $pf -PathType Leaf)) { Stop-DesignSetup "prompt file not found: $pf" }
        $promptText = [IO.File]::ReadAllText($pf)
    }
    if ([string]::IsNullOrWhiteSpace($promptText)) { Stop-DesignSetup 'give a prompt with -Prompt or -PromptFile' }
    $providerName = Assert-DesignProvider $Provider $cfg
    if ($Count -lt 1) { Stop-DesignSetup '-Count must be 1 or more' }
    $outDir = if ($Out) { $Out } else { '.' }
    if ($DryRun) { return (Invoke-DesignDryRun $cfg $providerName $Model $promptText $outDir $Count) }
    return (Invoke-DesignGenerate $cfg $providerName $Model $promptText $outDir $Count)
}

if ($MyInvocation.InvocationName -ne '.') {
    $prevEnc = [Console]::OutputEncoding
    $script:DesignExit = 1
    try {
        try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }
        # Invoke-DesignMain emits text lines and, last, its exit code (an int).
        Invoke-DesignMain | ForEach-Object { if ($_ -is [int]) { $script:DesignExit = $_ } else { Write-Output $_ } }
    }
    catch {
        if ($_.Exception.Data['DesignSetup'] -or $_.Exception.Data['ExtSetup']) { Write-Output "design-image: $($_.Exception.Message)"; $script:DesignExit = 2 }
        else { Write-Output "design-image: failed: $($_.Exception.Message)"; $script:DesignExit = 1 }
    }
    finally {
        try { [Console]::OutputEncoding = $prevEnc } catch { }
    }
    exit $script:DesignExit
}
