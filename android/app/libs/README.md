# Native binaries (Phase 1.5)

This folder ships **prebuilt native binaries** that the app loads at runtime.
Two libraries are needed for the app to actually tunnel traffic:

## 1. `libv2ray.aar` (Xray-core for Android)

Drop into `android/app/libs/libv2ray.aar`.

**Source:** https://github.com/2dust/AndroidLibXrayLite/releases

PowerShell:
```powershell
$ver = "25.4.21"   # check releases page for current
New-Item -ItemType Directory -Force -Path .\app\libs | Out-Null
Invoke-WebRequest `
  "https://github.com/2dust/AndroidLibXrayLite/releases/download/$ver/libv2ray.aar" `
  -OutFile .\app\libs\libv2ray.aar
```

**Size:** ~30 MB. The AAR bundles all four ABIs.

## 2. `libhev-socks5-tunnel.so` (TUN ↔ SOCKS5 bridge)

Drop per-ABI into `android/app/src/main/jniLibs/<abi>/libhev-socks5-tunnel.so`.

**Source:** https://github.com/heiher/hev-socks5-tunnel/releases (Android prebuilts)

The easiest practical source is to **pull from any modern v2rayNG / Hiddify / NekoBox APK**:

```powershell
# example: extract from v2rayNG (replace with your downloaded apk path)
$apk = ".\v2rayNG.apk"
$dst = ".\app\src\main\jniLibs"
foreach ($abi in @("arm64-v8a","armeabi-v7a","x86_64")) {
    New-Item -ItemType Directory -Force -Path "$dst\$abi" | Out-Null
    & 7z e $apk -o"$dst\$abi" "lib/$abi/libhev-socks5-tunnel.so" -y
}
```

If the .so is named differently (some forks use `libtun2socks.so`), rename it
to `libhev-socks5-tunnel.so` to match `Tun2SocksController.LIB_NAME`.

## Verify

After both files are in place:
```powershell
.\gradlew.bat :app:assembleDebug :app:installDebug
```

If either binary is missing the app **still installs and runs** but tapping
Connect will return `FAILED` (the controllers are written defensively and
detect the missing native code at runtime).
