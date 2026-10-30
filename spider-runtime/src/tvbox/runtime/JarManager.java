package tvbox.runtime;
import com.github.catvod.crawler.Spider; import java.io.*; import java.net.*; import java.nio.file.*; import java.security.MessageDigest; import java.util.*; import java.util.concurrent.*; import java.util.zip.*;

/** Downloads spider jars, converts dex -> JVM bytecode (cached by md5), loads csp_ classes. */
public class JarManager {
  final File dir; final AppContext ctx;
  final Map<String, Loaded> jars = new ConcurrentHashMap<>();
  final Map<String, Spider> spiders = new ConcurrentHashMap<>();
  final Map<String, Object> locks = new ConcurrentHashMap<>();
  volatile String lastJar;
  static JarManager INSTANCE;
  public JarManager(File dataDir, AppContext ctx) { this.dir = new File(dataDir, "jars"); dir.mkdirs(); this.ctx = ctx; INSTANCE = this;
    // guard jars drop read-only decrypted payloads here and fail to rewrite them on the next start: start clean (as after an app update)
    rmrf(new File(dataDir, "code_cache"));
  }
  static void rmrf(File f) { File[] l = f.listFiles(); if (l != null) for (File c : l) rmrf(c); f.setWritable(true); f.delete(); }

  /** Used by dalvik.system.DexClassLoader shims: convert a local dex/jar/apk (cached by content md5). */
  public static URLClassLoader convertLocal(String path, ClassLoader parent) throws Exception {
    List<URL> urls = new ArrayList<>();
    for (String one : path.split(":")) {
      if (one.isEmpty()) continue;
      byte[] raw = Files.readAllBytes(new File(one).toPath());
      String key = "local2-" + md5(raw);
      File d = INSTANCE.dir;
      if (raw.length > 4 && raw[0] == 'd' && raw[1] == 'e' && raw[2] == 'x') {
        File out = new File(d, key + "." + DexFix.VERSION + ".dex0.jar");
        if (!out.exists() || out.length() < 200) { File tmp = new File(d, key + ".dex"); Files.write(tmp.toPath(), raw); d2j(tmp, out); }
        urls.add(out.toURI().toURL());
      } else {
        File src = new File(d, key + ".src.jar"); if (!src.exists()) Files.write(src.toPath(), extractZip(raw));
        try (ZipFile zf = new ZipFile(src)) { int i = 0; for (ZipEntry e : Collections.list(zf.entries())) { if (!e.getName().matches("classes\\d*\\.dex")) continue;
          File out = new File(d, key + "." + DexFix.VERSION + ".dex" + (i++) + ".jar");
          if (!out.exists() || out.length() < 200) { File tmp = new File(d, key + ".tmp.dex"); try (InputStream in = zf.getInputStream(e)) { Files.copy(in, tmp.toPath(), StandardCopyOption.REPLACE_EXISTING); }
            d2j(tmp, out); }
          urls.add(out.toURI().toURL()); } }
        urls.add(src.toURI().toURL());
      }
    }
    NativeLoader nl = new NativeLoader(urls.toArray(new URL[0]), parent); INNER.add(nl); return nl;
  }
  /** class loaders created by spiders themselves (guard/packed jars load a decrypted dex at runtime) */
  static final List<ClassLoader> INNER = new java.util.concurrent.CopyOnWriteArrayList<>();

  /** dex -> jar via a .part file, so an interrupted conversion never leaves a broken cache entry */
  static synchronized void d2j(File dex, File out) throws IOException {
    File part = new File(out.getPath() + ".part"); part.delete(); long t0 = System.currentTimeMillis();
    try { DexFix.convert(dex, part); } catch (Exception e) { part.delete(); throw new IOException("dex2jar failed for " + dex.getName() + ": " + e, e); }
    dex.delete(); new File(out.getPath().replace("." + DexFix.VERSION + ".", ".")).delete(); // cache from an older conversion
    if (!part.exists() || part.length() < 200) { part.delete(); throw new IOException("dex2jar failed for " + dex.getName()); }
    Files.move(part.toPath(), out.toPath(), StandardCopyOption.REPLACE_EXISTING);
    System.err.println("[jar] converted local dex " + out.getName() + " in " + (System.currentTimeMillis() - t0) + "ms");
  }

  static class Loaded { URLClassLoader cl; String key; long loadedAt = System.currentTimeMillis(); }

  static String md5(byte[] b) { try { MessageDigest m = MessageDigest.getInstance("MD5"); StringBuilder sb = new StringBuilder(); for (byte x : m.digest(b)) sb.append(String.format("%02x", x)); return sb.toString(); } catch (Exception e) { throw new RuntimeException(e); } }

