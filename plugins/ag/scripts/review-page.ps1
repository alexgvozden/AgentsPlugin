<#
    review-page.ps1 - put what the user should look at on one HTML page and open
    it in their browser.

    Images named in a chat ("[image] docs/review/x.png") cannot be clicked open in
    Claude Code, so anything shown for review (screenshots, mockups, design images,
    HTML pages, pages of the running app) goes on one page, numbered, with the
    questions at the end; the user answers in the chat by number.

    Usage
        review-page.ps1 -Title <text> [-Intro <text>] [-Spec <file.json>]
                        [-Out <file.html>] [-Link] [-NoOpen] [<item> ...]

    An item is a path to an image or an HTML file, or an http(s) URL, optionally
    followed by "|<caption>", e.g. "docs/review/fix14-hub-1440.png|Jobs hub, 1440".
    A spec file gives more:
        { "title": "...", "intro": "...",
          "items": [ { "path": "a.png", "caption": "...", "look": "what to check" },
                     { "url": "http://localhost:3000/jobs", "caption": "..." } ],
          "questions": [ "Is the H1 right?", "..." ] }
    -Title and -Intro override the spec's; items given as arguments come after the
    spec's items.

    Images are embedded, so the page stands alone (and reads on a phone), unless
    -Link is given or they total over 25 MB; then they are linked: by a path
    relative to the page with -Link (for a page committed next to its images, like
    design/<folder>/review.html), else by file URL.
    -Out defaults to <temp>/ag-review/<yyyyMMdd-HHmmss>-<slug>.html, outside the
    project, so git status stays clean.
    The page opens in the default browser, and so does each HTML file and URL item
    in its own tab, unless -NoOpen.

    Exit 0 ok; 2 bad arguments or a missing file (nothing is written).
    Windows PowerShell 5.1 compatible; pwsh on macOS and Linux.
#>
[CmdletBinding(PositionalBinding = $false)]
param(
    [string]$Title = '',
    [string]$Intro = '',
    [string]$Spec = '',
    [string]$Out = '',
    [switch]$Link,
    [switch]$NoOpen,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Items = @()
)

$ErrorActionPreference = 'Stop'
$MaxEmbed = 25MB
$ImageTypes = @{ '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'; '.gif' = 'image/gif'; '.webp' = 'image/webp'; '.svg' = 'image/svg+xml'; '.avif' = 'image/avif' }

function Fail([string]$Message) { [Console]::Error.WriteLine("review-page: $Message"); exit 2 }
function Enc([string]$Text) { [System.Net.WebUtility]::HtmlEncode($Text) }
function Has($Object, [string]$Name) { ($null -ne $Object) -and ($Object.PSObject.Properties.Name -contains $Name) -and $Object.$Name }

$list = New-Object System.Collections.Generic.List[object]
$questions = @()

if ($Spec) {
    if (-not (Test-Path -LiteralPath $Spec)) { Fail "spec not found: $Spec" }
    try { $s = [System.IO.File]::ReadAllText((Resolve-Path -LiteralPath $Spec).Path) | ConvertFrom-Json }
    catch { Fail "spec is not valid JSON: $Spec" }
    if (-not $Title -and (Has $s 'title')) { $Title = [string]$s.title }
    if (-not $Intro -and (Has $s 'intro')) { $Intro = [string]$s.intro }
    if (Has $s 'items') {
        foreach ($i in @($s.items)) {
            $target = if (Has $i 'url') { [string]$i.url } elseif (Has $i 'path') { [string]$i.path } else { '' }
            if (-not $target) { Fail 'a spec item has neither "path" nor "url"' }
            $list.Add([pscustomobject]@{ Target = $target; Caption = $(if (Has $i 'caption') { [string]$i.caption } else { '' }); Look = $(if (Has $i 'look') { [string]$i.look } else { '' }) })
        }
    }
    if (Has $s 'questions') { $questions = @($s.questions | ForEach-Object { [string]$_ }) }
}
foreach ($a in $Items) {
    if (-not $a) { continue }
    $parts = $a.Split([char]'|', 2)
    $list.Add([pscustomobject]@{ Target = $parts[0].Trim(); Caption = $(if ($parts.Count -gt 1) { $parts[1].Trim() } else { '' }); Look = '' })
}
if (-not $Title) { Fail 'give -Title (or "title" in the spec)' }
if ($list.Count -eq 0) { Fail 'nothing to show: give image or HTML paths, URLs, or -Spec' }

