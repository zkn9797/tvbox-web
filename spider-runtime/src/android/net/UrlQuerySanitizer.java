package android.net;
public class UrlQuerySanitizer { Uri u; public UrlQuerySanitizer() {} public UrlQuerySanitizer(String url) { u = Uri.parse(url); }
  public void parseUrl(String url) { u = Uri.parse(url); } public String getValue(String k) { return u == null ? null : u.getQueryParameter(k); } public boolean hasParameter(String k) { return getValue(k) != null; } }