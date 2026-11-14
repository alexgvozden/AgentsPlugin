<#
    review-page.ps1 - put what the user should look at on one HTML page and open
    it in their browser.

    Images named in a chat ("[image] docs/review/x.png") cannot be clicked open in
    Claude Code, so anything shown for review (screenshots, mockups, design images,
    HTML pages, pages of the running app) goes on one page, numbered, with the
    questions at the end. The user clicks "Looks good", "Change" or an option on
    each item, presses "Copy answer" and pastes "1 ok, 2: ..." in the chat, or
    just answers in the chat by number.

    The page is plugins/ag/templates/review/review.html with the spec put into its
    data block: items stacked full width, no scroll boxes, a full-screen image
    viewer (Fit, Width, 100%, drag, arrow keys), desktop and phone side by side,
    before and after (slider or side by side), pick-one options, wording tables,
    links, and the answer bar. Samples: docs/review-samples/ in the repository.

    Usage
        review-page.ps1 -Title <text> [-Intro <text>] [-Spec <file.json>]
                        [-Out <file.html>] [-Link] [-NoOpen] [<item> ...]

    An item is a path to an image or an HTML file, or an http(s) URL, optionally
    followed by "|<caption>", e.g. "docs/review/fix14-hub-1440.png|Jobs hub, 1440".
    An image under 600 pixels wide is shown in a phone frame.

    A spec file gives more (every field but "title" may be left out):
        { "id": "fix14", "title": "Fix 14: jobs hub", "project": "Shop",
          "summary": "What changed, in two lines.", "notes": ["Desktop 1440", "Phone 390"],
          "app": "http://localhost:3000/jobs",
          "items": [
            { "title": "Jobs hub", "tags": ["Step 3.2"], "look": ["The H1", "The filter row"],
              "shots": [ { "src": "docs/review/hub-1440.png", "device": "desktop", "label": "1440x900" },
                         { "src": "docs/review/hub-390.png",  "device": "phone",   "label": "390x844" } ] },
            { "title": "Error box", "compare": { "before": { "src": "old.png", "label": "today" },
                                                 "after":  { "src": "new.png", "label": "Fix 14" }, "mode": "slider" } },
            { "title": "Which hero?", "options": [ { "key": "A", "title": "Calm", "src": "a.png", "recommended": true,
                                                    "text": "...", "pros": ["..."], "cons": ["..."] },
                                                  { "key": "B", "title": "Bold", "src": "b.png" } ] },
            { "title": "New wording", "copy": [ { "where": "Error title", "before": "ERR 12", "after": "Could not import" } ] },
            { "title": "Try it", "answer": "none", "links": [ { "url": "http://localhost:3000/jobs", "label": "Jobs" } ] },
            { "path": "docs/review/x.png", "caption": "Old style item", "look": "what to check" },
            { "url": "http://localhost:3000/", "caption": "Old style URL item" } ],
          "questions": [ "Free text question?",
                         { "q": "Keep the banner?", "options": ["Yes", "No"], "recommended": "Yes", "why": "..." } ] }
    "device" is desktop, tablet or phone (default: phone under 600 pixels wide,
    else desktop). An item may also have "note" (a line under it) and "files"
    (paths listed under its answer). "answer": "none" makes an item that is only
    shown, not numbered. "intro" is read as "summary".
    -Title and -Intro override the spec's; items given as arguments come after the
    spec's items. Paths are relative to the current folder, else to the spec's.

    Images are embedded, so the page stands alone (and reads on a phone), unless
    -Link is given or they total over 25 MB; then they are linked: by a path
    relative to the page with -Link (for a page committed next to its images, like
    design/<folder>/review.html), else by file URL. Local HTML files in links and
    "app" are linked the same way.
    -Out defaults to <temp>/ag-review/<yyyyMMdd-HHmmss>-<slug>.html, outside the
    project, so git status stays clean.
    The page opens in the default browser, and so does each HTML file and URL given
    as an item (argument or "path"/"url" spec item) in its own tab, unless -NoOpen.
    Links inside "links" and "app" are only shown, not opened.

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
$PhoneMaxWidth = 600
$ImageTypes = @{ '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'; '.gif' = 'image/gif'; '.webp' = 'image/webp'; '.svg' = 'image/svg+xml'; '.avif' = 'image/avif' }
$Template = Join-Path (Join-Path (Join-Path (Split-Path -Parent $PSScriptRoot) 'templates') 'review') 'review.html'