# Resolve every item before writing anything.
$resolved = foreach ($i in $list) {
    if ($i.Target -match '^https?://') {
        [pscustomobject]@{ Kind = 'url'; Full = $i.Target; Name = $i.Target; Caption = $i.Caption; Look = $i.Look; Size = 0 }
        continue
    }
    if (-not (Test-Path -LiteralPath $i.Target -PathType Leaf)) { Fail "file not found: $($i.Target)" }
    $full = (Resolve-Path -LiteralPath $i.Target).Path
    $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
    $kind = if ($ImageTypes.ContainsKey($ext)) { 'image' } elseif ($ext -eq '.html' -or $ext -eq '.htm') { 'html' } else { 'file' }
    [pscustomobject]@{ Kind = $kind; Full = $full; Name = [System.IO.Path]::GetFileName($full); Caption = $i.Caption; Look = $i.Look; Size = (Get-Item -LiteralPath $full).Length; Ext = $ext }
}
$resolved = @($resolved)

if (-not $Out) {
    $slug = ($Title.ToLowerInvariant() -replace '[^a-z0-9]+', '-').Trim('-')
    if ($slug.Length -gt 40) { $slug = $slug.Substring(0, 40).Trim('-') }
    if (-not $slug) { $slug = 'review' }
    $Out = Join-Path (Join-Path ([System.IO.Path]::GetTempPath()) 'ag-review') ((Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $slug + '.html')
}
$Out = [System.IO.Path]::GetFullPath($Out)
$outDir = Split-Path -Parent $Out
if (-not (Test-Path -LiteralPath $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }

$imageBytes = ($resolved | Where-Object { $_.Kind -eq 'image' } | Measure-Object -Property Size -Sum).Sum
$embed = (-not $Link) -and ($imageBytes -le $MaxEmbed)
$note = if ((-not $Link) -and (-not $embed)) { "Images total $([math]::Round($imageBytes / 1MB)) MB, so they are linked from this computer, not embedded." } else { '' }

function FileUrl([string]$Full) { ([System.Uri]$Full).AbsoluteUri }
function RelUrl([string]$Full) {
    $base = New-Object System.Uri (($outDir.TrimEnd('\', '/')) + [System.IO.Path]::DirectorySeparatorChar)
    $base.MakeRelativeUri((New-Object System.Uri $Full)).ToString()
}

$cards = New-Object System.Text.StringBuilder
$n = 0
foreach ($r in $resolved) {
    $n++
    $label = if ($r.Caption) { $r.Caption } else { $r.Name }
    [void]$cards.Append("<section class=""card"" id=""i$n""><h2><span class=""n"">$n</span> $(Enc $label)</h2>")
    if ($r.Look) { [void]$cards.Append("<p class=""look"">Look at: $(Enc $r.Look)</p>") }
    switch ($r.Kind) {
        'image' {
            if ($embed) { $src = 'data:' + $ImageTypes[$r.Ext] + ';base64,' + [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($r.Full)) }
            elseif ($Link) { $src = RelUrl $r.Full }
            else { $src = FileUrl $r.Full }
            [void]$cards.Append("<img src=""$src"" alt=""$(Enc $label)"" title=""Click to see it at full size"">")
        }
        'html' { [void]$cards.Append("<p>HTML page, opened in its own tab: <a href=""$(FileUrl $r.Full)"" target=""_blank"">$(Enc $r.Name)</a></p>") }
        'url' { [void]$cards.Append("<p>Opened in its own tab: <a href=""$(Enc $r.Full)"" target=""_blank"">$(Enc $r.Full)</a></p>") }
        default { [void]$cards.Append("<p>File: <a href=""$(FileUrl $r.Full)"">$(Enc $r.Name)</a></p>") }
    }
    if ($r.Kind -ne 'url') { [void]$cards.Append("<p class=""path"">$(Enc $r.Full)</p>") }
    [void]$cards.Append('</section>')
}

$qs = ''
if ($questions.Count -gt 0) {
    $qs = '<section class="questions"><h2>Questions</h2><ol>' + (($questions | ForEach-Object { '<li>' + (Enc $_) + '</li>' }) -join '') + '</ol></section>'
}
$introHtml = if ($Intro) { '<p class="intro">' + ((Enc $Intro) -replace "`r?`n", '<br>') + '</p>' } else { '' }
$noteHtml = if ($note) { '<p class="note">' + (Enc $note) + '</p>' } else { '' }
$stamp = Get-Date -Format 'd MMM yyyy, HH:mm'

$html = @"
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>$(Enc $Title)</title>
<style>
body{margin:0;background:#f4f4f2;color:#1d1d1b;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1500px;margin:0 auto;padding:20px 16px 48px}
h1{font-size:1.5rem;margin:0 0 4px}.meta{color:#6b6b66;font-size:.85rem;margin:0 0 16px}
.intro{background:#fff;border-left:4px solid #3b6fd8;padding:10px 14px;margin:0 0 16px}
.note{color:#8a5a00}
.grid{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}
.card{background:#fff;border:1px solid #dddcd6;border-radius:8px;padding:12px;flex:1 1 360px;max-width:100%;box-sizing:border-box;overflow:auto}
.card h2{font-size:1.05rem;margin:0 0 8px}.n{display:inline-block;min-width:1.6em;text-align:center;background:#1d1d1b;color:#fff;border-radius:4px;margin-right:6px}
.look{margin:0 0 8px;color:#3b3b38}
.card img{display:block;max-width:100%;height:auto;border:1px solid #eee;cursor:zoom-in}
.card img.full{max-width:none;cursor:zoom-out}
.path{font:12px ui-monospace,Consolas,monospace;color:#8a8a84;word-break:break-all;margin:8px 0 0}
.questions{background:#fff;border:1px solid #dddcd6;border-radius:8px;padding:12px 16px;margin-top:20px}
.questions h2{font-size:1.1rem;margin:0}
footer{margin-top:20px;color:#6b6b66}
</style></head><body><main>
<h1>$(Enc $Title)</h1><p class="meta">$stamp &middot; $($resolved.Count) item(s)</p>
$introHtml$noteHtml
<div class="grid">$($cards.ToString())</div>
$qs
<footer>Answer in the chat by number, for example "1 ok, 2: the heading is too long".</footer>
</main>
<script>document.querySelectorAll('.card img').forEach(function(i){i.addEventListener('click',function(){i.classList.toggle('full')})})</script>
</body></html>
"@

[System.IO.File]::WriteAllText($Out, $html, (New-Object System.Text.UTF8Encoding $false))

function Open-Target([string]$Target) {
    if ($IsMacOS) { & open $Target }
    elseif ($IsLinux) { & xdg-open $Target 2>$null }
    else { Start-Process $Target }
}

Write-Output "review: $Out"
$n = 0
foreach ($r in $resolved) { $n++; Write-Output ("  {0}. {1}" -f $n, $(if ($r.Caption) { $r.Caption } else { $r.Name })) }
if ($note) { Write-Output "  note: $note" }
if ($NoOpen) { Write-Output 'not opened (-NoOpen)' }
else {
    Open-Target $Out
    foreach ($r in $resolved) { if ($r.Kind -eq 'html' -or $r.Kind -eq 'url') { Open-Target $r.Full } }
    Write-Output 'opened in the browser'
}
exit 0
