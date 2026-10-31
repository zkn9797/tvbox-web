/* Bionic-only libc symbols for Android NDK libraries loaded into a glibc JVM (tvbox spider-runtime).
 * Installed as /app/android-libs/libc.so (what NDK libraries name as NEEDED); it depends on glibc's libc.so.6,
 * so everything else resolves to glibc. Only fortify checks and BSD string helpers live here.
 * Deliberately NOT providing __sF/__errno (see liblog.c). */
#define _GNU_SOURCE
#include <string.h>
#include <stdlib.h>
#include <stdio.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <sys/select.h>
static void die(const char *f) { fprintf(stderr, "[android-compat] %s: buffer overflow detected\n", f); abort(); }
size_t __strlen_chk(const char *s, size_t n) { size_t l = strlen(s); if (n != (size_t)-1 && l >= n) die("strlen"); return l; }
char *__strchr_chk(const char *s, int c, size_t n) { (void)n; return (char *)strchr(s, c); }
char *__strrchr_chk(const char *s, int c, size_t n) { (void)n; return (char *)strrchr(s, c); }
void *__memchr_chk(const void *s, int c, size_t n, size_t b) { if (n > b) die("memchr"); return (void *)memchr(s, c, n); }
void *__memrchr_chk(const void *s, int c, size_t n, size_t b) { if (n > b) die("memrchr"); return (void *)memrchr(s, c, n); }
size_t strlcpy(char *d, const char *s, size_t n) { size_t l = strlen(s); if (n) { size_t k = l < n - 1 ? l : n - 1; memcpy(d, s, k); d[k] = 0; } return l; }
size_t strlcat(char *d, const char *s, size_t n) { size_t dl = strnlen(d, n); if (dl == n) return n + strlen(s); return dl + strlcpy(d + dl, s, n - dl); }
size_t __strlcpy_chk(char *d, const char *s, size_t n, size_t b) { if (n > b) die("strlcpy"); return strlcpy(d, s, n); }
size_t __strlcat_chk(char *d, const char *s, size_t n, size_t b) { if (n > b) die("strlcat"); return strlcat(d, s, n); }
char *__strncpy_chk2(char *d, const char *s, size_t n, size_t db, size_t sb) { (void)sb; if (n > db) die("strncpy"); return strncpy(d, s, n); }
char *__stpncpy_chk2(char *d, const char *s, size_t n, size_t db, size_t sb) { (void)sb; if (n > db) die("stpncpy"); return stpncpy(d, s, n); }
mode_t __umask_chk(mode_t m) { return umask(m); }
void __FD_SET_chk(int fd, fd_set *s, size_t n) { (void)n; FD_SET(fd, s); }
void __FD_CLR_chk(int fd, fd_set *s, size_t n) { (void)n; FD_CLR(fd, s); }
int __FD_ISSET_chk(int fd, const fd_set *s, size_t n) { (void)n; return FD_ISSET(fd, s); }
int __system_property_get(const char *name, char *value) { (void)name; if (value) value[0] = 0; return 0; }

/* ---- JNI: Android allows native constructors (VMP-protected spiders register "<init>"); the JVM does not.
 * The runtime rewrites `native <init>(D)V` into a real constructor calling a private native `$init$(D)V`, and this hook,
 * installed into the JVM's JNI function table when the first Android library loads, renames "<init>" registrations
 * to "$init$". Methods are also registered one at a time so a single missing method does not drop the rest. */