function Fail([string]$Message) { [Console]::Error.WriteLine("review-page: $Message"); exit 2 }
function Has($Object, [string]$Name) {
    if ($null -eq $Object -or -not ($Object.PSObject.Properties.Name -contains $Name)) { return $false }
    $v = $Object.$Name
    return -not ($null -eq $v -or ($v -is [string] -and $v -eq ''))
}
function Set-Prop($Object, [string]$Name, $Value) {
    if ($Object.PSObject.Properties.Name -contains $Name) { $Object.$Name = $Value }
    else { $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value }
}
function IsRemote([string]$Url) { $Url -match '^(https?|data|blob|mailto|file):' }

if (-not (Test-Path -LiteralPath $Template)) { Fail "template not found: $Template" }

$s = $null
$specDir = ''
if ($Spec) {
    if (-not (Test-Path -LiteralPath $Spec)) { Fail "spec not found: $Spec" }
    $specFull = (Resolve-Path -LiteralPath $Spec).Path
    $specDir = Split-Path -Parent $specFull
    try { $s = [System.IO.File]::ReadAllText($specFull) | ConvertFrom-Json }
    catch { Fail "spec is not valid JSON: $Spec" }
}

# A local path, from the current folder, else from the spec's folder; $null if there is no such file.
function Find-Local([string]$Path) {
    if (-not $Path) { return $null }
    if (Test-Path -LiteralPath $Path -PathType Leaf) { return (Resolve-Path -LiteralPath $Path).Path }
    if ($specDir -and -not [System.IO.Path]::IsPathRooted($Path)) {
        $p = Join-Path $specDir $Path
        if (Test-Path -LiteralPath $p -PathType Leaf) { return (Resolve-Path -LiteralPath $p).Path }
    }
    return $null
}

# Images are kept by token and put into the JSON at the end, once it is known whether they are embedded.
$images = New-Object System.Collections.Generic.List[object]
$imageByPath = @{}
function Use-Image([string]$Src) {
    if (-not $Src) { Fail 'an image has an empty "src"' }
    if (IsRemote $Src) { return [pscustomobject]@{ Token = $Src; Width = 0 } }
    $full = Find-Local $Src
    if (-not $full) { Fail "file not found: $Src" }
    if ($imageByPath.ContainsKey($full)) { return $imageByPath[$full] }
    $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
    if (-not $ImageTypes.ContainsKey($ext)) { Fail "not an image: $Src" }
    $img = [pscustomobject]@{ Token = "__AG_IMG_$($images.Count)__"; Full = $full; Ext = $ext; Size = (Get-Item -LiteralPath $full).Length; Width = (Get-PngWidth $full) }
    $images.Add($img); $imageByPath[$full] = $img
    return $img
}
# Width of a PNG from its header; 0 for other formats.
function Get-PngWidth([string]$Full) {
    $fs = [System.IO.File]::OpenRead($Full)
    try {
        $b = New-Object byte[] 24
        if ($fs.Read($b, 0, 24) -lt 24 -or $b[1] -ne 0x50 -or $b[2] -ne 0x4E -or $b[3] -ne 0x47) { return 0 }
        return ([int]$b[16] -shl 24) -bor ([int]$b[17] -shl 16) -bor ([int]$b[18] -shl 8) -bor [int]$b[19]
    }
    finally { $fs.Dispose() }
}

# Local HTML files and other files in links: tokens too, linked by file URL or (with -Link) a relative path.
$files = New-Object System.Collections.Generic.List[object]
function Use-Link([string]$Url) {
    if (-not $Url -or (IsRemote $Url) -or $Url.StartsWith('#')) { return $Url }
    $hash = ''
    $i = $Url.IndexOf('#')
    if ($i -gt 0) { $hash = $Url.Substring($i); $Url = $Url.Substring(0, $i) }
    $full = Find-Local $Url
    if (-not $full) { Fail "file not found: $Url" }
    $f = [pscustomobject]@{ Token = "__AG_FILE_$($files.Count)__"; Full = $full; Hash = $hash }
    $files.Add($f)
    return $f.Token
}

$toOpen = New-Object System.Collections.Generic.List[string]

