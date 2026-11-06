# Self-test for design-image.ps1 (no Pester). No image API is ever called: the one HTTP
# function is replaced by a mock in this scope, and the child-process runs stop before any
# request (missing key, dry run, bad provider). The real key store is never read.
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File design-image.test.ps1
$ErrorActionPreference = 'Stop'
$launcher = Join-Path $PSScriptRoot 'design-image.ps1'
$script:fail = 0
$script:pass = 0

function Assert([bool]$Cond, [string]$Name, [string]$Detail = '') {
    if ($Cond) { $script:pass++; Write-Host "PASS $Name" }
    else { $script:fail++; Write-Host "FAIL $Name" -ForegroundColor Red; if ($Detail) { Write-Host $Detail } }
}

function Run-Launcher([string[]]$ArgList) {
    $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher @ArgList 2>&1 | Out-String
    [pscustomobject]@{ Code = $LASTEXITCODE; Out = $out }
}

$root = Join-Path ([IO.Path]::GetTempPath()) ('design-image-test-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$home2 = Join-Path $root 'home'
New-Item -ItemType Directory -Path (Join-Path $home2 '.claude') -Force | Out-Null
$oldProfile = $env:USERPROFILE
$env:USERPROFILE = $home2
try {
    $dummy = 'dummy-' + [guid]::NewGuid().ToString('N')
    $pngBytes = [byte[]](137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4)
    $b64 = [Convert]::ToBase64String($pngBytes)
    $geminiBody = ([ordered]@{ candidates = @(@{ content = @{ parts = @(@{ inlineData = @{ mimeType = 'image/png'; data = $b64 } }) } }) } | ConvertTo-Json -Depth 10 -Compress)
    $openaiBody = ([ordered]@{ data = @(@{ b64_json = $b64 }) } | ConvertTo-Json -Depth 10 -Compress)

    # --- load the launcher first: it only defines functions, then we replace the network seam ---
    . $launcher
    $realSend = ${function:Invoke-DesignHttpSend}
    # --- mock the single network seam (defined after the dot-source, so it wins) ---
    $script:lastReq = $null
    $script:calls = 0
    $script:status = 200
    $script:response = $geminiBody
    function Invoke-DesignHttpSend {
        param([string]$Url, [string]$Method, [hashtable]$Headers, [string]$Body, [int]$TimeoutSec = 180)
        $script:calls++
        $script:lastReq = [pscustomobject]@{ Url = $Url; Method = $Method; Headers = $Headers; Body = $Body }
        [pscustomobject]@{ StatusCode = $script:status; Content = $script:response; ErrorMessage = '' }
    }

    # --- 1. config order: user ~/.claude/design.json first, else the plugin default ---
    # a dummy DPAPI key in the fake home, so key lookups never touch the real store
    $keyFile = Join-Path $home2 '.claude\secrets\gemini.key'
    New-Item -ItemType Directory -Path (Split-Path $keyFile) -Force | Out-Null
    [IO.File]::WriteAllText($keyFile, (ConvertTo-SecureString $dummy -AsPlainText -Force | ConvertFrom-SecureString))
    $openaiKeyFile = Join-Path $home2 '.claude\secrets\openai.key'
    [IO.File]::WriteAllText($openaiKeyFile, (ConvertTo-SecureString $dummy -AsPlainText -Force | ConvertFrom-SecureString))
    $cfg = Read-DesignConfig ''
    Assert ($cfg.Path -match 'design\.default\.json$' -and $cfg.DefaultProvider -eq 'gemini') 'no user config -> plugin default (gemini)' $cfg.Path
    Assert ($cfg.Providers['gemini'].DefaultModel -eq 'gemini-3.1-flash-image') 'gemini default model from config'
    Assert ($cfg.Providers['openai'].DefaultModel -eq 'gpt-image-2') 'openai default model from config'
    Assert ($cfg.Providers['gemini'].BaseUrl -eq 'https://generativelanguage.googleapis.com/v1beta') 'gemini base url'
    Assert ($cfg.Providers['openai'].BaseUrl -eq 'https://api.openai.com/v1') 'openai base url'
    Assert ($cfg.DefaultSize -eq '1024x1024') 'default size'
    [IO.File]::WriteAllText((Join-Path $home2 '.claude\design.json'), (@{
                defaultProvider = 'openai'; defaultSize = '512x512'
                providers       = @{
                    gemini = @{ baseUrl = 'https://g.example/v1'; defaultModel = 'g-model' }
                    openai = @{ baseUrl = 'https://o.example/v1'; defaultModel = 'o-model' }
                }
            } | ConvertTo-Json -Depth 10))
    $cfgUser = Read-DesignConfig ''
    Assert ($cfgUser.Path -match 'home\\\.claude\\design\.json$' -and $cfgUser.DefaultProvider -eq 'openai') 'user config wins over the plugin default' $cfgUser.Path
    Assert ($cfgUser.DefaultSize -eq '512x512' -and $cfgUser.Providers['openai'].DefaultModel -eq 'o-model') 'user config values are used'
    Remove-Item -LiteralPath (Join-Path $home2 '.claude\design.json') -Force

    # --- 2. request shape for each provider (no network) ---
    $cfg = Read-DesignConfig ''
    $req = Get-DesignRequest $cfg 'gemini' 'gemini-3.1-flash-image' 'a login page' 'KEY-1'
    Assert ($req.Url -eq 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent') 'gemini url shape' $req.Url
    Assert ($req.Headers['x-goog-api-key'] -eq 'KEY-1' -and -not $req.Headers.ContainsKey('Authorization')) 'gemini auth header'
    Assert ($req.Body -match '"text":"a login page"' -and $req.Body -match 'responseModalities') 'gemini body shape' $req.Body
    $req = Get-DesignRequest $cfg 'openai' 'gpt-image-2' 'a login page' 'KEY-2'
    Assert ($req.Url -eq 'https://api.openai.com/v1/images/generations') 'openai url shape' $req.Url
    Assert ($req.Headers['Authorization'] -eq 'Bearer KEY-2') 'openai auth header'
    Assert ($req.Body -match '"model":"gpt-image-2"' -and $req.Body -match '"size":"1024x1024"' -and $req.Body -match '"prompt":"a login page"') 'openai body shape' $req.Body

    # --- 3. generation writes <slug>-<n>.png and a sidecar, using the right provider ---
    $outDir = Join-Path $root 'out-gemini'
    $script:calls = 0
    $script:status = 200; $script:response = $geminiBody
    $null = Invoke-DesignGenerate $cfg 'gemini' '' 'a login page' $outDir 1
    Assert ($script:calls -eq 1) 'gemini: one request per image'
    Assert ($script:lastReq.Url -match ':generateContent$') 'gemini: generate sent to generateContent'
    $png = Join-Path $outDir 'a-login-page-1.png'
    $md = Join-Path $outDir 'a-login-page-1.md'
    Assert (Test-Path -LiteralPath $png) 'gemini: png written as <slug>-1.png'
    Assert ((([IO.File]::ReadAllBytes($png)) -join ',') -eq ($pngBytes -join ',')) 'gemini: png bytes decoded from base64'
    Assert (Test-Path -LiteralPath $md) 'gemini: sidecar written as <slug>-1.md'
    $side = [IO.File]::ReadAllText($md)
    Assert ($side -match 'prompt: a login page' -and $side -match 'provider: gemini' -and $side -match 'model: gemini-3.1-flash-image' -and $side -match 'time: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}') 'sidecar has prompt, provider, model, time' $side

    $outDir2 = Join-Path $root 'out-openai'
    $script:calls = 0
    $script:response = $openaiBody
    $null = Invoke-DesignGenerate $cfg 'openai' '' 'a login page' $outDir2 2
    Assert ($script:calls -eq 2) 'openai: -Count 2 makes two requests'
    Assert ($script:lastReq.Headers['Authorization'] -match '^Bearer ') 'openai: bearer auth used'
    Assert ((Test-Path (Join-Path $outDir2 'a-login-page-1.png')) -and (Test-Path (Join-Path $outDir2 'a-login-page-2.png'))) 'openai: numbered files 1 and 2'
    Assert ([IO.File]::ReadAllText((Join-Path $outDir2 'a-login-page-2.md')) -match 'provider: openai') 'openai: sidecar names the provider'

    # --- 4. API error -> a failure (exit 1) that never shows the key ---
    $script:status = 401
    $script:response = '{"error":{"message":"bad key ' + $dummy + '"}}'
    $err = ''
    try { $null = Invoke-DesignGenerate $cfg 'gemini' '' 'a login page' (Join-Path $root 'out-fail') 1 }
    catch { $err = $_.Exception.Message }
    Assert ($err -match 'HTTP 401' -and -not $err.Contains($dummy) -and $err -match '\*\*\*') 'api error -> failure text, key masked' $err
    Assert (-not (Test-Path (Join-Path $root 'out-fail\a-login-page-1.png'))) 'api error writes no image'
    $script:status = 200; $script:response = $geminiBody

    # --- 5. -Check with the mock send: prints the OK line ---
    $script:status = 200; $script:response = $geminiBody
    $checkOut = (Invoke-DesignCheck 'gemini' $cfg '') -join "`n"
    Assert ($checkOut -match 'design-image check: OK') 'check prints OK' $checkOut

    # --- fix 16 (9): a user file with one model only is merged over the plugin default ---
    [IO.File]::WriteAllText((Join-Path $home2 '.claude\design.json'), '{"providers":{"gemini":{"defaultModel":"g-only"}}}')
    $cfgOne = Read-DesignConfig ''
    Remove-Item -LiteralPath (Join-Path $home2 '.claude\design.json') -Force
    Assert ($cfgOne.Providers['gemini'].DefaultModel -eq 'g-only' -and $cfgOne.Providers['gemini'].BaseUrl -eq 'https://generativelanguage.googleapis.com/v1beta' -and $cfgOne.Providers['openai'].DefaultModel -eq 'gpt-image-2' -and $cfgOne.DefaultProvider -eq 'gemini') 'user file with one model merges key by key over the default'

    # --- fix 16 (2), (3): the real send, with Invoke-WebRequest mocked (no network) ---
    function Invoke-WebRequest {
        param($Uri, $Method, $Headers, $Body, $ContentType, $TimeoutSec, [switch]$UseBasicParsing)
        $script:iwr = [pscustomobject]@{ Body = $Body; ContentType = $ContentType }
        if ($script:iwrFail) {
            $er = New-Object System.Management.Automation.ErrorRecord((New-Object System.Exception 'The remote server returned an error: (400) Bad Request.'), 'WebFail', 'InvalidOperation', $null)
            $er.ErrorDetails = New-Object System.Management.Automation.ErrorDetails('{"error":{"message":"API key not valid: ' + $dummy + '"}}')
            throw $er
        }
        [pscustomobject]@{ StatusCode = 200; Content = '{}' }
    }
    $script:iwrFail = $false
    $uni = '{"text":"caf' + [char]0xE9 + ' ' + [char]0x2713 + '"}'
    $null = & $realSend -Url 'https://x.example' -Method 'POST' -Headers @{} -Body $uni
    $sent = $script:iwr.Body
    Assert ($sent -is [byte[]] -and [Text.Encoding]::UTF8.GetString($sent) -eq $uni -and $sent.Length -eq ($uni.Length + 3) -and $script:iwr.ContentType -eq 'application/json; charset=utf-8') 'body sent as UTF-8 bytes with charset=utf-8' "$($script:iwr.ContentType)"
    $script:iwrFail = $true
    $resp = & $realSend -Url 'https://x.example' -Method 'POST' -Headers @{} -Body '{}'
    $script:iwrFail = $false
    $shown = Get-DesignErrorText $resp $dummy
    Remove-Item -LiteralPath function:Invoke-WebRequest
    Assert ($shown -match 'API key not valid' -and -not $shown.Contains($dummy) -and $shown -match '\*\*\*') 'API error text from ErrorDetails reaches the user, key masked' $shown

    # --- fix 16 (11): no image -> text / finishReason in the error; extension follows mimeType ---
    $script:status = 200
    $script:response = '{"candidates":[{"content":{"parts":[{"text":"I cannot draw that."}]},"finishReason":"IMAGE_SAFETY"}]}'
    $err = ''
    try { $null = Invoke-DesignGenerate $cfg 'gemini' '' 'a login page' (Join-Path $root 'out-noimg') 1 } catch { $err = $_.Exception.Message }
    Assert ($err -match 'I cannot draw that' -and $err -match 'IMAGE_SAFETY') 'gemini no image -> its text and finishReason in the error' $err
    $script:response = ([ordered]@{ candidates = @(@{ content = @{ parts = @(@{ inlineData = @{ mimeType = 'image/jpeg'; data = $b64 } }) } }) } | ConvertTo-Json -Depth 10 -Compress)
    $jpgDir = Join-Path $root 'out-jpg'
    $null = Invoke-DesignGenerate $cfg 'gemini' '' 'a login page' $jpgDir 1
    Assert ((Test-Path (Join-Path $jpgDir 'a-login-page-1.jpg')) -and -not (Test-Path (Join-Path $jpgDir 'a-login-page-1.png')) -and ([IO.File]::ReadAllText((Join-Path $jpgDir 'a-login-page-1.md')) -match '# a-login-page-1\.jpg')) 'image/jpeg -> .jpg file, sidecar names it'
    $script:response = $geminiBody

    # --- 6. child process: missing key exits 2 with the -SetKey hint, no request made ---
    $noKeyHome = Join-Path $root 'home-nokey'
    New-Item -ItemType Directory -Path (Join-Path $noKeyHome '.claude') -Force | Out-Null
    $env:USERPROFILE = $noKeyHome
    $r = Run-Launcher @('-Prompt', 'a login page', '-Provider', 'gemini', '-Out', (Join-Path $root 'out-nokey'))
    Assert ($r.Code -eq 2) 'missing key exit 2' "code $($r.Code): $($r.Out)"
    Assert ($r.Out -match 'run design-image\.ps1 -SetKey gemini in your own PowerShell window') 'missing key shows the -SetKey hint' $r.Out
    Assert (-not (Test-Path (Join-Path $root 'out-nokey'))) 'missing key writes nothing'
    $r = Run-Launcher @('-Check', 'openai')
    Assert ($r.Code -eq 2 -and $r.Out -match '-SetKey openai') 'check with no key exit 2 + hint' "code $($r.Code): $($r.Out)"
    $r = Run-Launcher @('-Prompt', 'a login page', '-Provider', 'bogus')
    Assert ($r.Code -eq 2 -and $r.Out -match "unknown provider 'bogus'") 'unknown provider exit 2' "code $($r.Code): $($r.Out)"
    $r = Run-Launcher @('-DryRun', '-Prompt', 'x', '-Config', (Join-Path $root 'none.json'))
    Assert ($r.Code -eq 2 -and $r.Out -match 'config not found') 'missing config exit 2' "code $($r.Code): $($r.Out)"
    $r = Run-Launcher @('-DryRun')
    Assert ($r.Code -eq 2 -and $r.Out -match 'give a prompt') 'no prompt exit 2' "code $($r.Code): $($r.Out)"

    # --- 7. dry run: no key needed, key shown as ***, nothing written, no request ---
    $dryOut = Join-Path $root 'out-dry'
    $r = Run-Launcher @('-DryRun', '-Prompt', 'a login page', '-Out', $dryOut)
    Assert ($r.Code -eq 0) 'dry run exit 0' "code $($r.Code): $($r.Out)"
    Assert ($r.Out -match 'gemini-3.1-flash-image') 'dry run names the provider model' $r.Out
    Assert ($r.Out -match ':generateContent' -and $r.Out -match 'x-goog-api-key: \*\*\*') 'dry run shows the request with the key masked' $r.Out
    Assert (-not $r.Out.Contains($dummy)) 'dry run never shows a key'
    Assert ($r.Out -match 'would write .*a-login-page-1\.png' -and $r.Out -match 'would write .*a-login-page-1\.md') 'dry run names the files it would write' $r.Out
    Assert (-not (Test-Path $dryOut)) 'dry run writes nothing'
    $r = Run-Launcher @('-DryRun', '-Prompt', 'a login page', '-Provider', 'openai', '-Model', 'gpt-image-2-x')
    Assert ($r.Code -eq 0 -and $r.Out -match 'images/generations' -and $r.Out -match 'Bearer \*\*\*' -and $r.Out -match 'gpt-image-2-x') 'dry run openai shape with -Model override' $r.Out
    $pf = Join-Path $root 'prompt.md'
    [IO.File]::WriteAllText($pf, 'a pricing page')
    $r = Run-Launcher @('-DryRun', '-PromptFile', $pf)
    Assert ($r.Code -eq 0 -and $r.Out -match 'a pricing page' -and $r.Out -match 'a-pricing-page-1\.png') '-PromptFile is read and slugged' $r.Out
}
finally {
    $env:USERPROFILE = $oldProfile
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "design-image tests: $script:pass passed, $script:fail failed"
if ($script:fail) { exit 1 } else { exit 0 }
