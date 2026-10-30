package tvbox.runtime;
import android.content.*; import java.io.*; import java.util.*;
/** The android.content.Context handed to spiders. Backed by the runtime's data directory. */
public class AppContext extends android.app.Application {
  final File root; final Map<String, Prefs> prefs = new HashMap<>(); final android.content.res.Resources res = new android.content.res.Resources();
  final android.content.pm.PackageManager pm = new android.content.pm.PackageManager(); final android.content.pm.ApplicationInfo ai = new android.content.pm.ApplicationInfo();
  public AppContext(File root) { super(null); this.root = root; root.mkdirs(); ai.packageName = getPackageName(); ai.dataDir = root.getAbsolutePath(); }
  File d(String n) { File f = new File(root, n); f.mkdirs(); return f; }
  @Override public File getFilesDir() { return d("files"); } @Override public File getCacheDir() { return d("cache"); }
  @Override public File getExternalCacheDir() { return d("sdcard/cache"); } @Override public File getExternalFilesDir(String t) { return d("sdcard/files" + (t == null ? "" : "/" + t)); }
  @Override public File getDir(String n, int m) { return d("app_" + n); } @Override public File getDatabasePath(String n) { return new File(d("databases"), n); }
  @Override public synchronized SharedPreferences getSharedPreferences(String n, int m) { return prefs.computeIfAbsent(n, k -> new Prefs(new File(d("shared_prefs"), k + ".properties"))); }
  @Override public String getPackageName() { return "com.github.tvbox.osc"; }
  @Override public Object getSystemService(String n) { switch (n) { case "clipboard": return new ClipboardManager(); case "wifi": return new android.net.wifi.WifiManager(); case "window": return (android.view.WindowManager) () -> new android.view.Display(); case "input_method": return new android.view.inputmethod.InputMethodManager(); default: return null; } }
  @Override public android.content.res.Resources getResources() { return res; } @Override public Context getApplicationContext() { return this; }
  @Override public android.content.pm.PackageManager getPackageManager() { return pm; } @Override public android.content.pm.ApplicationInfo getApplicationInfo() { return ai; }
  @Override public ContentResolver getContentResolver() { return null; } @Override public void startActivity(Intent i) { }
  @Override public InputStream openFileInput(String n) throws FileNotFoundException { return new FileInputStream(new File(getFilesDir(), n)); }
  @Override public FileOutputStream openFileOutput(String n, int m) throws FileNotFoundException { return new FileOutputStream(new File(getFilesDir(), n), (m & MODE_APPEND) != 0); }
  @Override public android.content.res.AssetManager getAssets() { return new android.content.res.AssetManager(); }
  @Override public ClassLoader getClassLoader() { return Thread.currentThread().getContextClassLoader(); } @Override public void sendBroadcast(Intent i) { }
}
