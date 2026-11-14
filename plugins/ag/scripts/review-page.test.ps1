# Self-test for review-page.ps1 (no Pester). Works in a temp folder only; never opens a browser.
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File review-page.test.ps1
$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'review-page.ps1'
$script:fail = 0
$script:pass = 0

function Assert([bool]$Cond, [string]$Name, [string]$Detail = '') {
    if ($Cond) { $script:pass++; Write-Host "PASS $Name" }
    else { $script:fail++; Write-Host "FAIL $Name" -ForegroundColor Red; if ($Detail) { Write-Host $Detail } }
}

function Run([string[]]$ArgList) {
    $ErrorActionPreference = 'Continue'
    $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script @ArgList 2>&1 | Out-String
    [pscustomobject]@{ Code = $LASTEXITCODE; Out = $out }
}

function Read-Text([string]$Path) { [System.IO.File]::ReadAllText($Path) }

$root = Join-Path ([IO.Path]::GetTempPath()) ('review-page-test-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path (Join-Path $root 'images') -Force | Out-Null
# A 1x1 PNG.
$png = [Convert]::FromBase64String('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==')
$img1 = Join-Path $root 'images\hub 1440.png'
$img2 = Join-Path $root 'images\company-390.png'
[IO.File]::WriteAllBytes($img1, $png)
[IO.File]::WriteAllBytes($img2, $png)
$page = Join-Path $root 'mock.html'
[IO.File]::WriteAllText($page, '<html><body>mock</body></html>')
try {
    # Items as arguments, embedded.
    $out1 = Join-Path $root 'out\r1.html'
    $r = Run @('-Title', 'Fix 14 <review>', '-Out', $out1, '-NoOpen', "$img1|Hub & jobs, 1440", "$img2")
    Assert ($r.Code -eq 0) 'items as arguments: exit 0' $r.Out
    Assert (Test-Path $out1) 'page is written (folder made)'
    $h = Read-Text $out1
    Assert ($h -match 'data:image/png;base64,') 'images are embedded'
    Assert ($h.Contains('Fix 14 &lt;review&gt;') -and -not $h.Contains('<review>')) 'title is HTML-escaped'
    Assert ($h.Contains('Hub &amp; jobs, 1440')) 'caption is HTML-escaped'
    Assert ($h.Contains('company-390.png')) 'no caption: the file name is the label'
    Assert ($h.Contains('Answer in the chat by number')) 'page says to answer in the chat'
    Assert ($h.Contains('name="viewport"')) 'page reads on a phone'
    Assert ($r.Out -match [regex]::Escape("review: $out1") -and $r.Out -match '1\. Hub & jobs, 1440' -and $r.Out -match '2\. company-390.png') 'prints the path and numbered items' $r.Out
    Assert ($r.Out -match 'not opened') '-NoOpen opens nothing' $r.Out

    # Spec with look, a URL, an HTML page and questions; -Link makes relative links.
    $spec = Join-Path $root 'spec.json'
    $json = @{
        title = 'Design review'; intro = "Two pages.`nCheck the hero."
        items = @(@{ path = $img1; caption = 'Hub'; look = 'the H1 <fits>' }, @{ url = 'http://localhost:3000/jobs?a=1&b=2'; caption = 'Live jobs page' }, @{ path = $page; caption = 'Mock page' })
        questions = @('Is the H1 right?', 'Keep <b>bold</b>?')
    } | ConvertTo-Json -Depth 5
    [IO.File]::WriteAllText($spec, $json)
    $out2 = Join-Path $root 'review.html'
    $r = Run @('-Spec', $spec, '-Out', $out2, '-Link', '-NoOpen')
    Assert ($r.Code -eq 0) 'spec: exit 0' $r.Out
    $h = Read-Text $out2
    Assert (-not ($h -match 'data:image')) '-Link does not embed'
    Assert ($h.Contains('src="images/hub%201440.png"')) '-Link uses a path relative to the page' ($h | Select-String -Pattern 'src="[^"]*"' -AllMatches | ForEach-Object { $_.Matches.Value } | Out-String)
    Assert ($h.Contains('Look at: the H1 &lt;fits&gt;')) 'look is shown, escaped'
    Assert ($h.Contains('http://localhost:3000/jobs?a=1&amp;b=2')) 'URL item is a link, escaped'
    Assert ($h.Contains('file:///') -and $h.Contains('mock.html')) 'HTML item links to the file'
    Assert ($h.Contains('<li>Is the H1 right?</li>') -and $h.Contains('<li>Keep &lt;b&gt;bold&lt;/b&gt;?</li>')) 'questions are listed, escaped'
    Assert ($h.Contains('Two pages.<br>Check the hero.')) 'intro keeps its lines'

    # -Title overrides the spec; argument items come after the spec's.
    $out3 = Join-Path $root 'r3.html'
    $r = Run @('-Spec', $spec, '-Title', 'Other', '-Out', $out3, '-NoOpen', "$img2|Extra")
    Assert ($r.Code -eq 0 -and (Read-Text $out3).Contains('<title>Other</title>')) '-Title overrides the spec' $r.Out
    Assert ($r.Out -match '4\. Extra') 'argument items come after the spec items' $r.Out

    # Default output goes to temp, not the project.
    $r = Run @('-Title', 'Temp default', '-NoOpen', $img2)
    $m = [regex]::Match($r.Out, 'review: (.+\.html)')
    Assert ($r.Code -eq 0 -and $m.Success -and $m.Groups[1].Value.Trim().Contains('ag-review') -and (Test-Path $m.Groups[1].Value.Trim())) 'default output is <temp>/ag-review' $r.Out
    if ($m.Success) { Remove-Item -LiteralPath $m.Groups[1].Value.Trim() -Force -ErrorAction SilentlyContinue }

    # Bad arguments write nothing.
    $out4 = Join-Path $root 'bad.html'
    $r = Run @('-Title', 'Missing', '-Out', $out4, '-NoOpen', (Join-Path $root 'nope.png'))
    Assert ($r.Code -eq 2 -and $r.Out -match 'file not found' -and -not (Test-Path $out4)) 'a missing file: exit 2, nothing written' $r.Out
    $r = Run @('-Out', $out4, '-NoOpen', $img1)
    Assert ($r.Code -eq 2 -and $r.Out -match '-Title' -and -not (Test-Path $out4)) 'no title: exit 2' $r.Out
    $r = Run @('-Title', 'Empty', '-Out', $out4, '-NoOpen')
    Assert ($r.Code -eq 2 -and $r.Out -match 'nothing to show') 'no items: exit 2' $r.Out

    # The entry point (~/.claude/ag/review-page.ps1): the newest installed version that has the script, else the checkout.
    $entry = Join-Path $PSScriptRoot 'review-page-entry.ps1'
    . $entry
    $ch = Join-Path $root 'home'
    $cache = Join-Path $ch 'plugins\cache\agents-plugin\ag'
    foreach ($v in @('1.9.0', '1.10.0', '1.11.0')) { New-Item -ItemType Directory -Path (Join-Path $cache "$v\scripts") -Force | Out-Null }
    foreach ($v in @('1.9.0', '1.10.0')) { [IO.File]::WriteAllText((Join-Path $cache "$v\scripts\review-page.ps1"), '') }
    $co = Join-Path $root 'checkout'
    New-Item -ItemType Directory -Path (Join-Path $co 'plugins\ag\scripts') -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $co 'plugins\ag\scripts\review-page.ps1'), '')
    $newest = Resolve-ReviewPage $ch $co
    $fallback = Resolve-ReviewPage (Join-Path $root 'nohome') $co
    Assert ($newest -eq "$cache\1.10.0\scripts\review-page.ps1" -and $fallback -eq "$co\plugins\ag\scripts\review-page.ps1") 'entry: newest version with the script wins (1.11.0 lacks it), else the checkout' "$newest | $fallback"
    Assert ($null -eq (Resolve-ReviewPage (Join-Path $root 'nohome') '__AG_CHECKOUT__')) 'entry: nothing found without an install'

    # The entry passes every argument through and the exit code back (run against this checkout).
    $installed = Join-Path $root 'entry.ps1'
    $repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
    [IO.File]::WriteAllText($installed, ([IO.File]::ReadAllText($entry)).Replace("'__AG_CHECKOUT__'", "'" + $repo + "'"))
    $out5 = Join-Path $root 'via entry.html'
    $ErrorActionPreference = 'Continue'
    $o = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installed -Title 'Via entry' -Out $out5 -NoOpen "$img1|Caption with spaces" 2>&1 | Out-String
    $code = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    Assert ($code -eq 0 -and (Test-Path -LiteralPath $out5) -and (Read-Text $out5).Contains('Caption with spaces')) 'entry: arguments reach review-page.ps1' "$code $o"
}
finally {
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host "$($script:pass) passed, $($script:fail) failed"
if ($script:fail -gt 0) { exit 1 }
exit 0
