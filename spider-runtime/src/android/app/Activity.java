package android.app;
public class Activity extends android.content.ContextWrapper { public Activity() { super(tvbox.runtime.Main.ctx()); }
  public void runOnUiThread(Runnable r) { new android.os.Handler().post(r); } public void finish() {} public android.view.Window getWindow() { return new android.view.Window(); }
  public boolean isFinishing() { return false; } public boolean isDestroyed() { return false; } public android.app.Application getApplication() { return tvbox.runtime.Main.ctx(); }
  public void requestPermissions(String[] p, int c) {} public boolean shouldShowRequestPermissionRationale(String p) { return false; }
  public android.content.Intent getIntent() { return new android.content.Intent(); } public void setRequestedOrientation(int o) {} public void startActivityForResult(android.content.Intent i, int c) {} public android.content.ComponentName getComponentName() { return new android.content.ComponentName(getPackageName(), getClass().getName()); } public android.view.WindowManager getWindowManager() { return () -> new android.view.Display(); } }
