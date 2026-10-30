package tvbox.runtime;
import com.github.catvod.crawler.Spider; import com.sun.net.httpserver.*; import org.json.*;
import java.io.*; import java.net.*; import java.nio.charset.StandardCharsets; import java.util.*; import java.util.concurrent.*;

/** TVBox Web spider-runtime: runs Android csp_ jar spiders on a plain JVM behind a tiny HTTP API. */
public class Main {
  public static int PORT = Integer.parseInt(System.getenv().getOrDefault("PORT", "9978"));
  static final long IDLE_MS = Long.parseLong(System.getenv().getOrDefault("IDLE_UNLOAD_MIN", "10")) * 60000L;
  static final int CALL_TIMEOUT = Integer.parseInt(System.getenv().getOrDefault("CALL_TIMEOUT_S", "25"));
  static final String TOKEN = System.getenv().getOrDefault("RUNTIME_TOKEN", "");
  static AppContext CTX; public static AppContext ctx() { return CTX; }
  static JarManager jm; static volatile long lastUse = System.currentTimeMillis();
  static final ThreadPoolExecutor calls = new ThreadPoolExecutor(12, 12, 60, TimeUnit.SECONDS, new LinkedBlockingQueue<>(64), r -> { Thread t = new Thread(r, "spider-call"); t.setDaemon(true); return t; });
  static { calls.allowCoreThreadTimeOut(true); }

  public static void main(String[] a) throws Exception {
    File data = new File(System.getenv().getOrDefault("DATA_DIR", "/data"));
    System.setProperty("spider.data", data.getAbsolutePath());
    java.security.Security.insertProviderAt(new Pkcs7Provider(), 1);
    Net.installProxy();
    AppContext ctx = new AppContext(data); CTX = ctx;
    jm = new JarManager(data, ctx);
    HttpServer s = HttpServer.create(new InetSocketAddress(PORT), 64);
    s.setExecutor(new ThreadPoolExecutor(4, 16, 60, TimeUnit.SECONDS, new SynchronousQueue<>(), new ThreadPoolExecutor.CallerRunsPolicy()));
    s.createContext("/health", ex -> send(ex, 200, "application/json", health().toString().getBytes(StandardCharsets.UTF_8)));
    s.createContext("/call", Main::call);
    s.createContext("/proxy", Main::proxy);
    s.start();
    System.err.println("spider-runtime listening on :" + PORT);
    ScheduledExecutorService sch = Executors.newSingleThreadScheduledExecutor(r -> { Thread t = new Thread(r, "idle"); t.setDaemon(true); return t; });
    sch.scheduleWithFixedDelay(() -> {
      if (!jm.jars.isEmpty() && System.currentTimeMillis() - lastUse > IDLE_MS) { System.err.println("[idle] unloading spiders"); jm.unloadAll(); System.gc(); Native.sweep(); }
    }, 60, 60, TimeUnit.SECONDS);
  }

  static JSONObject health() { try { return health0(); } catch (JSONException e) { return new JSONObject(); } }
  static JSONObject health0() throws JSONException {
    Runtime r = Runtime.getRuntime();
    return new JSONObject().put("ok", true).put("jars", jm.jars.size()).put("spiders", jm.spiders.size())
      .put("heap_used_mb", (r.totalMemory() - r.freeMemory()) / 1048576).put("heap_total_mb", r.totalMemory() / 1048576).put("idle_s", (System.currentTimeMillis() - lastUse) / 1000);
  }

  static boolean auth(HttpExchange ex) throws IOException {
    if (TOKEN.isEmpty() || TOKEN.equals(ex.getRequestHeaders().getFirst("X-Runtime-Token"))) return true;
    send(ex, 403, "text/plain", "forbidden".getBytes()); return false;
  }