  /** jar spec: "url", "url;md5;hash", "img+url" ... */
  // conversions are serialized (dex2jar is memory hungry on big obfuscated methods)
  final ExecutorService convertPool = Executors.newSingleThreadExecutor(r -> { Thread t = new Thread(r, "jar-loader"); t.setDaemon(true); return t; });
  final Map<String, Future<Loaded>> pending = new ConcurrentHashMap<>();
  static String keyOf(String spec) { try { String[] p = spec.split(";"); return p.length >= 3 && p[1].equalsIgnoreCase("md5") ? p[2].trim().toLowerCase() : md5(p[0].trim().getBytes("UTF-8")); } catch (Exception e) { return spec; } }
  public boolean isLoaded(String spec) { return jars.containsKey(keyOf(spec)); }
  /** Start (or join) a background load; returns the future. */
  public Future<Loaded> loadAsync(String spec) {
    String k = keyOf(spec);
    return pending.computeIfAbsent(k, kk -> convertPool.submit(() -> { try { return jar(spec); } finally { pending.remove(kk); } }));
  }

  public Loaded jar(String spec) throws Exception {
    String[] parts = spec.split(";");
    String url = parts[0].trim().replaceFirst("^img\\+", "");
    String want = parts.length >= 3 && parts[1].equalsIgnoreCase("md5") ? parts[2].trim().toLowerCase() : null;
    String key = want != null ? want : md5(url.getBytes("UTF-8"));
    Loaded l = jars.get(key);
    if (l != null) { lastJar = key; return l; }
    synchronized (locks.computeIfAbsent("jar:" + key, k -> new Object())) {
      l = jars.get(key);
      if (l != null) return l;
      File src = new File(dir, key + ".src.jar");
      if (!src.exists() || want == null) {
        byte[] raw = Net.get(url);
        byte[] zip = extractZip(raw);
        if (want != null && !md5(raw).equals(want) && !md5(zip).equals(want)) System.err.println("[jar] md5 mismatch for " + url + " (using anyway)");
        Files.write(src.toPath(), zip);
        for (File old : dir.listFiles((d, n) -> n.startsWith(key + ".") && n.endsWith(".jar") && !n.endsWith(".src.jar"))) old.delete();
      }
      List<URL> urls = new ArrayList<>();
      try (ZipFile zf = new ZipFile(src)) {
        List<? extends ZipEntry> dexes = Collections.list(zf.entries());
        int i = 0;
        for (ZipEntry e : dexes) {
          if (!e.getName().matches("classes\\d*\\.dex")) continue;
          File out = new File(dir, key + "." + DexFix.VERSION + ".dex" + (i++) + ".jar");
          if (!out.exists() || out.length() < 200) {
            new File(dir, key + ".dex" + (i - 1) + ".jar").delete(); // cache from an older conversion
            File part = new File(dir, key + ".dex" + (i - 1) + ".part.jar"); part.delete();
            File tmp = File.createTempFile("dex", ".dex", dir);
            try (InputStream in = zf.getInputStream(e)) { Files.copy(in, tmp.toPath(), StandardCopyOption.REPLACE_EXISTING); }
            long t0 = System.currentTimeMillis();
            try { DexFix.convert(tmp, part); } catch (Exception ex) { part.delete(); throw new IOException("dex2jar failed for " + e.getName() + ": " + ex, ex); } finally { tmp.delete(); }
            if (!part.exists() || part.length() < 200) throw new IOException("dex2jar failed for " + e.getName());
            Files.move(part.toPath(), out.toPath(), StandardCopyOption.REPLACE_EXISTING);
            System.err.println("[jar] converted " + url + " " + e.getName() + " in " + (System.currentTimeMillis() - t0) + "ms");
          }
          urls.add(out.toURI().toURL());
        }
      }
      if (urls.isEmpty()) throw new IOException("no classes.dex in spider jar");
      urls.add(src.toURI().toURL()); // assets/ resources
      l = new Loaded(); l.key = key;
      l.cl = new NativeLoader(urls.toArray(new URL[0]), JarManager.class.getClassLoader());
      // TVBox host behaviour: call com.github.catvod.spider.Init.init(Context) once per jar
      ClassLoader prev = Thread.currentThread().getContextClassLoader();
      Thread.currentThread().setContextClassLoader(l.cl);
      try {
        Class<?> init = l.cl.loadClass("com.github.catvod.spider.Init");
        try { init.getMethod("init", android.content.Context.class).invoke(null, ctx); } catch (NoSuchMethodException ignore) { }
      } catch (ClassNotFoundException ignore) {
      } catch (Throwable t) { System.err.println("[jar] Init.init failed: " + root(t)); }
      finally { Thread.currentThread().setContextClassLoader(prev); }
      try { Class<?> p = l.cl.loadClass("com.github.catvod.spider.Proxy"); try { java.lang.reflect.Field f = p.getDeclaredField("port"); f.setAccessible(true); if (f.getType() == int.class) f.setInt(null, Main.PORT); } catch (NoSuchFieldException ignore) { } } catch (Throwable ignore) { }
      jars.put(key, l); lastJar = key;
      return l;
    }
  }

