package tvbox.runtime;
import okhttp3.*; import java.util.concurrent.TimeUnit; import javax.net.ssl.*; import java.security.cert.X509Certificate;
/** Shared OkHttp client (trust-all TLS like TVBox hosts do). */
public final class Net {
  private static volatile OkHttpClient C;
  public static OkHttpClient client() {
    if (C == null) synchronized (Net.class) { if (C == null) {
      try {
        X509TrustManager tm = new X509TrustManager() { public void checkClientTrusted(X509Certificate[] c, String a) {} public void checkServerTrusted(X509Certificate[] c, String a) {} public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; } };
        SSLContext ctx = SSLContext.getInstance("TLS"); ctx.init(null, new TrustManager[]{tm}, new java.security.SecureRandom());
        C = new OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS).writeTimeout(20, TimeUnit.SECONDS)
          .sslSocketFactory(ctx.getSocketFactory(), tm).hostnameVerifier((h, s) -> true).retryOnConnectionFailure(true)
          .connectionPool(new ConnectionPool(6, 2, TimeUnit.MINUTES)).build();
      } catch (Exception e) { C = new OkHttpClient(); }
    } }
    return C;
  }
  /** Optional upstream proxy (env UPSTREAM_PROXY=http://ip:port | auto). OFF unless set. Installed as the default
   *  ProxySelector so OkHttp clients created by spiders use it too; the list is [proxy, DIRECT] so a dead proxy
   *  falls back to direct, and connectFailed() bypasses the proxy for 60s. Internal hosts are never proxied. */
  static volatile long proxyDownUntil = 0;
  public static void installProxy() {
    String spec = System.getenv().getOrDefault("UPSTREAM_PROXY", "").trim();
    if (spec.isEmpty() || spec.equals("off") || spec.equals("none")) return;
    String host = null; int port = 0;
    try {
      if (spec.equals("auto")) {
        String gw = gateway();
        for (int pt : new int[]{7890, 7897, 7893}) { if (gw == null) break; try (java.net.Socket so = new java.net.Socket()) { so.connect(new java.net.InetSocketAddress(gw, pt), 1500); host = gw; port = pt; break; } catch (Exception ignore) { } }
      } else { java.net.URI u = java.net.URI.create(spec.contains("://") ? spec : "http://" + spec); host = u.getHost(); port = u.getPort() > 0 ? u.getPort() : 80; }
    } catch (Exception e) { System.err.println("[net] bad UPSTREAM_PROXY " + spec); }
    if (host == null) { System.err.println("[net] no upstream proxy found (" + spec + ")"); return; }
    final java.net.Proxy px = new java.net.Proxy(java.net.Proxy.Type.HTTP, java.net.InetSocketAddress.createUnresolved(host, port));
    final java.util.List<java.net.Proxy> via = java.util.Arrays.asList(px, java.net.Proxy.NO_PROXY), direct = java.util.Collections.singletonList(java.net.Proxy.NO_PROXY);
    java.net.ProxySelector.setDefault(new java.net.ProxySelector() {
      @Override public java.util.List<java.net.Proxy> select(java.net.URI uri) {
        String h = uri == null ? null : uri.getHost();
        if (h == null || internal(h) || System.currentTimeMillis() < proxyDownUntil) return direct;
        String sc = uri.getScheme(); if (sc != null && !sc.startsWith("http") && !sc.equals("socket")) return direct;
        return via;
      }
      @Override public void connectFailed(java.net.URI uri, java.net.SocketAddress sa, java.io.IOException e) {
        if (sa != null) proxyDownUntil = System.currentTimeMillis() + 60000;
      }
    });
    System.err.println("[net] upstream proxy " + host + ":" + port + " (fallback direct)");
  }
  static boolean internal(String h) {
    h = h.toLowerCase(); if (h.startsWith("[")) h = h.substring(1, h.length() - 1);
    if (h.equals("localhost") || h.startsWith("tvbox-") || h.endsWith(".local") || h.endsWith(".lan")) return true;
    if (!h.contains(".") && !h.contains(":")) return true;
    if (h.matches("\\d+\\.\\d+\\.\\d+\\.\\d+")) { String[] a = h.split("\\."); int x = Integer.parseInt(a[0]), y = Integer.parseInt(a[1]);
      return x == 10 || x == 127 || x == 0 || (x == 172 && y >= 16 && y <= 31) || (x == 192 && y == 168) || (x == 169 && y == 254) || (x == 100 && y >= 64 && y <= 127); }
    return h.equals("::1") || h.startsWith("fe80") || h.startsWith("fc") || h.startsWith("fd");
  }
  static String gateway() {
    try { for (String l : java.nio.file.Files.readAllLines(java.nio.file.Paths.get("/proc/net/route"))) { String[] f = l.trim().split("\\s+");
      if (f.length > 2 && f[1].equals("00000000")) { String g = f[2]; return Integer.parseInt(g.substring(6, 8), 16) + "." + Integer.parseInt(g.substring(4, 6), 16) + "." + Integer.parseInt(g.substring(2, 4), 16) + "." + Integer.parseInt(g.substring(0, 2), 16); } } } catch (Exception ignore) { }
    return null;
  }
  public static byte[] get(String url) throws java.io.IOException {
    Request r = new Request.Builder().url(url).header("User-Agent", "okhttp/3.12.0").build();
    try (Response res = client().newCall(r).execute()) { if (!res.isSuccessful()) throw new java.io.IOException("HTTP " + res.code() + " " + url); return res.body().bytes(); }
  }
}
