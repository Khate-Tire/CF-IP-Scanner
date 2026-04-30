# Strip toString of bootstrap-sensitive types so reverse-engineered logs leak nothing.
-assumenosideeffects class org.khatetire.cfipscanner.model.VlessConfig {
    public java.lang.String toString();
}
-assumenosideeffects class org.khatetire.cfipscanner.bootstrap.** {
    public java.lang.String toString();
}

# Remove all logging in release.
-assumenosideeffects class android.util.Log {
    public static *** v(...);
    public static *** d(...);
    public static *** i(...);
    public static *** w(...);
    public static *** e(...);
}

# Keep JNI bridge.
-keepclasseswithmembernames class * { native <methods>; }
-keep class org.khatetire.cfipscanner.bootstrap.BootstrapNative { *; }

# v2rayNG's libhev-socks5-tunnel.so registers natives against this exact FQN
# via JNI_OnLoad → FindClass → RegisterNatives. R8 MUST NOT rename or strip
# the class, its Companion, or the native method names — otherwise FindClass
# returns null, RegisterNatives fails, and System.loadLibrary throws
# UnsatisfiedLinkError (user-visible: "libhev-socks5-tunnel.so missing for
# this ABI"). Keep both Java reflection name and member names intact.
-keep class com.v2ray.ang.service.TProxyService { *; }
-keep class com.v2ray.ang.service.TProxyService$Companion { *; }
-keepnames class com.v2ray.ang.service.TProxyService
-keepnames class com.v2ray.ang.service.TProxyService$Companion

# Compose / Kotlin metadata.
-keep class kotlin.Metadata { *; }
-keepattributes *Annotation*, InnerClasses, Signature

# Tink references com.google.errorprone.annotations.* (compile-only, not on runtime classpath).
# These warnings are safe to suppress for release minification.
-dontwarn com.google.errorprone.annotations.**
-dontwarn javax.annotation.**
-dontwarn javax.annotation.concurrent.**
-dontwarn com.google.api.client.**
-dontwarn org.joda.time.**

# Tink also has optional integrations we don't use. Drop their hard refs.
-dontwarn com.google.crypto.tink.util.KeysDownloader
-dontwarn com.google.crypto.tink.util.KeysDownloader$*

# Keep Tink reflective entry points so AEAD/keyset loading still works after R8.
-keep class com.google.crypto.tink.** { *; }
-keep class com.google.crypto.tink.proto.** { *; }
-keepnames class com.google.crypto.tink.** { *; }

# OkHttp + Conscrypt optional providers.
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
