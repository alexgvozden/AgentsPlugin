<#
  keystore.ps1 - one API key store for the ag launchers (dot-source it).
  Providers: fireworks, gemini, openai. Any other provider is a setup error (exit 2).
    Windows (PowerShell 5.1): DPAPI current-user file ~/.claude/secrets/<provider>.key
    macOS (pwsh): Keychain via `security`, service ag-<provider>, account $env:USER
    Linux (pwsh): `secret-tool` when on PATH and it can store, else ~/.claude/secrets/<provider>.key (mode 600, not encrypted)
  The key is never printed or logged. The OS (-Os), the command runner (-Runner) and the
  "is this command on PATH" check (-HasCommand) can be injected, so tests mock each branch.
  Windows PowerShell 5.1 and PowerShell 7 compatible.
#>

$script:KeyProviders = @('fireworks', 'gemini', 'openai')
$script:KeyLabels = @{ fireworks = 'Fireworks'; gemini = 'Gemini'; openai = 'OpenAI' }
# {0} is ' <provider>' for providers other than fireworks (the default), else empty.
$script:KeySetHint = 'run ext-build.ps1 -SetKey{0} in your own PowerShell window'

function Stop-KeySetup([string]$Message) {
    $e = New-Object System.Exception $Message
    $e.Data['ExtSetup'] = $true
    throw $e
}

function Assert-KeyProvider([string]$Provider) {
    if ([string]::IsNullOrWhiteSpace($Provider)) { return 'fireworks' }
    $p = $Provider.Trim().ToLowerInvariant()
    if ($script:KeyProviders -notcontains $p) {
        Stop-KeySetup "unknown key provider '$Provider' (use one of: $($script:KeyProviders -join ', '))"
    }
    return $p
}

function Get-KeySetHint([string]$Provider) {
    $suffix = if ($Provider -eq 'fireworks') { '' } else { " $Provider" }
    return ($script:KeySetHint -f $suffix)
}

function Get-KeyOs([string]$Os) {
    if ($Os) { return $Os.ToLowerInvariant() }
    if (Get-Variable -Name IsMacOS -ValueOnly -ErrorAction SilentlyContinue) { return 'macos' }
    if (Get-Variable -Name IsLinux -ValueOnly -ErrorAction SilentlyContinue) { return 'linux' }
    return 'windows'
}

function Get-KeyHome {
    if ($env:USERPROFILE) { return $env:USERPROFILE }
    return $HOME
}

function Get-KeyUser {
    if ($env:USER) { return $env:USER }
    if ($env:USERNAME) { return $env:USERNAME }
    return [Environment]::UserName
}

function Get-KeyDefaultFile([string]$Provider) {
    return (Join-Path (Join-Path (Join-Path (Get-KeyHome) '.claude') 'secrets') ($Provider + '.key'))
}

function ConvertTo-KeyWinArg([string]$s) {
    if ($s -and $s -notmatch '[\s"]') { return $s }
    $q = $s -replace '(\\*)"', '$1$1\"'
    $q = $q -replace '(\\+)$', '$1$1'
    return '"' + $q + '"'
}

# Default runner: starts the command without a shell, writes $Stdin (no newline added) and
# returns ExitCode and Stdout. Stderr is captured and dropped, never printed.
$script:KeyRunner = {
    param([string]$Exe, [string[]]$ArgList, [string]$Stdin)
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $Exe
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    if ($null -ne $psi.PSObject.Properties['ArgumentList']) { foreach ($a in $ArgList) { $psi.ArgumentList.Add($a) } }
    else { $psi.Arguments = (@($ArgList | ForEach-Object { ConvertTo-KeyWinArg $_ }) -join ' ') }
    $proc = [System.Diagnostics.Process]::Start($psi)
    $errTask = $proc.StandardError.ReadToEndAsync()
    if ($Stdin) { $proc.StandardInput.Write($Stdin) }
    $proc.StandardInput.Close()
    $out = $proc.StandardOutput.ReadToEnd()
    $proc.WaitForExit()
    $null = $errTask.Result
    [pscustomobject]@{ ExitCode = $proc.ExitCode; Stdout = $out }
}

$script:KeyHasCommand = {
    param([string]$Name)
    return [bool](Get-Command -Name $Name -CommandType Application -ErrorAction SilentlyContinue)
}

