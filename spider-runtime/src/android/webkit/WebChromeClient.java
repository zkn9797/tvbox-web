package android.webkit;
public class WebChromeClient { public void onProgressChanged(WebView v, int p) {} public void onReceivedTitle(WebView v, String t) {}
  public boolean onConsoleMessage(ConsoleMessage m) { return false; } public boolean onJsAlert(WebView v, String url, String msg, JsResult r) { r.confirm(); return true; } }