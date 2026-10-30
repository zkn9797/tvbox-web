package android.os;
public final class SystemClock { public static void sleep(long ms) { try { Thread.sleep(ms); } catch (InterruptedException e) { } }
  public static long elapsedRealtime() { return System.nanoTime() / 1000000; } public static long uptimeMillis() { return System.nanoTime() / 1000000; }
  public static long currentThreadTimeMillis() { return System.currentTimeMillis(); } }