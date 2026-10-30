package android.webkit;
public class WebResourceResponse { String mime, enc; java.io.InputStream data; int code = 200; String reason = "OK"; java.util.Map<String, String> headers;
  public WebResourceResponse(String m, String e, java.io.InputStream d) { mime = m; enc = e; data = d; }
  public WebResourceResponse(String m, String e, int c, String r, java.util.Map<String, String> h, java.io.InputStream d) { this(m, e, d); code = c; reason = r; headers = h; }
  public String getMimeType() { return mime; } public java.io.InputStream getData() { return data; } public int getStatusCode() { return code; } public java.util.Map<String, String> getResponseHeaders() { return headers; } }