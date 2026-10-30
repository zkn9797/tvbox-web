package android.text;
import java.util.*;
public class TextUtils {
  public static boolean isEmpty(CharSequence s) { return s == null || s.length() == 0; }
  public static String join(CharSequence d, Iterable t) { StringBuilder sb = new StringBuilder(); boolean first = true; for (Object o : t) { if (!first) sb.append(d); sb.append(o); first = false; } return sb.toString(); }
  public static String join(CharSequence d, Object[] t) { return join(d, Arrays.asList(t)); }
  public static boolean equals(CharSequence a, CharSequence b) { if (a == b) return true; if (a == null || b == null) return false; return a.toString().equals(b.toString()); }
  public static String[] split(String text, String expression) { if (text.length() == 0) return new String[0]; return text.split(expression, -1); }
  public static boolean isDigitsOnly(CharSequence s) { for (int i = 0; i < s.length(); i++) if (!Character.isDigit(s.charAt(i))) return false; return true; }
  public static String htmlEncode(String s) { return s.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace("\"","&quot;").replace("'","&#39;"); }
  public static int getTrimmedLength(CharSequence s) { return s.toString().trim().length(); }
  public static CharSequence concat(CharSequence... t) { StringBuilder sb = new StringBuilder(); for (CharSequence c : t) sb.append(c); return sb; }
  public enum TruncateAt { START, MIDDLE, END, MARQUEE }
}
