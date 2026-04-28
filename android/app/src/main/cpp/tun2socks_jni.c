// JNI shim that bridges Kotlin (Tun2SocksController) to the prebuilt
// libhev-socks5-tunnel.so shipped under jniLibs/<abi>/.
//
// hev-socks5-tunnel exports plain C symbols (TProxyStartService etc.), not
// JNI symbols, so we provide JNI entry points here and link against the
// prebuilt .so via target_link_libraries(... PRIVATE hev-socks5-tunnel).

#include <jni.h>
#include <pthread.h>
#include <stdio.h>
#include <string.h>
#include <android/log.h>

#define LOG_TAG "tun2socks_jni"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO,  LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

// hev-socks5-tunnel public API (from prebuilt .so).
extern int  hev_socks5_tunnel_main_from_file(const char *config_path, int tunfd);
extern void hev_socks5_tunnel_quit(void);

static pthread_t g_thread;
static int g_running = 0;
static char g_cfg_path[1024];
static int g_fd = -1;

static void *tun_thread_main(void *arg) {
    (void) arg;
    LOGI("hev_socks5_tunnel_main_from_file: cfg=%s fd=%d", g_cfg_path, g_fd);
    int rc = hev_socks5_tunnel_main_from_file(g_cfg_path, g_fd);
    LOGI("hev_socks5_tunnel_main_from_file returned %d", rc);
    g_running = 0;
    return NULL;
}

JNIEXPORT void JNICALL
Java_org_khatetire_cfipscanner_vpn_Tun2SocksController_TProxyStartService(
        JNIEnv *env, jclass clazz, jstring jpath, jint fd) {
    if (g_running) {
        LOGI("already running");
        return;
    }
    const char *p = (*env)->GetStringUTFChars(env, jpath, NULL);
    if (!p) return;
    snprintf(g_cfg_path, sizeof(g_cfg_path), "%s", p);
    (*env)->ReleaseStringUTFChars(env, jpath, p);
    g_fd = (int) fd;
    g_running = 1;
    if (pthread_create(&g_thread, NULL, tun_thread_main, NULL) != 0) {
        LOGE("pthread_create failed");
        g_running = 0;
    } else {
        pthread_detach(g_thread);
    }
}

JNIEXPORT void JNICALL
Java_org_khatetire_cfipscanner_vpn_Tun2SocksController_TProxyStopService(
        JNIEnv *env, jclass clazz) {
    if (!g_running) return;
    LOGI("hev_socks5_tunnel_quit");
    hev_socks5_tunnel_quit();
    g_running = 0;
}
