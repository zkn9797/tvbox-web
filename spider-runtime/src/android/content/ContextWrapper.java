package android.content;
public class ContextWrapper extends Context { protected Context base; public ContextWrapper(Context b) { base = b; }
  public Context getBaseContext() { return base; }
  public java.io.File getFilesDir() { return base.getFilesDir(); } public java.io.File getCacheDir() { return base.getCacheDir(); } public java.io.File getExternalCacheDir() { return base.getExternalCacheDir(); }
  public java.io.File getExternalFilesDir(String t) { return base.getExternalFilesDir(t); } public java.io.File getDir(String n, int m) { return base.getDir(n, m); }
  public SharedPreferences getSharedPreferences(String n, int m) { return base.getSharedPreferences(n, m); } public String getPackageName() { return base.getPackageName(); }
  public Object getSystemService(String n) { return base.getSystemService(n); } public android.content.res.Resources getResources() { return base.getResources(); }
  public Context getApplicationContext() { return base.getApplicationContext(); } public android.content.pm.PackageManager getPackageManager() { return base.getPackageManager(); }
  public android.content.pm.ApplicationInfo getApplicationInfo() { return base.getApplicationInfo(); } public ContentResolver getContentResolver() { return base.getContentResolver(); }
  public void startActivity(Intent i) { base.startActivity(i); } public java.io.InputStream openFileInput(String n) throws java.io.FileNotFoundException { return base.openFileInput(n); }
  public java.io.FileOutputStream openFileOutput(String n, int m) throws java.io.FileNotFoundException { return base.openFileOutput(n, m); } public android.content.res.AssetManager getAssets() { return base.getAssets(); }
  public java.io.File getDatabasePath(String n) { return base.getDatabasePath(n); } public ClassLoader getClassLoader() { return base.getClassLoader(); } public void sendBroadcast(Intent i) { base.sendBroadcast(i); }
}