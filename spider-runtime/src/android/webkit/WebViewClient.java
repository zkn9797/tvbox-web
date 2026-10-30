package android.webkit;
public class WebViewClient {
  public boolean shouldOverrideUrlLoading(WebView v, String url) { return false; } public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) { return shouldOverrideUrlLoading(v, r.getUrl().toString()); }
  public void onPageStarted(WebView v, String url, android.graphics.Bitmap icon) {} public void onPageFinished(WebView v, String url) {} public void onLoadResource(WebView v, String url) {}
  public WebResourceResponse shouldInterceptRequest(WebView v, String url) { return null; } public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) { return shouldInterceptRequest(v, r.getUrl().toString()); }
  public void onReceivedError(WebView v, int code, String d, String url) {} public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {}
  public void onReceivedSslError(WebView v, SslErrorHandler h, android.net.http.SslError e) { h.proceed(); } }