function ConvertFrom-KeySecure([Security.SecureString]$Secure) {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($Secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringUni($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeGlobalAllocUnicode($ptr) }
}

# Which store a provider uses on this OS: windows-dpapi, macos-keychain, linux-secret-tool or linux-file.
function Get-KeyStoreKind([string]$Os, [scriptblock]$HasCommand) {
    $o = Get-KeyOs $Os
    if (-not $HasCommand) { $HasCommand = $script:KeyHasCommand }
    switch ($o) {
        'windows' { return 'windows-dpapi' }
        'macos' { return 'macos-keychain' }
        'linux' { if (& $HasCommand 'secret-tool') { return 'linux-secret-tool' } else { return 'linux-file' } }
        default { Stop-KeySetup "unsupported OS '$o' for the key store" }
    }
}

function Get-ProviderKey {
    param([string]$Provider, [string]$KeyFile, [string]$Os, [scriptblock]$Runner, [scriptblock]$HasCommand)
    $p = Assert-KeyProvider $Provider
    $label = $script:KeyLabels[$p]
    $hint = Get-KeySetHint $p
    if (-not $Runner) { $Runner = $script:KeyRunner }
    if (-not $KeyFile) { $KeyFile = Get-KeyDefaultFile $p }
    $kind = Get-KeyStoreKind $Os $HasCommand
    $user = Get-KeyUser
    $plain = $null
    switch ($kind) {
        'windows-dpapi' {
            if (-not (Test-Path -LiteralPath $KeyFile -PathType Leaf)) { Stop-KeySetup "$label key not found ($KeyFile): $hint" }
            try {
                $enc = ([IO.File]::ReadAllText($KeyFile)).Trim()
                if (-not $enc) { throw 'empty' }
                $plain = ConvertFrom-KeySecure (ConvertTo-SecureString -String $enc)
                if (-not $plain) { throw 'empty' }
            }
            catch { Stop-KeySetup "$label key in $KeyFile cannot be decrypted for this Windows user: $hint" }
        }
        'macos-keychain' {
            $r = & $Runner 'security' @('find-generic-password', '-s', "ag-$p", '-a', $user, '-w') ''
            if ($r.ExitCode -ne 0 -or -not ([string]$r.Stdout).Trim()) { Stop-KeySetup "$label key not found (Keychain service ag-$p): $hint" }
            $plain = ([string]$r.Stdout).Trim()
        }
        'linux-secret-tool' {
            $r = & $Runner 'secret-tool' @('lookup', 'service', "ag-$p", 'account', $user) ''
            if ($r.ExitCode -eq 0 -and ([string]$r.Stdout).Trim()) { $plain = ([string]$r.Stdout).Trim() }
            elseif (Test-Path -LiteralPath $KeyFile -PathType Leaf) {
                # -SetKey fell back to the mode-600 file when secret-tool could not store the key.
                $plain = ([IO.File]::ReadAllText($KeyFile)).Trim()
            }
            if (-not $plain) { Stop-KeySetup "$label key not found (secret-tool service ag-$p): $hint" }
        }
        'linux-file' {
            if (-not (Test-Path -LiteralPath $KeyFile -PathType Leaf)) { Stop-KeySetup "$label key not found ($KeyFile): $hint" }
            $plain = ([IO.File]::ReadAllText($KeyFile)).Trim()
            if (-not $plain) { Stop-KeySetup "$label key in $KeyFile is empty: $hint" }
        }
    }
    return $plain
}

function Test-ProviderKey {
    param([string]$Provider, [string]$KeyFile, [string]$Os, [scriptblock]$Runner, [scriptblock]$HasCommand)
    $p = Assert-KeyProvider $Provider
    try { $null = Get-ProviderKey -Provider $p -KeyFile $KeyFile -Os $Os -Runner $Runner -HasCommand $HasCommand; return $true }
    catch { if ($_.Exception.Data['ExtSetup']) { return $false } else { throw } }
}

# -Where: the store kind, the location and whether a key is set. Never the key itself.
function Get-ProviderKeyWhere {
    param([string]$Provider, [string]$KeyFile, [string]$Os, [scriptblock]$Runner, [scriptblock]$HasCommand)
    $p = Assert-KeyProvider $Provider
    if (-not $KeyFile) { $KeyFile = Get-KeyDefaultFile $p }
    $kind = Get-KeyStoreKind $Os $HasCommand
    $user = Get-KeyUser
    $location = switch ($kind) {
        'windows-dpapi' { "file $KeyFile (DPAPI, this Windows user)" }
        'macos-keychain' { "Keychain service ag-$p, account $user" }
        'linux-secret-tool' { "secret-tool attributes service=ag-$p account=$user (fallback file $KeyFile)" }
        'linux-file' { "file $KeyFile (mode 600, not encrypted)" }
    }
    $set = Test-ProviderKey -Provider $p -KeyFile $KeyFile -Os $Os -Runner $Runner -HasCommand $HasCommand
    return @("$p store: $kind", "$p location: $location", "$p key: $(if ($set) { 'set' } else { 'not set' })")
}

# Unix key file: the folder is set to 700 and the empty file to 600 before the key is written.
function Write-KeyFile([string]$KeyFile, [string]$Plain, [scriptblock]$Runner) {
    $dir = Split-Path -Parent $KeyFile
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $r = & $Runner 'chmod' @('700', $dir) ''
    if ($r.ExitCode -ne 0) { Stop-KeySetup "chmod 700 failed on $dir; key not written" }
    [IO.File]::WriteAllText($KeyFile, '')
    $r = & $Runner 'chmod' @('600', $KeyFile) ''
    if ($r.ExitCode -ne 0) { Stop-KeySetup "chmod 600 failed on $KeyFile; key not written" }
    [IO.File]::WriteAllText($KeyFile, $Plain)
}

# Stores the key; returns the lines to show the user (never the key itself).
function Set-ProviderKey {
    param([string]$Provider, [Security.SecureString]$Secure, [string]$KeyFile, [string]$Os, [scriptblock]$Runner, [scriptblock]$HasCommand)
    $p = Assert-KeyProvider $Provider
    if ($null -eq $Secure -or $Secure.Length -eq 0) { Stop-KeySetup 'no key entered; nothing written' }
    if (-not $Runner) { $Runner = $script:KeyRunner }
    if (-not $KeyFile) { $KeyFile = Get-KeyDefaultFile $p }
    $kind = Get-KeyStoreKind $Os $HasCommand
    $user = Get-KeyUser
    if ($kind -eq 'windows-dpapi') {
        $dir = Split-Path -Parent $KeyFile
        if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        # Create the file empty, lock it to the current user, then write the encrypted key.
        [IO.File]::WriteAllText($KeyFile, '')
        $r = & $Runner 'icacls.exe' @($KeyFile, '/inheritance:r', '/grant:r', "${env:USERNAME}:(R,W)") ''
        if ($r.ExitCode -ne 0) { Stop-KeySetup "icacls failed on $KeyFile; key not written" }
        [IO.File]::WriteAllText($KeyFile, (ConvertFrom-SecureString -SecureString $Secure))
        return @("key stored for $p (DPAPI, current user only) in $KeyFile")
    }
    $plain = ConvertFrom-KeySecure $Secure
    try {
        if ($plain -match '[\r\n]') { Stop-KeySetup 'the key contains a line break; nothing written' }
        switch ($kind) {
            'macos-keychain' {
                # The key goes to `security -i` on stdin, so it is not on any command line.
                $q = '"' + ($plain -replace '\\', '\\' -replace '"', '\"') + '"'
                $cmd = "add-generic-password -U -s ag-$p -a `"$user`" -l `"ag $p API key`" -w $q`n"
                $r = & $Runner 'security' @('-i') $cmd
                $cmd = $null
                if ($r.ExitCode -ne 0) { Stop-KeySetup "security could not store the key in the Keychain (exit $($r.ExitCode))" }
                # Read the key back and compare it in memory; neither value is ever printed.
                $back = $null
                try { $back = Get-ProviderKey -Provider $p -Os $Os -Runner $Runner -HasCommand $HasCommand }
                catch { if (-not $_.Exception.Data['ExtSetup']) { throw } }
                $same = ($back -ceq $plain)
                $back = $null
                if (-not $same) { Stop-KeySetup 'the Keychain did not keep the key (the key read back does not match); run -SetKey again' }
                return @("key stored for $p in the macOS Keychain (service ag-$p, account $user)")
            }
            'linux-secret-tool' {
                $r = & $Runner 'secret-tool' @('store', '--label', "ag $p API key", 'service', "ag-$p", 'account', $user) $plain
                if ($r.ExitCode -eq 0) { return @("key stored for $p with secret-tool (service ag-$p, account $user)") }
                # No unlocked keyring (or another secret-tool failure): fall back to the mode-600 file.
                Write-KeyFile $KeyFile $plain $Runner
                return @(
                    "secret-tool could not store the key (exit $($r.ExitCode)); stored it in $KeyFile instead (mode 600, readable only by you)",
                    'warning: this file is NOT encrypted; unlock your keyring and run -SetKey again to use it'
                )
            }
            'linux-file' {
                Write-KeyFile $KeyFile $plain $Runner
                return @(
                    "key stored for $p in $KeyFile (mode 600, readable only by you)",
                    'warning: this file is NOT encrypted (secret-tool not found); install libsecret-tools and run -SetKey again to use the keyring'
                )
            }
        }
    }
    finally { $plain = $null }
}
