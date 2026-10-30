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
