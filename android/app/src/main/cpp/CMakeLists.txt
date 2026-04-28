cmake_minimum_required(VERSION 3.22.1)
project("native" C)

# ---------------------------------------------------------------------------
# bootstrap_native — stub for AES-GCM bootstrap decryption (Kotlin fallback
# is the active path until BoringSSL is wired in).
# ---------------------------------------------------------------------------
add_library(bootstrap_native SHARED bootstrap_native.c)
target_link_libraries(bootstrap_native log)

# ---------------------------------------------------------------------------
# libhev-socks5-tunnel.so is shipped as-is in jniLibs/<abi>/ and packaged by
# AGP automatically. The .so already registers JNI natives onto
# com.v2ray.ang.service.TProxyService (see TProxyService.kt stub), so no
# wrapper library is needed.
# ---------------------------------------------------------------------------

