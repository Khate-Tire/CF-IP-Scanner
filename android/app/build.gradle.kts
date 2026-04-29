import java.io.ByteArrayOutputStream
import java.io.File
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Properties
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.devtools.ksp")
}

android {
    namespace = "org.khatetire.cfipscanner"
    compileSdk = 34
    ndkVersion = "26.1.10909125"

    defaultConfig {
        applicationId = "org.khatetire.cfipscanner"
        minSdk = 24
        targetSdk = 34
        // versionCode = total commit count on HEAD → strictly monotonic, perfect
        // for Play Store update detection. Falls back to 1 outside a git repo.
        // versionName = nearest tag + commit-count + short SHA (+ "-dirty"
        // if working tree is unclean), so every build is uniquely identified
        // and visible in About / installed-app info.
        fun runGit(vararg args: String): String = runCatching {
            val proc = ProcessBuilder(listOf("git", *args))
                .directory(rootProject.projectDir)
                .redirectErrorStream(true)
                .start()
            proc.inputStream.bufferedReader().use { it.readText() }.trim().also {
                proc.waitFor()
            }
        }.getOrDefault("")
        val gitCount = runGit("rev-list", "--count", "HEAD").toIntOrNull() ?: 1
        val gitDescribe = runGit("describe", "--tags", "--always", "--dirty", "--abbrev=7")
            .ifEmpty { "2.3.7" }
        versionCode = gitCount
        versionName = "2.3.7+$gitCount.$gitDescribe"
        // Expose to runtime so an About / Settings footer can render it.
        buildConfigField("String", "GIT_DESCRIBE", "\"$gitDescribe\"")
        buildConfigField("int", "GIT_COMMIT_COUNT", "$gitCount")
        ndk {
            abiFilters += listOf("arm64-v8a", "armeabi-v7a", "x86_64")
        }
        externalNativeBuild {
            cmake {
                cppFlags += "-std=c++17"
                arguments += listOf("-DANDROID_STL=c++_shared")
            }
        }

        // DB proxy endpoint — read from db.properties (git-ignored). Empty
        // strings disable the DbClient and force the bootstrap fallback.
        val dbProps = rootProject.file("db.properties").let { f ->
            Properties().apply { if (f.exists()) load(f.inputStream()) }
        }
        buildConfigField(
            "String", "DB_PROXY_URL",
            "\"${dbProps.getProperty("dbProxyUrl", "")}\""
        )
        buildConfigField(
            "String", "DB_PROXY_API_KEY",
            "\"${dbProps.getProperty("dbProxyApiKey", "")}\""
        )
        // Comma-separated list of worker subdomains for L2 rotation
        // (e.g. "cf-ip-scanner-db-proxy.user.workers.dev,backup.user.workers.dev").
        // First entry is the canonical one; others are tried on failure.
        buildConfigField(
            "String", "WORKER_FALLBACK_HOSTS",
            "\"${dbProps.getProperty("workerFallbackHosts", "")}\""
        )
        // Comma-separated list of known-clean Cloudflare IPs used for L3
        // (worker via clean-IP + SNI fronting). Acts as cold-start seed when
        // the on-device cache is empty.
        buildConfigField(
            "String", "BOOTSTRAP_CLEAN_IPS",
            "\"${dbProps.getProperty("bootstrapCleanIps", "104.16.0.1,104.17.0.1,104.18.0.1,104.19.0.1,104.20.0.1,162.159.135.234")}\""
        )
    }

    splits {
        abi {
            isEnable = true
            reset()
            include("arm64-v8a", "armeabi-v7a", "x86_64")
            isUniversalApk = true
        }
    }

    // Release signing config. Loads credentials from `android/keystore.properties`
    // (git-ignored). If the file or any required field is missing, the release
    // build falls back to the debug signing config so the APK still installs
    // — but a loud warning is logged. CI can also supply credentials via the
    // env vars KHATE_KEYSTORE_FILE / KHATE_KEYSTORE_PASSWORD /
    // KHATE_KEY_ALIAS / KHATE_KEY_PASSWORD (env wins over the properties file).
    val releaseSigning = signingConfigs.create("release") {
        val ksProps = rootProject.file("keystore.properties")
        val props = Properties().apply { if (ksProps.exists()) load(ksProps.inputStream()) }
        val storePath = System.getenv("KHATE_KEYSTORE_FILE") ?: props.getProperty("storeFile")
        val storePass = System.getenv("KHATE_KEYSTORE_PASSWORD") ?: props.getProperty("storePassword")
        val alias = System.getenv("KHATE_KEY_ALIAS") ?: props.getProperty("keyAlias")
        val keyPass = System.getenv("KHATE_KEY_PASSWORD") ?: props.getProperty("keyPassword")
        if (!storePath.isNullOrBlank() && !storePass.isNullOrBlank() &&
            !alias.isNullOrBlank() && !keyPass.isNullOrBlank()
        ) {
            // Resolve relative paths against rootProject (android/) so the
            // properties file can stay portable across machines.
            val resolved = File(storePath).let { raw ->
                if (raw.isAbsolute) raw else rootProject.file(storePath)
            }
            if (resolved.exists()) {
                storeFile = resolved
                storePassword = storePass
                keyAlias = alias
                keyPassword = keyPass
                // Enable v1+v2+v3 signing schemes. v1 (JAR) is required for
                // pre-API 24, v2 for 24-27, v3 (28+) supports key rotation.
                enableV1Signing = true
                enableV2Signing = true
                enableV3Signing = true
            } else {
                logger.warn("⚠️  Release keystore file not found at ${resolved.absolutePath} — release build will fall back to debug signing.")
            }
        } else {
            logger.warn("⚠️  No release signing credentials found (keystore.properties or KHATE_* env vars). Release build will fall back to debug signing. See keystore.properties.example.")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // Use the configured release signing if it has a storeFile; otherwise
            // fall back to debug so the APK is still installable for testing.
            signingConfig = if (releaseSigning.storeFile != null) releaseSigning
            else signingConfigs.getByName("debug")
        }
        debug {
            isMinifyEnabled = false
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = "3.22.1"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    packaging {
        resources.excludes += setOf(
            "META-INF/AL2.0", "META-INF/LGPL2.1", "META-INF/LICENSE*", "META-INF/NOTICE*"
        )
    }

    sourceSets["main"].java.srcDirs("src/main/kotlin")
    sourceSets["test"].java.srcDirs("src/test/kotlin")
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.09.03")
    implementation(composeBom)
    androidTestImplementation(composeBom)

    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.6")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.6")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    debugImplementation("androidx.compose.ui:ui-tooling")

    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("androidx.datastore:datastore-preferences:1.1.1")

    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.3")

    // FragmentActivity (required by androidx.biometric BiometricPrompt).
    implementation("androidx.fragment:fragment-ktx:1.8.3")
    // Biometric lock for sensitive screens (Settings, Manual IP).
    implementation("androidx.biometric:biometric:1.2.0-alpha05")
    // WorkManager for periodic background scans while the app is closed.
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    // Room for lightweight session history persistence.
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    ksp("androidx.room:room-compiler:2.6.1")
    // Glance home-screen widget (connect toggle + clean IP).
    implementation("androidx.glance:glance-appwidget:1.1.0")
    implementation("androidx.glance:glance-material3:1.1.0")
    // CameraX + ML Kit for QR-config import.
    implementation("androidx.camera:camera-core:1.3.4")
    implementation("androidx.camera:camera-camera2:1.3.4")
    implementation("androidx.camera:camera-lifecycle:1.3.4")
    implementation("androidx.camera:camera-view:1.3.4")
    implementation("com.google.mlkit:barcode-scanning:17.3.0")

    // libXray AAR — optional. Drop libv2ray.aar (or any *.aar) into app/libs/
    // and it will be included via the flatDir repo declared in settings.gradle.kts.
    implementation(fileTree(mapOf("dir" to "libs", "include" to listOf("*.jar"))))
    if (file("libs/libv2ray.aar").exists()) {
        implementation(group = "", name = "libv2ray", ext = "aar")
    }

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.8.1")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
}

// =============================================================================
// Bootstrap encryption task
// =============================================================================
// Reads the BOOTSTRAP_VLESS_CONFIGS env var (newline-separated VLESS URIs),
// encrypts with AES-GCM and writes to assets/bootstrap.bin.
//
// Key derivation MUST match BootstrapLoader.deriveKey():
//   key = SHA256( UPPER_HEX( SHA256(signingCertDER) ).asciiBytes )
// We read the signing certificate from the keystore that AGP will use for
// the active variant (debug.keystore by default for debug builds, the file
// referenced in keystore.properties for release).
//
// File format (binary):
//   magic[4]   = "KFN1"
//   iv[12]     = random
//   ciphertext = AES-GCM(plaintext, key, iv)
//
// Local dev: if BOOTSTRAP_VLESS_CONFIGS is unset, a placeholder is written.
// =============================================================================
fun loadSigningCertSha256Hex(): String? {
    // Try release keystore.properties first.
    val ksProps = rootProject.file("keystore.properties")
    val (storeFile, storePwd, alias) = if (ksProps.exists()) {
        val p = Properties().apply { load(ksProps.inputStream()) }
        Triple(file(p.getProperty("storeFile")), p.getProperty("storePassword"), p.getProperty("keyAlias"))
    } else {
        // Fall back to AGP debug keystore.
        val debugKs = file("${System.getProperty("user.home")}/.android/debug.keystore")
        if (!debugKs.exists()) return null
        Triple(debugKs, "android", "androiddebugkey")
    }
    return try {
        val pwdChars: CharArray = storePwd.toCharArray()
        val ks: KeyStore = try {
            val k = KeyStore.getInstance("PKCS12")
            val ins = storeFile.inputStream()
            try { k.load(ins, pwdChars) } finally { ins.close() }
            k
        } catch (_: Throwable) {
            val k = KeyStore.getInstance("JKS")
            val ins = storeFile.inputStream()
            try { k.load(ins, pwdChars) } finally { ins.close() }
            k
        }
        loadHexFrom(ks, alias)
    } catch (t: Throwable) {
        logger.warn("encryptBootstrap: could not read signing cert from $storeFile: ${t.message}")
        null
    }
}

fun loadHexFrom(ks: KeyStore, alias: String): String {
    val cert = ks.getCertificate(alias)
        ?: error("alias $alias not found in keystore")
    val der = cert.encoded
    val sha = MessageDigest.getInstance("SHA-256").digest(der)
    return sha.joinToString("") { "%02X".format(it) }
}

val encryptBootstrap = tasks.register("encryptBootstrap") {
    group = "bootstrap"
    description = "AES-GCM encrypts BOOTSTRAP_VLESS_CONFIGS into assets/bootstrap.bin"
    val outFile = file("src/main/assets/bootstrap.bin")
    outputs.file(outFile)
    // Invalidate cache when the env var (and therefore the plaintext) changes,
    // including transitions between unset (placeholder) and set (real configs).
    // Hash so the secret never appears in Gradle's --info build log.
    val bootstrapEnv = System.getenv("BOOTSTRAP_VLESS_CONFIGS").orEmpty()
    val bootstrapEnvHash = MessageDigest.getInstance("SHA-256")
        .digest(bootstrapEnv.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }
    inputs.property("bootstrapEnvHash", bootstrapEnvHash)
    inputs.property("bootstrapEnvLen", bootstrapEnv.length)
    // Also invalidate when the signing cert changes (key derivation depends on it).
    val signingFp = loadSigningCertSha256Hex().orEmpty()
    inputs.property("signingFp", signingFp)
    // Force re-encryption every build: AES-GCM IV must be fresh for each output,
    // and there's no way to know if the existing bin was produced with the same
    // env or signing cert without decrypting it. Cheap operation (~ms).
    outputs.upToDateWhen { false }
    doLast {
        outFile.parentFile.mkdirs()
        val strict = (project.findProperty("strictBootstrap") as String?) == "true"
        val configs = System.getenv("BOOTSTRAP_VLESS_CONFIGS")
        if (configs.isNullOrBlank()) {
            if (strict) error("encryptBootstrap: BOOTSTRAP_VLESS_CONFIGS env var is empty but -PstrictBootstrap=true. Refusing to ship a placeholder.")
            outFile.writeBytes("KFN1".toByteArray() + ByteArray(12) + ByteArray(16))
            logger.lifecycle("encryptBootstrap: BOOTSTRAP_VLESS_CONFIGS not set, wrote placeholder.")
            return@doLast
        }
        val fingerprintHex = loadSigningCertSha256Hex()
        if (fingerprintHex == null) {
            if (strict) error("encryptBootstrap: no signing keystore found but -PstrictBootstrap=true. Refusing to ship a placeholder.")
            outFile.writeBytes("KFN1".toByteArray() + ByteArray(12) + ByteArray(16))
            logger.lifecycle("encryptBootstrap: no signing keystore found, wrote placeholder.")
            return@doLast
        }
        logger.lifecycle("encryptBootstrap: fp=$fingerprintHex")
        val keyBytes = MessageDigest.getInstance("SHA-256").digest(fingerprintHex.toByteArray())
        val iv = ByteArray(12).also { SecureRandom().nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(keyBytes, "AES"), GCMParameterSpec(128, iv))
        val ct = cipher.doFinal(configs.trim().toByteArray(Charsets.UTF_8))
        val out = ByteArrayOutputStream()
        out.write("KFN1".toByteArray())
        out.write(iv)
        out.write(ct)
        outFile.writeBytes(out.toByteArray())
        logger.lifecycle("encryptBootstrap: wrote ${outFile.length()} bytes (signed-cert-derived key).")
    }
}

androidComponents {
    onVariants { variant ->
        // Run before resources/assets are merged into APK, AND before lint
        // tasks scan the assets directory (Gradle 9 strict implicit-dep check).
        val capName = variant.name.replaceFirstChar { it.uppercase() }
        tasks.matching {
            it.name == "merge${capName}Assets" ||
                it.name == "package${capName}Assets" ||
                it.name == "generate${capName}LintVitalReportModel" ||
                it.name == "generate${capName}LintModel" ||
                it.name == "lintVitalAnalyze${capName}" ||
                it.name == "lintAnalyze${capName}" ||
                it.name == "lintVitalReport${capName}" ||
                it.name == "lintReport${capName}"
        }.configureEach { dependsOn(encryptBootstrap) }
    }
}
