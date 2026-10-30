/* Minimal bionic compatibility for Android NDK libraries loaded into a glibc JVM (tvbox spider-runtime).
 * Provides liblog (__android_log_*) so lazily-bound log calls do not abort the process. */
#include <stdarg.h>
#include <stdio.h>
#include <errno.h>
#include <string.h>
static const char *lv(int p) { static const char *n[] = {"?","?","V","D","I","W","E","F"}; return (p >= 0 && p < 8) ? n[p] : "?"; }
int __android_log_write(int prio, const char *tag, const char *text) { if (prio >= 5) fprintf(stderr, "[%s/%s] %s\n", lv(prio), tag ? tag : "", text ? text : ""); return 1; }
int __android_log_vprint(int prio, const char *tag, const char *fmt, va_list ap) { if (prio >= 5) { fprintf(stderr, "[%s/%s] ", lv(prio), tag ? tag : ""); vfprintf(stderr, fmt, ap); fputc('\n', stderr); } return 1; }
int __android_log_print(int prio, const char *tag, const char *fmt, ...) { va_list ap; va_start(ap, fmt); int r = __android_log_vprint(prio, tag, fmt, ap); va_end(ap); return r; }
void __android_log_assert(const char *c, const char *tag, const char *fmt, ...) { fprintf(stderr, "assert %s %s\n", c ? c : "", tag ? tag : ""); }
int __android_log_buf_write(int b, int prio, const char *tag, const char *text) { return __android_log_write(prio, tag, text); }
int __android_log_is_loggable(int prio, const char *tag, int def) { return prio >= 5; }
/* Deliberately NOT providing bionic __sF/__errno: libraries that need them (Go c-shared Android builds etc.)
 * crash glibc processes on load, so letting dlopen fail with "undefined symbol" keeps the JVM alive. */
