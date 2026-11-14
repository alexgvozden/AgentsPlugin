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
# The spec the page carries, read back from its data block.
function Get-Data([string]$Html) {
    $m = [regex]::Match($Html, '<script type="application/json" id="review-data">(.*?)</script>', 'Singleline')
    if (-not $m.Success) { throw 'no data block' }
    $m.Groups[1].Value | ConvertFrom-Json
}

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
    $r = Run @('-Title', 'Fix 14 </script><review>', '-Out', $out1, '-NoOpen', "$img1|Hub & jobs, 1440", "$img2")
    Assert ($r.Code -eq 0) 'items as arguments: exit 0' $r.Out
    Assert (Test-Path $out1) 'page is written (folder made)'
    $h = Read-Text $out1
    $d = Get-Data $h
    Assert ($h.Contains('id="lb"') -and $h.Contains('id="copy"')) 'page is the template: image viewer and Copy answer'
    Assert ($d.items[0].shots[0].src -match '^data:image/png;base64,') 'images are embedded'
    Assert ($d.title -eq 'Fix 14 </script><review>' -and -not $h.Contains('</script><review>')) 'title survives and cannot close the data block'
    Assert ($d.items[0].title -eq 'Hub & jobs, 1440') 'caption is the item title'
    Assert ($d.items[1].title -eq 'company-390.png') 'no caption: the file name is the title'
    Assert ($d.items[0].shots[0].device -eq 'phone') 'a narrow image (1 px) goes in a phone frame'
    Assert ($d.items[0].shots[0].path -eq $img1) 'the shot keeps its path for the Files list'
    Assert ($d.id -match '^fix-14-script-review-\d{8}-\d{6}$') 'id from the title and time, so old answers do not carry over' $d.id
    Assert ($h.Contains('Copy answer') -and $h.Contains('name="viewport"')) 'answer bar; reads on a phone'
    Assert ($r.Out -match [regex]::Escape("review: $out1") -and $r.Out -match '1\. Hub & jobs, 1440' -and $r.Out -match '2\. company-390.png') 'prints the path and numbered items' $r.Out
    Assert ($r.Out -match 'not opened') '-NoOpen opens nothing' $r.Out

    # Old-style spec with look, a URL, an HTML page and questions; -Link makes relative links.
    $spec = Join-Path $root 'spec.json'
    $json = @{
        title = 'Design review'; intro = "Two pages.`nCheck the hero."
        items = @(@{ path = $img1; caption = 'Hub'; look = 'the H1 <fits>' }, @{ url = 'http://localhost:3000/jobs?a=1&b=2'; caption = 'Live jobs page' }, @{ path = $page; caption = 'Mock page' })
        questions = @('Is the H1 right?', 'Keep <b>bold</b>?')
    } | ConvertTo-Json -Depth 5
    [IO.File]::WriteAllText($spec, $json)
    $out2 = Join-Path $root 'review.html'
    $r = Run @('-Spec', $spec, '-Out', $out2, '-Link', '-NoOpen')
    Assert ($r.Code -eq 0) 'old spec: exit 0' $r.Out
    $h = Read-Text $out2
    $d = Get-Data $h
    Assert (-not ($h -match 'data:image')) '-Link does not embed'
    Assert ($d.items[0].shots[0].src -eq 'images/hub%201440.png') '-Link uses a path relative to the page' $d.items[0].shots[0].src
    Assert ($d.items[0].look[0] -eq 'the H1 <fits>') 'look is kept as a "Look at" line'
    Assert ($d.items[1].links[0].url -eq 'http://localhost:3000/jobs?a=1&b=2') 'URL item becomes a link'
    Assert ($d.items[2].links[0].url -eq 'mock.html') 'HTML item links to the file (relative with -Link)' $d.items[2].links[0].url
    Assert ($d.questions[0] -eq 'Is the H1 right?' -and $d.questions[1] -eq 'Keep <b>bold</b>?') 'questions are kept as text'
    Assert ($d.summary -eq "Two pages.`nCheck the hero.") 'intro becomes the summary'
    Assert ($r.Out -match '4\. Is the H1 right\?') 'questions are numbered after the items' $r.Out

    # -Title overrides the spec; argument items come after the spec's.
    $out3 = Join-Path $root 'r3.html'
    $r = Run @('-Spec', $spec, '-Title', 'Other', '-Out', $out3, '-NoOpen', "$img2|Extra")
    Assert ($r.Code -eq 0 -and (Get-Data (Read-Text $out3)).title -eq 'Other') '-Title overrides the spec' $r.Out
    Assert ($r.Out -match '4\. Extra') 'argument items come after the spec items' $r.Out

    # A full spec: shots with devices, compare, options, copy, links, an unnumbered item, objects as questions.
    $spec2 = Join-Path $root 'images\full.json'
    $full = [ordered]@{
        id = 'fix14'; title = 'Full'; project = 'Shop'; summary = 'S'; notes = @('Desktop 1440'); app = '../mock.html#jobs'
        items = @(
            [ordered]@{ title = 'Shots'; look = @('a', 'b'); shots = @(@{ src = 'hub 1440.png'; device = 'desktop'; label = '1440' }) },
            [ordered]@{ title = 'Cmp'; compare = @{ before = @{ src = 'hub 1440.png' }; after = @{ src = 'company-390.png' }; mode = 'slider' } },
            [ordered]@{ title = 'Pick'; options = @(@{ key = 'A'; src = 'company-390.png'; recommended = $true }) },
            [ordered]@{ title = 'Words'; copy = @(@{ where = 'w'; before = '</script>'; after = '<!-- x' }) },
            [ordered]@{ title = 'Try'; answer = 'none'; links = @(@{ url = 'https://example.com'; label = 'Ex' }) })
        questions = @(@{ q = 'Keep?'; options = @('Yes', 'No'); recommended = 'Yes' })
    }
    [IO.File]::WriteAllText($spec2, ($full | ConvertTo-Json -Depth 10))
    $out6 = Join-Path $root 'full.html'
    $r = Run @('-Spec', $spec2, '-Out', $out6, '-NoOpen')
    Assert ($r.Code -eq 0) 'full spec: exit 0 (paths relative to the spec)' $r.Out
    $h = Read-Text $out6
    $d = Get-Data $h
    Assert ($d.id -eq 'fix14' -and $d.project -eq 'Shop' -and $d.notes[0] -eq 'Desktop 1440') 'id, project and notes pass through'
    Assert ($d.app -match '^file:///.+mock\.html#jobs$') 'a local app link becomes a file URL, hash kept' $d.app
    Assert ($d.items[0].shots[0].device -eq 'desktop' -and @($d.items[0].look).Count -eq 2) 'a given device wins over the width'
    Assert ($d.items[1].compare.before.src -match '^data:image/png' -and $d.items[1].compare.after.src -match '^data:image/png') 'compare images are embedded'
    Assert (@($d.items[2].options)[0].src -match '^data:image/png' -and @($d.items[2].options)[0].recommended -eq $true) 'option images are embedded'
    Assert (@($d.items[3].copy)[0].before -eq '</script>' -and -not $h.Contains('"</script>"') -and -not $h.Contains('<!-- x')) 'copy text cannot break the page'
    Assert ($d.items[4].answer -eq 'none' -and @($d.items[4].links)[0].url -eq 'https://example.com') 'an item with answer none and links'
    Assert (@($d.questions)[0].options.Count -eq 2) 'a question with options'
    Assert ($r.Out -match '-\. Try' -and $r.Out -match '5\. Keep\?') 'unnumbered item; questions follow the numbered ones' $r.Out
    Assert ($h -match '"options":\[\{' -and $h -match '"copy":\[\{' -and $h -match '"questions":\[\{') 'one-element lists stay lists'

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
    $bad = Join-Path $root 'bad.json'
    [IO.File]::WriteAllText($bad, '{"title":"B","items":[{"title":"x","shots":[{"src":"missing.png"}]}]}')
    $r = Run @('-Spec', $bad, '-Out', $out4, '-NoOpen')
    Assert ($r.Code -eq 2 -and $r.Out -match 'file not found: missing.png' -and -not (Test-Path $out4)) 'a missing shot: exit 2, nothing written' $r.Out

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
