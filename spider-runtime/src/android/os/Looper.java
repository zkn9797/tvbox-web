package android.os;
/** Main looper = the "android-main" Handler thread; worker threads (where spiders run) are NOT the main thread,
 *  like TVBox runs spiders off the UI thread. */
public final class Looper { static final Looper MAIN = new Looper(); static final ThreadLocal<Looper> TL = new ThreadLocal<>(); Thread thread;
  public static Looper getMainLooper() { return MAIN; }
  public static Looper myLooper() { if ("android-main".equals(Thread.currentThread().getName())) { MAIN.thread = Thread.currentThread(); return MAIN; } return TL.get(); }
  public static void prepare() { if (TL.get() == null) { Looper l = new Looper(); l.thread = Thread.currentThread(); TL.set(l); } } public static void prepareMainLooper() {} public static void loop() {}
  public static boolean isMainThread() { return "android-main".equals(Thread.currentThread().getName()); }
  public boolean isCurrentThread() { return this == myLooper(); }
  public Thread getThread() { if (this == MAIN && thread == null) { try { new Handler().post(() -> MAIN.thread = Thread.currentThread()); Thread.sleep(20); } catch (Exception e) { } } return thread != null ? thread : Thread.currentThread(); }
  public void quit() {} public void quitSafely() {} }
