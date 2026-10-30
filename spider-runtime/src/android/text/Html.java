package android.text;
public class Html { public static final int FROM_HTML_MODE_LEGACY=0;
  public static CharSequence fromHtml(String s) { return org.jsoup.Jsoup.parse(s == null ? "" : s).text(); }
  public static CharSequence fromHtml(String s, int f) { return fromHtml(s); } }