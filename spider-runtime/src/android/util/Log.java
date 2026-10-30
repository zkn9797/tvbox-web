package android.util;
public final class Log {
  public static final int VERBOSE=2, DEBUG=3, INFO=4, WARN=5, ERROR=6, ASSERT=7;
  static final boolean ON = System.getenv("SPIDER_DEBUG") != null;
  static int p(String l, String t, String m) { if (ON) System.err.println(l + "/" + t + ": " + m); return 0; }
  public static int v(String t, String m) { return p("V", t, m); } public static int d(String t, String m) { return p("D", t, m); }
  public static int i(String t, String m) { return p("I", t, m); } public static int w(String t, String m) { return p("W", t, m); }
  public static int e(String t, String m) { return p("E", t, m); } public static int w(String t, Throwable e) { return p("W", t, String.valueOf(e)); }
  public static int e(String t, String m, Throwable e) { return p("E", t, m + " " + e); } public static int w(String t, String m, Throwable e) { return p("W", t, m + " " + e); }
  public static int d(String t, String m, Throwable e) { return p("D", t, m + " " + e); } public static int i(String t, String m, Throwable e) { return p("I", t, m + " " + e); }
  public static int println(int pr, String t, String m) { return p(String.valueOf(pr), t, m); }
  public static String getStackTraceString(Throwable e) { java.io.StringWriter w = new java.io.StringWriter(); e.printStackTrace(new java.io.PrintWriter(w)); return w.toString(); }
  public static boolean isLoggable(String t, int l) { return ON; }
}