package android.os;
public class Handler {
  static final java.util.concurrent.ScheduledExecutorService EX = java.util.concurrent.Executors.newSingleThreadScheduledExecutor(r -> { Thread t = new Thread(r, "android-main"); t.setDaemon(true); return t; });
  public interface Callback { boolean handleMessage(Message m); }
  Callback cb;
  public Handler() {} public Handler(Looper l) {} public Handler(Looper l, Callback c) { cb = c; } public Handler(Callback c) { cb = c; }
  public final boolean post(Runnable r) { EX.execute(wrap(r)); return true; }
  public final boolean postDelayed(Runnable r, long d) { EX.schedule(wrap(r), d, java.util.concurrent.TimeUnit.MILLISECONDS); return true; }
  public final void removeCallbacks(Runnable r) {} public final void removeCallbacksAndMessages(Object o) {}
  public final boolean sendEmptyMessage(int w) { Message m = new Message(); m.what = w; return sendMessage(m); }
  public final boolean sendMessage(Message m) { EX.execute(() -> { if (cb == null || !cb.handleMessage(m)) handleMessage(m); }); return true; }
  public void handleMessage(Message m) {}
  public final Looper getLooper() { return Looper.MAIN; }
  static Runnable wrap(Runnable r) { return () -> { try { r.run(); } catch (Throwable e) { android.util.Log.e("Handler", "task failed", e); } }; } }