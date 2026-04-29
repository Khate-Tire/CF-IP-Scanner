# tools/fetch-vpn-binaries.ps1
# Downloads libv2ray.aar (Xray-core for Android) + libhev-socks5-tunnel.so
# (TUN-to-SOCKS5 bridge) into the right places so the VPN service can
# actually start. Re-runnable: skips files that already exist unless
# -Force is passed.
param([switch]$Force)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$libsDir = Join-Path $root "android\app\libs"
$jniDir  = Join-Path $root "android\app\src\main\jniLibs"

New-Item -ItemType Directory -Force -Path $libsDir | Out-Null
foreach ($abi in @("arm64-v8a","armeabi-v7a","x86_64","x86")) {
    New-Item -ItemType Directory -Force -Path (Join-Path $jniDir $abi) | Out-Null
}

function Get-LatestReleaseTag($repo) {
    $api = "https://api.github.com/repos/$repo/releases/latest"
    $r = Invoke-RestMethod -Uri $api -Headers @{ "User-Agent" = "cfipscanner-fetcher" }
    return $r.tag_name
}

function Get-LatestRelease($repo) {
    $api = "https://api.github.com/repos/$repo/releases/latest"
    return Invoke-RestMethod -Uri $api -Headers @{ "User-Agent" = "cfipscanner-fetcher" }
}

function Try-DownloadFile($url, $outFile) {
    try {
        Invoke-WebRequest -Uri $url -OutFile $outFile
        return $true
    } catch {
        return $false
    }
}

# 1. libv2ray.aar from 2dust/AndroidLibXrayLite ----------------------------
$aar = Join-Path $libsDir "libv2ray.aar"
if ((Test-Path $aar) -and -not $Force) {
    Write-Host "[skip] libv2ray.aar already present"
} else {
    $tag = Get-LatestReleaseTag "2dust/AndroidLibXrayLite"
    Write-Host "[fetch] libv2ray.aar @ $tag"
    $url = "https://github.com/2dust/AndroidLibXrayLite/releases/download/$tag/libv2ray.aar"
    Invoke-WebRequest -Uri $url -OutFile $aar
    Write-Host "  -> $aar  ($([math]::Round((Get-Item $aar).Length/1MB,1)) MB)"
}

# 2. libhev-socks5-tunnel.so from heiher/hev-socks5-tunnel -----------------
# Releases ship per-ABI Android prebuilts as .tar.gz with name
# `hev-socks5-tunnel-<ver>-android-<abi>.tar.gz` containing
# `libhev-socks5-tunnel.so`.
$abiMap = @{
    "arm64-v8a"   = "arm64"
    "armeabi-v7a" = "armv7"
    "x86_64"      = "x86_64"
    "x86"         = "i686"
}

$tunTag = $null
$v2rayRelease = $null
foreach ($abi in $abiMap.Keys) {
    $dst = Join-Path (Join-Path $jniDir $abi) "libhev-socks5-tunnel.so"
    if ((Test-Path $dst) -and -not $Force) {
        Write-Host "[skip] $abi/libhev-socks5-tunnel.so already present"
        continue
    }
    if (-not $tunTag) {
        $tunTag = Get-LatestReleaseTag "heiher/hev-socks5-tunnel"
        Write-Host "[fetch] hev-socks5-tunnel @ $tunTag"
    }
    $arch = $abiMap[$abi]

    # Upstream naming has changed over time; try known historical Android archive patterns.
    $version = $tunTag.TrimStart('v')
    $candidateTarNames = @(
        "hev-socks5-tunnel-$version-linux-android-$arch.tar.gz",
        "hev-socks5-tunnel-$version-android-$arch.tar.gz"
    )

    $tmp = New-TemporaryFile
    try {
        $fetchedFromHeiher = $false
        foreach ($tarName in $candidateTarNames) {
            $url = "https://github.com/heiher/hev-socks5-tunnel/releases/download/$tunTag/$tarName"
            Write-Host "  $abi <- $tarName"
            if (-not (Try-DownloadFile $url $tmp)) {
                Write-Host "    [miss] $tarName"
                continue
            }

            $extractDir = Join-Path $env:TEMP ("hev-" + [Guid]::NewGuid().ToString("N"))
            New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
            # Use tar (Windows 10+ bundles bsdtar)
            tar -xzf $tmp -C $extractDir
            $found = Get-ChildItem -Path $extractDir -Recurse -Filter "libhev-socks5-tunnel.so" -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($found) {
                Copy-Item -Force -Path $found.FullName -Destination $dst
                Write-Host "    -> $dst  ($([math]::Round((Get-Item $dst).Length/1KB,1)) KB)"
                $fetchedFromHeiher = $true
                Remove-Item -Recurse -Force $extractDir
                break
            }
            Remove-Item -Recurse -Force $extractDir
            Write-Host "    [miss] libhev-socks5-tunnel.so not in $tarName"
        }

        if ($fetchedFromHeiher) {
            continue
        }

        # Fallback: extract the ABI library from official v2rayNG APK releases.
        if (-not $v2rayRelease) {
            $v2rayRelease = Get-LatestRelease "2dust/v2rayNG"
            Write-Host "[fallback] v2rayNG APK assets @ $($v2rayRelease.tag_name)"
        }

        $apkAsset = $v2rayRelease.assets |
            Where-Object { $_.name -like "*_${abi}.apk" -and $_.name -notmatch "fdroid" } |
            Select-Object -First 1
        if (-not $apkAsset) {
            $apkAsset = $v2rayRelease.assets |
                Where-Object { $_.name -like "*_${abi}.apk" } |
                Select-Object -First 1
        }
        if (-not $apkAsset) {
            throw "No v2rayNG APK asset found for ABI '$abi' in release $($v2rayRelease.tag_name)."
        }

        Write-Host "  $abi <- $($apkAsset.name)"
        Invoke-WebRequest -Uri $apkAsset.browser_download_url -OutFile $tmp
        $extractDir = Join-Path $env:TEMP ("v2rayng-" + [Guid]::NewGuid().ToString("N"))
        New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
        tar -xf $tmp -C $extractDir
        $soFromApk = Join-Path $extractDir ("lib/{0}/libhev-socks5-tunnel.so" -f $abi)
        if (-not (Test-Path $soFromApk)) {
            throw "libhev-socks5-tunnel.so not found in $($apkAsset.name) for ABI '$abi'."
        }
        Copy-Item -Force -Path $soFromApk -Destination $dst
        Write-Host "    -> $dst  ($([math]::Round((Get-Item $dst).Length/1KB,1)) KB)"
        Remove-Item -Recurse -Force $extractDir
    } finally {
        Remove-Item -Force -ErrorAction SilentlyContinue $tmp
    }
}

Write-Host "`nDone. Rebuild with: cd android; .\gradlew :app:assembleDebug"
