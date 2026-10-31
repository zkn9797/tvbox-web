package tvbox.runtime;
import java.io.*; import java.nio.*; import java.nio.file.*; import java.security.MessageDigest; import java.util.*;

/** Lets Android NDK .so files (bionic) load on glibc: neutralise bionic symbol versioning (DT_VERSYM/VERNEED)
 *  and resolve Android library names. Calls are injected in front of System.load/loadLibrary by NativeLoader. */
public final class Native {
  public static void noop() { }

  // ---- native constructors of dex2c libraries (see Frames.nativeCtors and android-shim bindCtors) ----
  static native int bindCtors(String lib, Class<?> cls, String[] syms, String[] descs);
  static volatile int shim; // 0 unknown, 1 loaded, -1 unavailable
  static boolean shim() {
    if (shim == 0) synchronized (Native.class) { if (shim == 0) { shim = -1;
      for (String d : System.getenv().getOrDefault("LD_LIBRARY_PATH", "").split(":")) { File f = new File(d, "libc.so"); if (d.isEmpty() || !f.isFile()) continue;
        try { System.load(f.getAbsolutePath()); shim = 1; break; } catch (Throwable t) { System.err.println("[native] shim load failed: " + t); } } } }
    return shim == 1;
  }
  static final Set<String> DBG_CTOR = Collections.synchronizedSet(new HashSet<>());
  static final Map<Class<?>, Boolean> BOUND = Collections.synchronizedMap(new WeakHashMap<>());
  static String mangle(String s) { StringBuilder b = new StringBuilder();
    for (char ch : s.toCharArray()) { if (ch == '/' || ch == '.') b.append('_'); else if (ch == '_') b.append("_1"); else if (ch == ';') b.append("_2"); else if (ch == '[') b.append("_3");
      else if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9')) b.append(ch); else b.append(String.format("_0%04x", (int) ch)); }
    return b.toString(); }
  /** called by rewritten constructors before $init$: bind it to the library's exported <init> implementation */
  public static void bindCtor(Class<?> c) {
    if (BOUND.containsKey(c)) return;
    if (!shim()) { if (DBG_CTOR.add("shim")) System.err.println("[native] android-shim not loadable; native constructors unbound"); return; }
    List<String> syms = new ArrayList<>(), descs = new ArrayList<>();
    String base = "Java_" + mangle(c.getName()) + "_" + mangle("<init>");
    for (java.lang.reflect.Method m : c.getDeclaredMethods()) if (m.getName().equals("$init$")) {
      String d = org.objectweb.asm.Type.getMethodDescriptor(m); String args = d.substring(1, d.indexOf(')'));
      syms.add(base + "\n" + base + "__" + mangle(args)); descs.add(d); }
    if (syms.isEmpty()) { BOUND.put(c, true); return; }
    Set<String> libs = new LinkedHashSet<>(); synchronized (Native.class) { for (Map.Entry<String, WeakHashMap<ClassLoader, String>> e : OWNERS.entrySet()) { libs.add(e.getKey()); libs.addAll(e.getValue().values()); } }
    int ok = 0; for (String l : libs) { try { ok += bindCtors(l, c, syms.toArray(new String[0]), descs.toArray(new String[0])); } catch (Throwable t) { System.err.println("[native] bindCtors: " + t); return; } if (ok >= syms.size()) break; }
    if (ok > 0) { BOUND.put(c, true); System.err.println("[native] bound " + ok + " native constructor(s) of " + c.getName()); }
    else if (DBG_CTOR.add(c.getName())) System.err.println("[native] no native constructor found for " + c.getName() + " in " + libs + " (" + syms.get(0).replace('\n', ' ') + ")");
  }
  static File dir() { File d = new File(System.getenv().getOrDefault("DATA_DIR", "/data"), "native"); d.mkdirs(); return d; }

  // The JVM refuses to load one native library file into two class loaders ("already loaded in another
  // classloader") - this happens when a jar is reloaded after the idle unload, or when guard jars create several
  // inner class loaders that all System.load the same .so. Each class loader therefore gets its own copy of the file.
  static final StackWalker SW = StackWalker.getInstance(StackWalker.Option.RETAIN_CLASS_REFERENCE);
  static final Map<String, WeakHashMap<ClassLoader, String>> OWNERS = new HashMap<>();
  static final java.util.concurrent.atomic.AtomicInteger SEQ = new java.util.concurrent.atomic.AtomicInteger();
  static File copiesDir() { File d = new File(dir(), "cl"); d.mkdirs(); return d; }
  static { try { File[] l = new File(dir(), "cl").listFiles(); if (l != null) for (File f : l) f.delete(); } catch (Throwable ignore) { } }

  static synchronized String perLoader(String path, ClassLoader cl) {
    if (cl == null) return path;
    WeakHashMap<ClassLoader, String> m = OWNERS.get(path);
    if (m == null) { m = new WeakHashMap<>(); OWNERS.put(path, m); m.put(cl, path); return path; } // first user ever: canonical file
    String have = m.get(cl); if (have != null) return have;
    try {
      File src = new File(path); String n = src.getName().replaceFirst("\\.so$", "");
      File out = new File(copiesDir(), n + "-" + ProcessHandle.current().pid() + "-" + SEQ.incrementAndGet() + ".so");
      Files.copy(src.toPath(), out.toPath(), StandardCopyOption.REPLACE_EXISTING);
      out.deleteOnExit();
      m.put(cl, out.getAbsolutePath());
      System.err.println("[native] " + src.getName() + " -> per-classloader copy " + out.getName());
      return out.getAbsolutePath();
    } catch (Throwable t) { return path; }
  }
  /** remove copies whose class loader is gone (called after unload + gc) */
  static synchronized void sweep() {
    java.util.Set<String> live = new java.util.HashSet<>();
    for (WeakHashMap<ClassLoader, String> m : OWNERS.values()) live.addAll(m.values());
    File[] l = copiesDir().listFiles(); if (l != null) for (File f : l) if (!live.contains(f.getAbsolutePath())) f.delete();
  }

  /** System.load(path) -> System.load(fix(path)) */
  public static String fix(String path) {
    Class<?> c = SW.getCallerClass();
    String p = fix0(path);
    return perLoader(p, c == null ? null : c.getClassLoader());
  }
  static String fix0(String path) {
    try {
      File f = new File(path); if (!f.isFile()) return path;
      byte[] b = Files.readAllBytes(f.toPath());
      // Go-built Android libraries expect bionic TLS and segfault the whole JVM on load: refuse them
      if (isGo(b)) throw new UnsatisfiedLinkError("Go-built Android library not supported: " + f.getName());
      byte[] p = patch(b); if (p == null) return path;
      File out = new File(dir(), "lib" + md5(b) + ".so");
      if (!out.exists()) { File tmp = new File(out.getPath() + ".tmp"); Files.write(tmp.toPath(), p); tmp.renameTo(out); }
      return out.getAbsolutePath();
    } catch (UnsatisfiedLinkError e) { throw e; } catch (Throwable t) { return path; }
  }
  static boolean isGo(byte[] b) { byte[] m = "\u00ff Go buildinf:".getBytes(java.nio.charset.StandardCharsets.ISO_8859_1); byte[] m2 = "Go build ID: \"".getBytes(java.nio.charset.StandardCharsets.ISO_8859_1); return NativeLoader.indexOf(b, m) >= 0 || NativeLoader.indexOf(b, m2) >= 0; }

  /** System.loadLibrary(name) -> System.load(libPath(name)) */
  public static String libPath(String name) {
    Class<?> c = SW.getCallerClass(); ClassLoader cl = c == null ? null : c.getClassLoader();
    String file = "lib" + name + ".so";
    String[] dirs = { System.getProperty("tvbox.libdir", ""), new File(System.getenv().getOrDefault("DATA_DIR", "/data"), "lib").getPath(), dir().getPath() };
    for (String d : dirs) { if (d.isEmpty()) continue; File f = new File(d, file); if (f.isFile()) return perLoader(fix0(f.getAbsolutePath()), cl); }
    for (String d : System.getProperty("java.library.path", "").split(File.pathSeparator)) { File f = new File(d, file); if (f.isFile()) return f.getAbsolutePath(); }
    throw new UnsatisfiedLinkError("no " + name + " (Android native library not available)");
  }

  /** returns patched copy, or null if not an ELF64 needing changes */
  static byte[] patch(byte[] in) {
    if (in.length < 64 || in[0] != 0x7f || in[1] != 'E' || in[2] != 'L' || in[3] != 'F' || in[4] != 2 || in[5] != 1) return null;
    ByteBuffer bb = ByteBuffer.wrap(in.clone()).order(ByteOrder.LITTLE_ENDIAN);
    long phoff = bb.getLong(32); int phentsize = bb.getShort(54) & 0xffff, phnum = bb.getShort(56) & 0xffff;
    boolean changed = false;
    for (int i = 0; i < phnum; i++) {
      int ph = (int) (phoff + (long) i * phentsize);
      if (bb.getInt(ph) != 2) continue; // PT_DYNAMIC
      long off = bb.getLong(ph + 8), sz = bb.getLong(ph + 32);
      for (long o = off; o + 16 <= off + sz; o += 16) {
        long tag = bb.getLong((int) o);
        if (tag == 0) break;
        if (tag == 0x6ffffff0L || tag == 0x6ffffffeL || tag == 0x6fffffffL) { bb.putLong((int) o, 0x6ffffdf8L); changed = true; } // VERSYM/VERNEED/VERNEEDNUM -> DT_CHECKSUM
      }
    }
    return changed ? bb.array() : null;
  }
  static String md5(byte[] b) throws Exception { StringBuilder s = new StringBuilder(); for (byte x : MessageDigest.getInstance("MD5").digest(b)) s.append(String.format("%02x", x)); return s.toString(); }
  public static void exit(int code) { System.err.println("[runtime] blocked System.exit(" + code + ") from spider"); throw new IllegalStateException("System.exit blocked"); }
  public static void rtExit(Runtime r, int code) { exit(code); }
}