  static void call(HttpExchange ex) throws IOException {
    if (!auth(ex)) return;
    lastUse = System.currentTimeMillis();
    JSONObject out = new JSONObject();
    try {
      JSONObject in = new JSONObject(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
      String jar = in.getString("jar"), key = in.optString("key"), api = in.getString("api"), method = in.getString("method");
      HostDb.setConfig(in.optString("config", ""));
      Object extO = in.opt("ext"); String ext = extO == null || extO == JSONObject.NULL ? "" : extO.toString();
      JSONArray args = in.optJSONArray("args"); if (args == null) args = new JSONArray();
      final JSONArray A = args;
      if (!jm.isLoaded(jar)) {
        // first use of this jar: download + dex2jar in the background; wait a little, else tell the caller to retry
        Future<JarManager.Loaded> lf = jm.loadAsync(jar);
        try { lf.get(Integer.parseInt(System.getenv().getOrDefault("WARM_WAIT_S", "20")), TimeUnit.SECONDS); }
        catch (TimeoutException te) { out.put("error", "warming: 正在下载并转换 jar 爬虫，请稍后重试").put("warming", true); send(ex, 200, "application/json; charset=utf-8", out.toString().getBytes(StandardCharsets.UTF_8)); return; }
      }
      Future<Object> f = calls.submit(() -> {
        Spider sp = jm.spider(jar, key, api, ext);
        ClassLoader prev = Thread.currentThread().getContextClassLoader();
        Thread.currentThread().setContextClassLoader(sp.getClass().getClassLoader());
        try { synchronized (sp) { return invoke(sp, method, A); } }
        finally { Thread.currentThread().setContextClassLoader(prev); }
      });
      Object r;
      try { r = f.get(CALL_TIMEOUT, TimeUnit.SECONDS); } catch (TimeoutException te) { f.cancel(true);
        // spiders that never return (blocking IO, waiting for a UI login) pin a worker each; when nearly all are pinned, restart (docker brings us back)
        if (calls.getActiveCount() >= calls.getMaximumPoolSize() - 1) { System.err.println("[runtime] all spider workers stuck, restarting"); new Thread(() -> { try { Thread.sleep(500); } catch (InterruptedException ie) { } Runtime.getRuntime().halt(3); }).start(); }
        throw new Exception("spider timeout " + CALL_TIMEOUT + "s"); }
      out.put("result", r == null ? "" : r);
    } catch (Throwable t) {
      Throwable c = t; while (c.getCause() != null && c.getCause() != c) c = c.getCause();
      String msg = c.toString();
      if (c instanceof NoClassDefFoundError || c instanceof ClassNotFoundException) msg = "unsupported (missing class " + c.getMessage() + ")";
      try { out.put("error", msg.length() > 300 ? msg.substring(0, 300) : msg); } catch (JSONException ignore) { }
      if (System.getenv("SPIDER_DEBUG") != null) t.printStackTrace();
      else if (c instanceof LinkageError || c instanceof RuntimeException) { StringBuilder sb = new StringBuilder("[call-error] ").append(msg); StackTraceElement[] st = c.getStackTrace(); for (int i = 0; i < Math.min(12, st.length); i++) sb.append("\n    at ").append(st[i]); System.err.println(sb); }
    }
    send(ex, 200, "application/json; charset=utf-8", out.toString().getBytes(StandardCharsets.UTF_8));
  }

  static List<String> strList(JSONArray a) { List<String> l = new ArrayList<>(); if (a != null) for (int i = 0; i < a.length(); i++) l.add(a.optString(i)); return l; }

  static Object invoke(Spider sp, String m, JSONArray a) throws Exception {
    switch (m) {
      case "home": return sp.homeContent(a.optBoolean(0, true));
      case "homeVod": return sp.homeVideoContent();
      case "category": {
        HashMap<String, String> ext = new HashMap<>(); JSONObject e = a.optJSONObject(3);
        if (e != null) for (Iterator<String> it = e.keys(); it.hasNext(); ) { String k = it.next(); ext.put(k, e.optString(k)); }
        return sp.categoryContent(a.optString(0), a.optString(1, "1"), a.optBoolean(2, false), ext);
      }
      case "detail": return sp.detailContent(Collections.singletonList(a.optString(0)));
      case "search": { String pg = a.optString(2, "1"); return "1".equals(pg) || pg.isEmpty() ? sp.searchContent(a.optString(0), a.optBoolean(1, false)) : sp.searchContent(a.optString(0), a.optBoolean(1, false), pg); }
      case "play": return sp.playerContent(a.optString(0), a.optString(1), strList(a.optJSONArray(2)));
      case "isVideo": return sp.isVideoFormat(a.optString(0));
      case "manualVideoCheck": return sp.manualVideoCheck();
      case "live": return sp.liveContent(a.optString(0));
      case "action": return sp.action(a.optString(0));
      default: throw new Exception("unknown method " + m);
    }
  }

  static void proxy(HttpExchange ex) throws IOException {
    lastUse = System.currentTimeMillis();
    Map<String, String> params = new LinkedHashMap<>();
    String q = ex.getRequestURI().getRawQuery();
    if (q != null) for (String kv : q.split("&")) { int i = kv.indexOf('='); String k = URLDecoder.decode(i < 0 ? kv : kv.substring(0, i), "UTF-8"); params.put(k, i < 0 ? "" : URLDecoder.decode(kv.substring(i + 1), "UTF-8")); }
    for (Map.Entry<String, List<String>> h : ex.getRequestHeaders().entrySet()) if (h.getKey().equalsIgnoreCase("range")) params.put("range", h.getValue().get(0));
    try {
      Object[] r = jm.proxy(params);
      if (r == null) { send(ex, 404, "text/plain", "no proxy".getBytes()); return; }
      int code = r[0] instanceof Number ? ((Number) r[0]).intValue() : 200;
      String mime = r[1] == null ? "application/octet-stream" : r[1].toString();
      if (r.length > 3 && r[3] instanceof Map) for (Object o : ((Map<?, ?>) r[3]).entrySet()) { Map.Entry<?, ?> e = (Map.Entry<?, ?>) o; ex.getResponseHeaders().add(String.valueOf(e.getKey()), String.valueOf(e.getValue())); }
      ex.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
      Object body = r[2];
      if (code == 302 || code == 301) { if (body != null && !ex.getResponseHeaders().containsKey("Location")) ex.getResponseHeaders().set("Location", body.toString()); send(ex, code, mime, new byte[0]); return; }
      if (body instanceof InputStream) {
        ex.getResponseHeaders().set("Content-Type", mime);
        ex.sendResponseHeaders(code, 0);
        try (InputStream in = (InputStream) body; OutputStream os = ex.getResponseBody()) { in.transferTo(os); }
        return;
      }
      byte[] b = body instanceof byte[] ? (byte[]) body : String.valueOf(body).getBytes(StandardCharsets.UTF_8);
      send(ex, code, mime, b);
    } catch (Throwable t) { send(ex, 500, "text/plain", String.valueOf(t).getBytes(StandardCharsets.UTF_8)); }
  }

  static void send(HttpExchange ex, int code, String type, byte[] b) throws IOException {
    ex.getResponseHeaders().set("Content-Type", type);
    ex.sendResponseHeaders(code, b.length == 0 ? -1 : b.length);
    if (b.length > 0) try (OutputStream os = ex.getResponseBody()) { os.write(b); }
    ex.close();
  }
}
