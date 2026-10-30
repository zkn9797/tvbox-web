package android.util;
public class Base64 {
  public static final int DEFAULT=0, NO_PADDING=1, NO_WRAP=2, CRLF=4, URL_SAFE=8, NO_CLOSE=16;
  public static byte[] decode(String s, int flags) { return decode(s.getBytes(java.nio.charset.StandardCharsets.ISO_8859_1), flags); }
  public static byte[] decode(byte[] in, int flags) { return decode(in, 0, in.length, flags); }
  public static byte[] decode(byte[] in, int off, int len, int flags) {
    StringBuilder sb = new StringBuilder(len);
    for (int i = off; i < off + len; i++) { char c = (char) (in[i] & 0xff);
      if (c == '-') c = '+'; else if (c == '_') c = '/';
      if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '+' || c == '/') sb.append(c); }
    while (sb.length() % 4 != 0) sb.append('=');
    try { return java.util.Base64.getDecoder().decode(sb.toString()); } catch (IllegalArgumentException e) { throw new IllegalArgumentException("bad base-64"); }
  }
  public static String encodeToString(byte[] in, int flags) { return new String(encode(in, flags), java.nio.charset.StandardCharsets.US_ASCII); }
  public static String encodeToString(byte[] in, int off, int len, int flags) { return new String(encode(java.util.Arrays.copyOfRange(in, off, off+len), flags), java.nio.charset.StandardCharsets.US_ASCII); }
  public static byte[] encode(byte[] in, int off, int len, int flags) { return encode(java.util.Arrays.copyOfRange(in, off, off+len), flags); }
  public static byte[] encode(byte[] in, int flags) {
    java.util.Base64.Encoder e = (flags & URL_SAFE) != 0 ? java.util.Base64.getUrlEncoder() : java.util.Base64.getEncoder();
    if ((flags & NO_PADDING) != 0) e = e.withoutPadding();
    String s = e.encodeToString(in);
    if ((flags & NO_WRAP) == 0) {
      StringBuilder sb = new StringBuilder(); String nl = (flags & CRLF) != 0 ? "\r\n" : "\n";
      for (int i = 0; i < s.length(); i += 76) { sb.append(s, i, Math.min(s.length(), i + 76)); sb.append(nl); }
      s = sb.toString();
    }
    return s.getBytes(java.nio.charset.StandardCharsets.US_ASCII);
  }
}