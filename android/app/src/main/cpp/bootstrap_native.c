/*
 * bootstrap_native.c — Phase-1 stub.
 *
 * Returns NULL so BootstrapLoader.kt falls through to its Kotlin AES-GCM path
 * (which uses javax.crypto). Phase-1.5 will replace this with a BoringSSL-
 * backed AES/GCM/NoPadding implementation that keeps the plaintext in native
 * memory, never crossing the JVM heap.
 *
 * Signature must match: BootstrapNative.loadAndDecrypt(byte[] blob, byte[] key)
 *   -> byte[]?
 */
#include <jni.h>
#include <stddef.h>

JNIEXPORT jbyteArray JNICALL
Java_org_khatetire_cfipscanner_bootstrap_BootstrapNative_loadAndDecrypt(
        JNIEnv *env, jobject thiz, jbyteArray blob, jbyteArray key) {
    (void) env; (void) thiz; (void) blob; (void) key;
    return NULL;
}
