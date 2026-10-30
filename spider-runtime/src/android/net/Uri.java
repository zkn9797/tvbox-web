package android.net;
import java.net.*; import java.nio.charset.StandardCharsets; import java.util.*;
public class Uri {
  final String s; URI u;
  Uri(String s) { this.s = s; try { u = new URI(s.replace(" ", "%20").replace("|", "%7C").replace("{", "%7B").replace("}", "%7D").replace("^", "%5E")); } catch (Exception e) { u = null; } }
  public static Uri parse(String s) { return new Uri(s); }
  public static Uri fromFile(java.io.File f) { return new Uri("file://" + f.getAbsolutePath()); }
  public String getScheme() { return u == null ? null : u.getScheme(); } public String getHost() { return u == null ? null : u.getHost(); }
  public int getPort() { return u == null ? -1 : u.getPort(); } public String getPath() { return u == null ? null : u.getPath(); }
  public String getEncodedPath() { return u == null ? null : u.getRawPath(); } public String getQuery() { return u == null ? null : u.getQuery(); }
  public String getEncodedQuery() { return u == null ? null : u.getRawQuery(); } public String getFragment() { return u == null ? null : u.getFragment(); }
  public String getEncodedAuthority() { return u == null ? null : u.getRawAuthority(); }
  public String getAuthority() { return u == null ? null : u.getAuthority(); } public String getUserInfo() { return u == null ? null : u.getUserInfo(); }
  public String getLastPathSegment() { List<String> p = getPathSegments(); return p.isEmpty() ? null : p.get(p.size() - 1); }
  public List<String> getPathSegments() { List<String> r = new ArrayList<>(); String p = getPath(); if (p != null) for (String x : p.split("/")) if (!x.isEmpty()) r.add(x); return r; }
  public String getQueryParameter(String k) { String q = getEncodedQuery(); if (q == null) return null; for (String kv : q.split("&")) { int i = kv.indexOf('='); String kk = decode(i < 0 ? kv : kv.substring(0, i)); if (kk.equals(k)) return i < 0 ? "" : decode(kv.substring(i + 1)); } return null; }
  public Set<String> getQueryParameterNames() { Set<String> r = new LinkedHashSet<>(); String q = getEncodedQuery(); if (q != null) for (String kv : q.split("&")) { int i = kv.indexOf('='); r.add(decode(i < 0 ? kv : kv.substring(0, i))); } return r; }
  public List<String> getQueryParameters(String k) { List<String> r = new ArrayList<>(); String q = getEncodedQuery(); if (q != null) for (String kv : q.split("&")) { int i = kv.indexOf('='); if (decode(i < 0 ? kv : kv.substring(0, i)).equals(k)) r.add(i < 0 ? "" : decode(kv.substring(i + 1))); } return r; }
  public Builder buildUpon() { Builder b = new Builder(); b.scheme = getScheme(); b.authority = getAuthority(); b.path = getEncodedPath(); b.query = getEncodedQuery() == null ? null : new StringBuilder(getEncodedQuery()); b.fragment = getFragment(); return b; }
  public String toString() { return s; } public boolean equals(Object o) { return o instanceof Uri && ((Uri) o).s.equals(s); } public int hashCode() { return s.hashCode(); }
  public boolean isAbsolute() { return getScheme() != null; } public boolean isRelative() { return getScheme() == null; }
  public static String encode(String s) { return encode(s, null); }
  public static String encode(String s, String allow) { if (s == null) return null; StringBuilder sb = new StringBuilder(); for (byte b : s.getBytes(StandardCharsets.UTF_8)) { char c = (char) (b & 0xff); if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || "_-!.~'()*".indexOf(c) >= 0 || (allow != null && allow.indexOf(c) >= 0)) sb.append(c); else sb.append('%').append(String.format("%02X", b & 0xff)); } return sb.toString(); }
  public static String decode(String s) { if (s == null) return null; try { return URLDecoder.decode(s.replace("+", "%2B"), "UTF-8"); } catch (Exception e) { return s; } }
  public static Uri withAppendedPath(Uri base, String seg) { return base.buildUpon().appendEncodedPath(seg).build(); }
  public static final class Builder { String scheme, authority, path, fragment; StringBuilder query;
    public Builder scheme(String s) { scheme = s; return this; } public Builder authority(String a) { authority = a; return this; } public Builder encodedAuthority(String a) { authority = a; return this; }
    public Builder path(String p) { path = p == null ? null : encodePath(p); return this; } public Builder encodedPath(String p) { path = p; return this; }
    public Builder appendPath(String p) { return appendEncodedPath(encode(p)); }
    public Builder appendEncodedPath(String p) { if (path == null || path.isEmpty()) path = "/" + p; else path = (path.endsWith("/") ? path : path + "/") + (p.startsWith("/") ? p.substring(1) : p); return this; }
    public Builder query(String q) { query = q == null ? null : new StringBuilder(encode(q, "=&")); return this; } public Builder encodedQuery(String q) { query = q == null ? null : new StringBuilder(q); return this; }
    public Builder appendQueryParameter(String k, String v) { if (query == null) query = new StringBuilder(); else if (query.length() > 0) query.append('&'); query.append(encode(k)).append('=').append(encode(v)); return this; }
    public Builder clearQuery() { query = null; return this; } public Builder fragment(String f) { fragment = f; return this; } public Builder encodedFragment(String f) { fragment = f; return this; }
    static String encodePath(String p) { return encode(p, "/"); }
    public Uri build() { StringBuilder sb = new StringBuilder(); if (scheme != null) sb.append(scheme).append(':'); if (authority != null) sb.append("//").append(authority); if (path != null) sb.append(path); if (query != null && query.length() > 0) sb.append('?').append(query); if (fragment != null) sb.append('#').append(fragment); return new Uri(sb.toString()); }
    public String toString() { return build().toString(); } }
}