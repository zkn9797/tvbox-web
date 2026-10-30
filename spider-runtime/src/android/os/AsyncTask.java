package android.os;
public abstract class AsyncTask<P, G, R> {
  static final java.util.concurrent.ExecutorService EX = java.util.concurrent.Executors.newCachedThreadPool(r -> { Thread t = new Thread(r, "asynctask"); t.setDaemon(true); return t; });
  public static final java.util.concurrent.Executor THREAD_POOL_EXECUTOR = EX;
  protected abstract R doInBackground(P... p);
  protected void onPreExecute() {} protected void onPostExecute(R r) {} protected void onProgressUpdate(G... v) {} protected void onCancelled() {}
  protected final void publishProgress(G... v) {} public final boolean cancel(boolean b) { return false; } public final boolean isCancelled() { return false; }
  @SafeVarargs public final AsyncTask<P, G, R> execute(P... p) { onPreExecute(); EX.execute(() -> { try { onPostExecute(doInBackground(p)); } catch (Throwable e) { android.util.Log.e("AsyncTask", "fail", e); } }); return this; }
  @SafeVarargs public final AsyncTask<P, G, R> executeOnExecutor(java.util.concurrent.Executor ex, P... p) { return execute(p); }
  public static void execute(Runnable r) { EX.execute(r); } }