# An item given the old way: one image, HTML file, other file or URL with a caption and one "look" line.
function Convert-Simple([string]$Target, [string]$Caption, [string]$Look) {
    $item = [pscustomobject]@{ title = $Caption }
    if ($Look) { Set-Prop $item 'look' ([object[]]@($Look)) }
    if ($Target -match '^https?://') {
        if (-not $Caption) { $item.title = $Target }
        Set-Prop $item 'links' ([object[]]@([pscustomobject]@{ url = $Target; label = $Target }))
        $toOpen.Add($Target)
        return $item
    }
    $full = Find-Local $Target
    if (-not $full) { Fail "file not found: $Target" }
    $name = [System.IO.Path]::GetFileName($full)
    if (-not $Caption) { $item.title = $name }
    $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
    if ($ImageTypes.ContainsKey($ext)) {
        Set-Prop $item 'shots' ([object[]]@([pscustomobject]@{ src = $full; path = $full }))
    }
    else {
        Set-Prop $item 'links' ([object[]]@([pscustomobject]@{ url = $full; label = $name }))
        if ($ext -eq '.html' -or $ext -eq '.htm') { $toOpen.Add($full); Set-Prop $item 'note' 'Also opened in its own tab.' }
    }
    return $item
}

# ---- build the spec for the template ----
if (-not $Title -and (Has $s 'title')) { $Title = [string]$s.title }
if (-not $Title) { Fail 'give -Title (or "title" in the spec)' }
if (-not $Intro) { if (Has $s 'summary') { $Intro = [string]$s.summary } elseif (Has $s 'intro') { $Intro = [string]$s.intro } }

$itemList = New-Object System.Collections.Generic.List[object]
if (Has $s 'items') {
    foreach ($i in @($s.items)) {
        $isNew = $false
        foreach ($k in @('shots', 'compare', 'options', 'copy', 'links')) { if (Has $i $k) { $isNew = $true } }
        if ($isNew) { $itemList.Add($i); continue }
        $target = if (Has $i 'url') { [string]$i.url } elseif (Has $i 'path') { [string]$i.path } else { '' }
        if (-not $target) { Fail 'a spec item has none of "shots", "compare", "options", "copy", "links", "path" or "url"' }
        $caption = if (Has $i 'caption') { [string]$i.caption } elseif (Has $i 'title') { [string]$i.title } else { '' }
        $look = if (Has $i 'look') { (@($i.look) | ForEach-Object { [string]$_ }) -join '; ' } else { '' }
        $c = Convert-Simple $target $caption $look
        foreach ($k in @('tags', 'note', 'files', 'answer')) { if (Has $i $k) { Set-Prop $c $k $i.$k } }
        $itemList.Add($c)
    }
}
foreach ($a in $Items) {
    if (-not $a) { continue }
    $parts = $a.Split([char]'|', 2)
    $itemList.Add((Convert-Simple $parts[0].Trim() $(if ($parts.Count -gt 1) { $parts[1].Trim() } else { '' }) ''))
}
if ($itemList.Count -eq 0 -and -not (Has $s 'questions')) { Fail 'nothing to show: give image or HTML paths, URLs, or -Spec' }

# Resolve every image and local link before writing anything.
foreach ($it in $itemList) {
    if (Has $it 'shots') {
        $shots = [object[]]@($it.shots)
        foreach ($sh in $shots) {
            $given = [string]$sh.src
            $img = Use-Image $given
            if (-not (Has $sh 'device')) { Set-Prop $sh 'device' $(if ($img.Width -gt 0 -and $img.Width -le $PhoneMaxWidth) { 'phone' } else { 'desktop' }) }
            if (-not (Has $sh 'path') -and -not (IsRemote $given)) { Set-Prop $sh 'path' $given }
            $sh.src = $img.Token
        }
        $it.shots = $shots
    }
    if (Has $it 'compare') {
        foreach ($side in @('before', 'after')) {
            if (-not (Has $it.compare $side) -or -not (Has $it.compare.$side 'src')) { Fail "a compare item has no $side.src" }
            $it.compare.$side.src = (Use-Image ([string]$it.compare.$side.src)).Token
        }
    }
    if (Has $it 'options') {
        $opts = [object[]]@($it.options)
        foreach ($o in $opts) { if (Has $o 'src') { $o.src = (Use-Image ([string]$o.src)).Token } }
        $it.options = $opts
    }
    if (Has $it 'links') {
        $links = [object[]]@($it.links)
        foreach ($l in $links) { $l.url = Use-Link ([string]$l.url) }
        $it.links = $links
    }
    foreach ($k in @('copy', 'look', 'tags', 'files')) { if (Has $it $k) { $it.$k = [object[]]@($it.$k) } }
}

