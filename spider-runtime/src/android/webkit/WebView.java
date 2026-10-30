package android.webkit;
import org.mozilla.javascript.*; import java.util.*;
/**
 * Headless WebView (tier 1): JavaScript runs in Rhino (no DOM). Covers spiders that use WebView only to execute JS
 * (evaluateJavascript / addJavascriptInterface / loadUrl("javascript:...")). Loading http(s) pages goes through the
 * optional tier-2 sniffer (env SNIFFER_URL): every request the real browser made is replayed to
 * WebViewClient.shouldInterceptRequest/onLoadResource, then onPageFinished. Without a sniffer the page HTML is fetched
 * and its inline scripts are evaluated best-effort.
 */
public class WebView extends android.view.ViewGroup {
  WebViewClient client = new WebViewClient(); WebChromeClient chrome = new WebChromeClient(); final WebSettings settings = new WebSettings();
  final Map<String, Object> ifaces = new LinkedHashMap<>(); ScriptableObject scope; String url, title = "";
  static final android.os.Handler H = new android.os.Handler(android.os.Looper.getMainLooper());
  public WebView(android.content.Context c) { super(c); } public WebView(android.content.Context c, Object attrs) { super(c); }
  public WebSettings getSettings() { return settings; }
  public void setWebViewClient(WebViewClient c) { client = c == null ? new WebViewClient() : c; } public void setWebChromeClient(WebChromeClient c) { chrome = c == null ? new WebChromeClient() : c; }
  public WebViewClient getWebViewClient() { return client; } public String getUrl() { return url; } public String getTitle() { return title; } public String getOriginalUrl() { return url; }
  public void addJavascriptInterface(Object o, String name) { ifaces.put(name, o); if (scope != null) bind(name, o); }
  public void removeJavascriptInterface(String name) { ifaces.remove(name); if (scope != null) scope.delete(name); }
  public static void setWebContentsDebuggingEnabled(boolean b) {} public void destroy() { scope = null; } public void stopLoading() {} public void reload() { if (url != null) loadUrl(url); }
  public void clearCache(boolean b) {} public void clearHistory() {} public void onPause() {} public void onResume() {} public void pauseTimers() {} public void resumeTimers() {} public boolean canGoBack() { return false; } public void goBack() {}
  public void setLayerType(int t, Object p) {} public void setInitialScale(int s) {}

  synchronized Context enter() { Context cx = Context.enter(); cx.setOptimizationLevel(-1); cx.setLanguageVersion(Context.VERSION_ES6);
    if (scope == null) { scope = cx.initStandardObjects(); ScriptableObject.putProperty(scope, "window", scope); ScriptableObject.putProperty(scope, "self", scope); ScriptableObject.putProperty(scope, "globalThis", scope);
      ScriptableObject.putProperty(scope, "__wv", Context.javaToJS(this, scope));
      cx.evaluateString(scope, "var console={log:function(){},error:function(){},warn:function(){},info:function(){}};" +
        "var navigator={userAgent:String(__wv.getSettings().getUserAgentString()),platform:'Linux armv8l',language:'zh-CN'};" +
        "var location={href:String(__wv.getUrl()||'about:blank')};var document={cookie:'',title:'',referrer:'',createElement:function(){return {style:{},setAttribute:function(){},appendChild:function(){}}},getElementById:function(){return null},querySelector:function(){return null},addEventListener:function(){}};" +
        "function atob(s){return String(new java.lang.String(java.util.Base64.getMimeDecoder().decode(String(s)),'ISO-8859-1'))}" +
        "function btoa(s){return String(java.util.Base64.getEncoder().encodeToString(new java.lang.String(String(s)).getBytes('ISO-8859-1')))}" +
        "function setTimeout(f,t){if(typeof f==='function')f();return 0}function clearTimeout(){}", "init", 1, null);
      for (Map.Entry<String, Object> e : ifaces.entrySet()) bind(e.getKey(), e.getValue()); }
    return cx; }
  void bind(String name, Object o) { ScriptableObject.putProperty(scope, name, Context.javaToJS(o, scope)); }

