# Khate Free Net — Android client

Phase 1 MVP scaffold for the CF-IP-Scanner companion VPN app. See the top-level
`/memories/session/plan.md` (project plan) for full scope.

## What's in this directory

```
android/
├── build.gradle.kts          # root Gradle (AGP 8.5, Kotlin 1.9.24, Compose)
├── settings.gradle.kts
├── gradle.properties
├── app/
│   ├── build.gradle.kts      # includes the encryptBootstrap task
│   ├── proguard-rules.pro    # strips toString() of bootstrap/VLESS types
│   └── src/main/
│       ├── AndroidManifest.xml
│       ├── kotlin/org/khatetire/cfipscanner/
│       │   ├── MainActivity.kt
│       │   ├── KhateApp.kt
│       │   ├── ui/ConnectScreen.kt + theme/Theme.kt
│       │   ├── vpn/CfVpnService.kt + VpnStatus.kt + VpnStateHolder.kt
│       │   ├── xray/XrayConfigBuilder.kt + XrayController.kt   ← stub
│       │   ├── bootstrap/BootstrapLoader.kt + BootstrapNative.kt + BootstrapPolicy.kt
│       │   ├── sni/SniBank.kt
│       │   ├── model/VlessConfig.kt
│       │   └── util/AnonymousId.kt
│       ├── cpp/CMakeLists.txt + bootstrap_native.c   ← stub (Phase-1.5)
│       └── res/                 ← strings, themes, backup rules
└── .gitignore
```

## Build prerequisites

1. **Android Studio Koala (2024.1)** or newer.
2. **JDK 17** (Android Studio bundles a Temurin 17 — that's fine).
3. **Android SDK 34**, NDK `26.1.10909125`, CMake `3.22.1`. Install via SDK
   Manager → SDK Tools.
4. **libXray AAR** — Phase 1 ships with a stub `XrayController` so the project
   compiles before the AAR is dropped in. To enable real tunnelling:
   1. Build [`XTLS/libXray`](https://github.com/XTLS/libXray) for Android (or
      grab a release AAR).
   2. Copy `libXray.aar` into `app/libs/`.
   3. Uncomment the `implementation(files("libs/libXray.aar"))` line in
      `app/build.gradle.kts`.
   4. Replace the body of `XrayController.start/stop` with the real bindings
      (the file already documents the typical call shape).
5. **tun2socks JNI** — `hev-socks5-tunnel` (recommended) or `tun2socks-go`. Drop
   the `.so` files into `app/src/main/jniLibs/<abi>/` and wire from
   `CfVpnService.startConnect` after `tunFd` is established (tracked in-file as
   `// TODO: hand tunFd to tun2socks…`).

## Bootstrap config secrecy

The bootstrap "free internet" VLESS endpoint is **never committed**. The Gradle
task `:app:encryptBootstrap` (auto-runs before `mergeAssets`) reads two env
vars and emits `app/src/main/assets/bootstrap.bin` (AES-GCM, see
`app/build.gradle.kts` for blob layout):

| Env var                    | Source                              |
| -------------------------- | ----------------------------------- |
| `BOOTSTRAP_VLESS_CONFIGS`  | newline-separated VLESS URIs        |
| _no explicit key env var_  | key is derived from signing cert fingerprint at build time |

If either is unset, a placeholder blob is written (so debug builds still
compile) and `BootstrapLoader.load(...)` returns an empty list — the UI will
show **Failed** until Phase 2 wires the L1–L5 community DB chain to provide
fresh configs.

## DB proxy config (Phase 2+)

Create `android/db.properties` from `android/db.properties.example` and fill
the values you have:

| Property               | Purpose |
| ---------------------- | ------- |
| `dbProxyUrl`           | `/v1/*` worker endpoint consumed by `DbClient` |
| `dbProxyApiKey`        | optional bearer token for worker auth |
| `workerFallbackHosts`  | optional comma-separated backup workers |
| `bootstrapCleanIps`    | optional cold-start seed IP list |

`db.properties` is git-ignored and compiled into `BuildConfig` for local/dev
builds.
`assets/bootstrap.bin` is in `.gitignore`. CI sets the env vars from GitHub
Actions secrets — see `.github/workflows/android.yml`.

### Display contract (HARD enforcement)

- Notification text never includes SNI / host / IP / UUID / port / path.
- `BootstrapPolicy.isShareable(cfg)` must be checked before any Share / Copy /
  QR / Export sink. Bootstrap configs throw `SecurityException` when surfaced.
- `VlessConfig.toString()` is redacted; ProGuard further strips it in release.

## Running locally

```powershell
cd android
# Debug build (no signing required):
./gradlew :app:assembleDebug
# Install to a connected device:
./gradlew :app:installDebug
```

Tap **Connect** → Android shows the system VPN consent dialog → service starts,
notification appears. With the libXray + tun2socks stubs still in place,
network traffic does not yet flow through the tunnel — that lands when the
AARs above are installed.

## CI

`.github/workflows/android.yml` builds on every push to `main` that touches
`android/**`, attaches signed release APKs to GitHub Releases, and threads the
bootstrap secrets through. Required GitHub secrets:

- `BOOTSTRAP_VLESS_CONFIGS`
- `RELEASE_KEYSTORE_BASE64`, `RELEASE_KEYSTORE_PASSWORD`,
  `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD`

## Roadmap (from `/memories/session/plan.md`)

- **Phase 1 (this scaffold)** — VPN service skeleton + bootstrap loader + UI.
- **Phase 1.5** — drop libXray AAR, tun2socks JNI; first end-to-end tunnel.
- **Phase 2** — Kotlin `DbClient` 5-layer fallback; `/v1/*` Worker routes.
- **Phase 3** — `ScannerForegroundService` (background co-scanner).
- **Phase 4** — smart selection + in-tunnel watchdog auto-failover.
- **Phase 5** — community polish, in-app updater, i18n, stats.