$doc = [ordered]@{}
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$slug = ($Title.ToLowerInvariant() -replace '[^a-z0-9]+', '-').Trim('-')
if ($slug.Length -gt 40) { $slug = $slug.Substring(0, 40).Trim('-') }
if (-not $slug) { $slug = 'review' }
$doc.id = if (Has $s 'id') { [string]$s.id } else { "$slug-$stamp" }
$doc.title = $Title
foreach ($k in @('project', 'when')) { if (Has $s $k) { $doc[$k] = [string]$s.$k } }
if ($Intro) { $doc.summary = $Intro }
$notes = @()
if (Has $s 'notes') { $notes = @($s.notes | ForEach-Object { [string]$_ }) }
if (Has $s 'app') { $doc.app = Use-Link ([string]$s.app) }
$doc.items = [object[]]$itemList.ToArray()
$doc.questions = [object[]]@()
if (Has $s 'questions') { $doc.questions = [object[]]@($s.questions) }
$doc.generated = Get-Date -Format 'd MMM yyyy, HH:mm'

if (-not $Out) { $Out = Join-Path (Join-Path ([System.IO.Path]::GetTempPath()) 'ag-review') ("$stamp-$slug.html") }
$Out = [System.IO.Path]::GetFullPath($Out)
$outDir = Split-Path -Parent $Out

$imageBytes = ($images | Measure-Object -Property Size -Sum).Sum
if ($null -eq $imageBytes) { $imageBytes = 0 }
$embed = (-not $Link) -and ($imageBytes -le $MaxEmbed)
$note = if ((-not $Link) -and (-not $embed)) { "Images total $([math]::Round($imageBytes / 1MB)) MB, so they are linked from this computer, not embedded." } else { '' }
if ($note) { $notes += 'Images linked, not embedded' }
if ($notes.Count -gt 0) { $doc.notes = [object[]]$notes }

function FileUrl([string]$Full) { ([System.Uri]$Full).AbsoluteUri }
function RelUrl([string]$Full) {
    $base = New-Object System.Uri (($outDir.TrimEnd('\', '/')) + [System.IO.Path]::DirectorySeparatorChar)
    $base.MakeRelativeUri((New-Object System.Uri $Full)).ToString()
}

# "</" and "<!--" never reach the page as such, so no text can close the data block.
$json = ($doc | ConvertTo-Json -Depth 30 -Compress).Replace('</', '<\/').Replace('<!--', '<' + [char]92 + 'u0021--')
foreach ($img in $images) {
    $src = if ($embed) { 'data:' + $ImageTypes[$img.Ext] + ';base64,' + [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($img.Full)) }
           elseif ($Link) { RelUrl $img.Full } else { FileUrl $img.Full }
    $json = $json.Replace($img.Token, $src)
}
foreach ($f in $files) {
    $json = $json.Replace($f.Token, $(if ($Link) { RelUrl $f.Full } else { FileUrl $f.Full }) + $f.Hash)
}

$html = [System.IO.File]::ReadAllText($Template)
if (-not $html.Contains('/*REVIEW_DATA*/')) { Fail "no /*REVIEW_DATA*/ in the template: $Template" }
$html = $html.Replace('/*REVIEW_DATA*/', $json)
if (-not (Test-Path -LiteralPath $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
[System.IO.File]::WriteAllText($Out, $html, (New-Object System.Text.UTF8Encoding $false))

function Open-Target([string]$Target) {
    if ($IsMacOS) { & open $Target }
    elseif ($IsLinux) { & xdg-open $Target 2>$null }
    else { Start-Process $Target }
}

# The same numbers as on the page: answerable items, then the questions.
Write-Output "review: $Out"
$n = 0
foreach ($it in $itemList) {
    if ((Has $it 'answer') -and $it.answer -eq 'none') { Write-Output ("  -. {0}" -f $it.title); continue }
    $n++; Write-Output ("  {0}. {1}" -f $n, $it.title)
}
foreach ($q in $doc.questions) { $n++; Write-Output ("  {0}. {1}" -f $n, $(if ($q -is [string]) { $q } else { $q.q })) }
if ($note) { Write-Output "  note: $note" }
if ($NoOpen) { Write-Output 'not opened (-NoOpen)' }
else {
    Open-Target $Out
    foreach ($t in $toOpen) { Open-Target $t }
    Write-Output 'opened in the browser'
}
exit 0