#include <dlfcn.h>
#include <sys/mman.h>
#include <unistd.h>
#include <stdint.h>
#include <jni.h>
static jint (JNICALL *orig_register)(JNIEnv *, jclass, const JNINativeMethod *, jint);
static jint JNICALL hook_register(JNIEnv *env, jclass c, const JNINativeMethod *m, jint n) {
  jint bad = 0;
  for (jint i = 0; i < n; i++) {
    JNINativeMethod one = m[i];
    if (one.name && strcmp(one.name, "<init>") == 0) one.name = (char *)"$init$";
    if (orig_register(env, c, &one, 1) != JNI_OK) { bad++; if ((*env)->ExceptionCheck(env)) (*env)->ExceptionClear(env); }
  }
  if (bad && getenv("JNI_HOOK_DEBUG")) fprintf(stderr, "[android-compat] RegisterNatives: %d of %d methods not found\n", (int)bad, (int)n);
  return JNI_OK;
}
__attribute__((constructor)) static void install_jni_hook(void) {
  typedef jint (*getvms_t)(JavaVM **, jsize, jsize *);
  getvms_t getvms = (getvms_t)dlsym(RTLD_DEFAULT, "JNI_GetCreatedJavaVMs");
  const char *libs[] = { "libjvm.so", "libj9vm29.so", 0 };
  for (int i = 0; !getvms && libs[i]; i++) { void *h = dlopen(libs[i], RTLD_NOW | RTLD_NOLOAD); if (h) getvms = (getvms_t)dlsym(h, "JNI_GetCreatedJavaVMs"); }
  if (!getvms) { fprintf(stderr, "[android-compat] JNI hook: no JVM found\n"); return; }
  JavaVM *vm = 0; jsize nvm = 0; JNIEnv *env = 0;
  if (getvms(&vm, 1, &nvm) != JNI_OK || nvm < 1 || (*vm)->GetEnv(vm, (void **)&env, JNI_VERSION_1_6) != JNI_OK || !env) { fprintf(stderr, "[android-compat] JNI hook: no env\n"); return; }
  struct JNINativeInterface_ *t = (struct JNINativeInterface_ *)*env;
  if (t->RegisterNatives == hook_register) return;
  long pg = sysconf(_SC_PAGESIZE); uintptr_t a = (uintptr_t)&t->RegisterNatives & ~(uintptr_t)(pg - 1);
  uintptr_t e = ((uintptr_t)&t->RegisterNatives + sizeof(void *) + pg - 1) & ~(uintptr_t)(pg - 1);
  if (mprotect((void *)a, (size_t)(e - a), PROT_READ | PROT_WRITE) != 0) { fprintf(stderr, "[android-compat] JNI hook: mprotect failed\n"); return; }
  orig_register = t->RegisterNatives; t->RegisterNatives = hook_register;
  fprintf(stderr, "[android-compat] JNI RegisterNatives hook installed\n");
}

/* ---- bionic stdio: NDK code addresses stdin/stdout/stderr as &__sF[0..2] (bionic FILE is 152 bytes on LP64).
 * Slot 2 (stderr, what libc++abi/abort paths write to) holds a byte copy of glibc's stderr _IO_FILE_plus, which glibc
 * accepts (same fd, same lock, same validated vtable). Slots 0/1 are inert. Go-built libraries, which crashed with
 * this symbol, are refused before loading (Native.isGo). */
#define BIONIC_FILE 152
__attribute__((visibility("default"), aligned(16))) unsigned char __sF[BIONIC_FILE * 2 + 512];
void android_set_abort_message(const char *msg) { if (msg) fprintf(stderr, "[android-compat] abort: %s\n", msg); }
__attribute__((constructor)) static void init_sF(void) { memcpy(__sF + BIONIC_FILE * 2, stderr, sizeof(FILE) + sizeof(void *)); }
void __assert2(const char *file, int line, const char *func, const char *expr) { fprintf(stderr, "[android-compat] assert %s:%d %s: %s\n", file ? file : "", line, func ? func : "", expr ? expr : ""); abort(); }

/* dex2c libraries export native constructors by JNI name (Java_pkg_Cls__0003cinit_0003e[__args]); the JVM never looks
 * those up, so tvbox.runtime.Native binds them to the rewritten $init$ methods. syms[i] = "short\nlong" names. */
JNIEXPORT jint JNICALL Java_tvbox_runtime_Native_bindCtors(JNIEnv *env, jclass self, jstring lib, jclass cls, jobjectArray syms, jobjectArray descs) {
  (void)self; const char *lp = (*env)->GetStringUTFChars(env, lib, 0); void *h = dlopen(lp, RTLD_NOW | RTLD_NOLOAD); (*env)->ReleaseStringUTFChars(env, lib, lp);
  if (!h) return 0;
  jint n = (*env)->GetArrayLength(env, syms), ok = 0;
  for (jint i = 0; i < n; i++) {
    jstring js = (jstring)(*env)->GetObjectArrayElement(env, syms, i), jd = (jstring)(*env)->GetObjectArrayElement(env, descs, i);
    const char *s = (*env)->GetStringUTFChars(env, js, 0), *d = (*env)->GetStringUTFChars(env, jd, 0);
    char buf[2048]; strncpy(buf, s, sizeof buf - 1); buf[sizeof buf - 1] = 0; char *nl = strchr(buf, '\n'); void *fn = 0;
    if (nl) { *nl = 0; fn = dlsym(h, nl + 1); } if (!fn) fn = dlsym(h, buf);
    if (fn) { JNINativeMethod m = { (char *)"$init$", (char *)d, fn };
      if ((orig_register ? orig_register : (*env)->RegisterNatives)(env, cls, &m, 1) == JNI_OK) ok++; else if ((*env)->ExceptionCheck(env)) (*env)->ExceptionClear(env); }
    (*env)->ReleaseStringUTFChars(env, js, s); (*env)->ReleaseStringUTFChars(env, jd, d);
  }
  dlclose(h); return ok;
}
