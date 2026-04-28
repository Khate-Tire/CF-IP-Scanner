<#
.SYNOPSIS
    Generates a fresh release keystore for the Khate Tire CF-IP-Scanner Android app.

.DESCRIPTION
    Creates `android/release.keystore` (4096-bit RSA, 27-year validity) and
    writes `android/keystore.properties` with a cryptographically random
    32-character password. Both files are git-ignored.

    DO NOT lose the keystore or the password — Google Play apps signed with a
    different cert cannot be updated. Back both up to a password manager
    immediately.

.PARAMETER Force
    Overwrite an existing keystore without prompting.
#>
[CmdletBinding()]
param(
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$androidDir = Join-Path $PSScriptRoot '..' 'android' | Resolve-Path
Push-Location $androidDir
try {
    $ksPath = Join-Path $androidDir 'release.keystore'
    $propsPath = Join-Path $androidDir 'keystore.properties'

    if ((Test-Path $ksPath) -and -not $Force) {
        $resp = Read-Host "release.keystore already exists. Overwrite? (y/N)"
        if ($resp -notmatch '^[yY]') { throw "Aborted by user." }
    }
    if (Test-Path $ksPath) { Remove-Item $ksPath -Force }

    $kt = $null
    foreach ($cand in @(
            "$env:JAVA_HOME\bin\keytool.exe",
            'C:\Program Files\Java\jdk-17\bin\keytool.exe',
            'C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe'
        )) {
        if ($cand -and (Test-Path $cand)) { $kt = $cand; break }
    }
    if (-not $kt) { throw "keytool.exe not found. Install JDK 17 or set JAVA_HOME." }

    $bytes = New-Object byte[] 24
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $pw = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', 'A').Replace('/', 'B')
    $alias = 'khatetire-release'
    $dname = 'CN=Khate Tire, OU=Mobile, O=Khate Tire, L=Unknown, ST=Unknown, C=US'

    & $kt -genkeypair -v -keystore $ksPath -alias $alias -keyalg RSA -keysize 4096 `
        -validity 10000 -storepass $pw -keypass $pw -dname $dname | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "keytool failed with exit $LASTEXITCODE" }

    "storeFile=release.keystore`nstorePassword=$pw`nkeyAlias=$alias`nkeyPassword=$pw`n" |
        Set-Content -Path $propsPath -NoNewline -Encoding ASCII

    Write-Host "✅ Generated release.keystore ($([Math]::Round((Get-Item $ksPath).Length / 1KB, 1)) KB)"
    Write-Host "✅ Wrote keystore.properties (git-ignored)"
    Write-Host ""
    Write-Host "Cert fingerprint:"
    & $kt -list -v -keystore $ksPath -storepass $pw 2>&1 |
        Select-String 'Alias name|SHA1|SHA256|Valid from'
    Write-Host ""
    Write-Host "🔐 BACK UP release.keystore AND THE PASSWORD NOW. Losing them means you can never update the app on Play Store."
}
finally {
    Pop-Location
}
