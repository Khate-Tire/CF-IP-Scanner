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

# Compose / Kotlin metadata.
-keep class kotlin.Metadata { *; }
-keepattributes *Annotation*, InnerClasses, Signature