  /** Evaluate synchronously; returns the Android-style JSON encoding of the result. */
  public String evalJs(String script) {
    Context cx = enter();
    try { Object r = cx.evaluateString(scope, script, url == null ? "webview" : url, 1, null);
      if (r == null || r instanceof Undefined) return "null";
      Object j = NativeJSON.stringify(cx, scope, r, null, null); return j instanceof String ? (String) j : "null";
    } catch (Throwable t) { android.util.Log.w("WebView", "js error: " + t); return "null"; } finally { Context.exit(); }
  }
  public void evaluateJavascript(String script, ValueCallback<String> cb) { H.post(() -> { String r = evalJs(script); if (cb != null) cb.onReceiveValue(r); }); }

  public void loadUrl(String u, Map<String, String> headers) { loadUrl(u); }
  public void loadUrl(String u) {
    if (u == null) return;
    if (u.startsWith("javascript:")) { String js = u.substring(11); H.post(() -> evalJs(js)); return; }
    url = u;
    new Thread(() -> loadPage(u), "webview-load").start();
  }
  public void loadData(String data, String mime, String enc) { loadDataWithBaseURL("about:blank", data, mime, enc, null); }
  public void loadDataWithBaseURL(String base, String data, String mime, String enc, String hist) { url = base; H.post(() -> { runInlineScripts(data); client.onPageFinished(this, base); chrome.onProgressChanged(this, 100); }); }

  void runInlineScripts(String html) {
    if (html == null) return;
    org.jsoup.nodes.Document d = org.jsoup.Jsoup.parse(html); title = d.title();
    for (org.jsoup.nodes.Element s : d.select("script:not([src])")) evalJs(s.data());
  }
  static final class Req implements WebResourceRequest { final String u; final boolean main; Req(String u, boolean m) { this.u = u; main = m; }
    public android.net.Uri getUrl() { return android.net.Uri.parse(u); } public boolean isForMainFrame() { return main; } public boolean isRedirect() { return false; } public boolean hasGesture() { return false; }
    public String getMethod() { return "GET"; } public Map<String, String> getRequestHeaders() { return new HashMap<>(); } }

  void loadPage(String u) {
    H.post(() -> client.onPageStarted(this, u, null));
    String sniffer = System.getenv("SNIFFER_URL");
    try {
      if (sniffer != null && !sniffer.isEmpty()) {
        org.json.JSONObject req = new org.json.JSONObject().put("url", u).put("ua", settings.getUserAgentString()).put("timeout", 15000).put("collect", "all");
        okhttp3.Request r = new okhttp3.Request.Builder().url(sniffer.replaceAll("/+$", "") + "/sniff").post(okhttp3.RequestBody.create(okhttp3.MediaType.get("application/json"), req.toString())).build();
        try (okhttp3.Response res = tvbox.runtime.Net.client().newBuilder().readTimeout(30, java.util.concurrent.TimeUnit.SECONDS).build().newCall(r).execute()) {
          org.json.JSONObject j = new org.json.JSONObject(res.body().string());
          org.json.JSONArray reqs = j.optJSONArray("requests");
          if (reqs != null) for (int i = 0; i < reqs.length(); i++) { String ru = reqs.optString(i); client.shouldInterceptRequest(this, new Req(ru, i == 0)); client.onLoadResource(this, ru); }
          String html = j.optString("html", ""); if (!html.isEmpty()) runInlineScripts(html);
        }
      } else {
        okhttp3.Request r = new okhttp3.Request.Builder().url(u).header("User-Agent", settings.getUserAgentString()).build();
        try (okhttp3.Response res = tvbox.runtime.Net.client().newCall(r).execute()) { client.shouldInterceptRequest(this, new Req(u, true)); runInlineScripts(res.body().string()); }
      }
    } catch (Throwable t) { android.util.Log.w("WebView", "load failed " + u + " " + t); H.post(() -> client.onReceivedError(this, -1, String.valueOf(t), u)); }
    H.post(() -> { client.onPageFinished(this, u); chrome.onProgressChanged(this, 100); });
  }
}