  /** Spider jars are often disguised as images or wrapped; find the embedded zip. */
  static byte[] extractZip(byte[] raw) throws IOException {
    if (raw.length > 4 && raw[0] == 'P' && raw[1] == 'K') return raw;
    for (int i = 0; i < raw.length - 4; i++) if (raw[i] == 'P' && raw[i + 1] == 'K' && raw[i + 2] == 3 && raw[i + 3] == 4) return Arrays.copyOfRange(raw, i, raw.length);
    String s = new String(raw, "ISO-8859-1"); int star = s.indexOf("**");
    String b64 = (star >= 0 ? s.substring(star + 2) : s).replaceAll("\\s", "");
    try { byte[] d = Base64.getMimeDecoder().decode(b64); if (d.length > 4 && d[0] == 'P' && d[1] == 'K') return d; } catch (Exception ignore) { }
    throw new IOException("spider jar is not a zip (" + raw.length + " bytes)");
  }

  public Spider spider(String jarSpec, String siteKey, String api, String ext) throws Exception {
    String id = jarSpec + "|" + siteKey + "|" + api + "|" + (ext == null ? "" : ext.hashCode());
    Spider s = spiders.get(id);
    if (s != null) return s;
    synchronized (locks.computeIfAbsent("sp:" + id, k -> new Object())) {
      s = spiders.get(id);
      if (s != null) return s;
      Loaded l = jar(jarSpec);
      String cls = "com.github.catvod.spider." + api.replaceFirst("^csp_", "");
      ClassLoader prev = Thread.currentThread().getContextClassLoader();
      Thread.currentThread().setContextClassLoader(l.cl);
      try {
        guardFixup(l.cl);
        s = (Spider) l.cl.loadClass(cls).getDeclaredConstructor().newInstance();
        guardFixup(l.cl);
        try { s.siteKey = siteKey; } catch (Throwable ignore) { }
        s.init(ctx, ext == null ? "" : ext);
      } finally { Thread.currentThread().setContextClassLoader(prev); }
      spiders.put(id, s);
      return s;
    }
  }

  /** 饭太硬 guard jars: the decrypted inner dex reaches the outer native bridge through InitOrigin.i, which the
   *  Android host path sets via JNI; set it ourselves when it is still null. */
  static void guardFixup(ClassLoader outer) {
    Class<?> bridge; try { bridge = outer.loadClass("com.github.catvod.spider.DexNative"); } catch (Throwable t) { return; }
    for (ClassLoader in : INNER) {
      try { Class<?> io = in.loadClass("com.github.catvod.spider.InitOrigin"); java.lang.reflect.Field f = io.getField("i");
        if (f.getType() == Class.class && f.get(null) == null) { f.set(null, bridge); System.err.println("[jar] guard: InitOrigin.i <- DexNative"); }
      } catch (Throwable ignore) { }
    }
  }

  public Object[] proxy(Map<String, String> params) throws Exception {
    List<String> order = new ArrayList<>(); if (lastJar != null) order.add(lastJar);
    for (String k : jars.keySet()) if (!order.contains(k)) order.add(k);
    for (String k : order) {
      Loaded l = jars.get(k); if (l == null) continue;
      try {
        Class<?> p = l.cl.loadClass("com.github.catvod.spider.Proxy");
        Object r = p.getMethod("proxy", Map.class).invoke(null, params);
        if (r instanceof Object[] && ((Object[]) r).length >= 3) return (Object[]) r;
      } catch (ClassNotFoundException ignore) { }
      try { // guard jars: Init.proxyInvoke(Map) bridges to the decrypted ProxyOrigin
        Object r = l.cl.loadClass("com.github.catvod.spider.Init").getMethod("proxyInvoke", Map.class).invoke(null, params);
        if (r instanceof Object[] && ((Object[]) r).length >= 3) return (Object[]) r;
      } catch (ClassNotFoundException | NoSuchMethodException ignore) { }
    }
    for (ClassLoader in : INNER) {
      try {
        Class<?> p = in.loadClass("com.github.catvod.spider.Proxy");
        Object r = p.getMethod("proxy", Map.class).invoke(null, params);
        if (r instanceof Object[] && ((Object[]) r).length >= 3) return (Object[]) r;
      } catch (ClassNotFoundException | NoSuchMethodException ignore) { }
    }
    return null;
  }

  public synchronized void unloadAll() {
    for (Spider s : spiders.values()) try { s.destroy(); } catch (Throwable ignore) { }
    spiders.clear();
    for (Loaded l : jars.values()) try { l.cl.close(); } catch (Throwable ignore) { }
    for (ClassLoader in : INNER) try { if (in instanceof URLClassLoader) ((URLClassLoader) in).close(); } catch (Throwable ignore) { }
    INNER.clear(); // inner (guard) loaders otherwise keep the old outer loader - and its native libs - alive forever
    jars.clear(); lastJar = null;
  }

  static String root(Throwable t) { while (t.getCause() != null && t.getCause() != t) t = t.getCause(); return t.toString(); }
}
