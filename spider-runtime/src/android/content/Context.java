package android.content;
public abstract class Context {
  public static final int MODE_PRIVATE = 0, MODE_APPEND = 32768;
  public static final String WIFI_SERVICE = "wifi", CLIPBOARD_SERVICE = "clipboard", CONNECTIVITY_SERVICE = "connectivity", WINDOW_SERVICE = "window", AUDIO_SERVICE = "audio", ACTIVITY_SERVICE = "activity", INPUT_METHOD_SERVICE = "input_method";
  public abstract java.io.File getFilesDir(); public abstract java.io.File getCacheDir(); public abstract java.io.File getExternalCacheDir(); public abstract java.io.File getExternalFilesDir(String t);
  public abstract java.io.File getDir(String n, int m); public abstract SharedPreferences getSharedPreferences(String n, int m);
  public abstract String getPackageName(); public abstract Object getSystemService(String n); public abstract android.content.res.Resources getResources();
  public abstract Context getApplicationContext(); public abstract android.content.pm.PackageManager getPackageManager(); public abstract android.content.pm.ApplicationInfo getApplicationInfo();
  public abstract ContentResolver getContentResolver(); public abstract void startActivity(Intent i); public abstract java.io.InputStream openFileInput(String n) throws java.io.FileNotFoundException;
  public abstract java.io.FileOutputStream openFileOutput(String n, int m) throws java.io.FileNotFoundException; public abstract android.content.res.AssetManager getAssets();
  public abstract java.io.File getDatabasePath(String n); public abstract ClassLoader getClassLoader(); public abstract void sendBroadcast(Intent i);
  public final String getString(int id) { return ""; }
  public java.io.File getDataDir() { return getFilesDir().getParentFile(); }
  public java.io.File getCodeCacheDir() { java.io.File f = new java.io.File(getDataDir(), "code_cache"); f.mkdirs(); return f; }
  public java.io.File getNoBackupFilesDir() { java.io.File f = new java.io.File(getDataDir(), "no_backup"); f.mkdirs(); return f; }
  public java.io.File getObbDir() { java.io.File f = new java.io.File(getDataDir(), "obb"); f.mkdirs(); return f; }
  public java.io.File[] getExternalCacheDirs() { return new java.io.File[]{ getExternalCacheDir() }; }
  public java.io.File[] getExternalFilesDirs(String t) { return new java.io.File[]{ getExternalFilesDir(t) }; }
  public java.io.File getFileStreamPath(String n) { return new java.io.File(getFilesDir(), n); }
  public boolean deleteFile(String n) { return getFileStreamPath(n).delete(); }
  public String[] fileList() { String[] l = getFilesDir().list(); return l == null ? new String[0] : l; }
  public String getPackageCodePath() { return new java.io.File(getDataDir(), "base.apk").getAbsolutePath(); }
  public String getPackageResourcePath() { return getPackageCodePath(); }
  public Context createPackageContext(String p, int f) { return this; }
  public android.database.sqlite.SQLiteDatabase openOrCreateDatabase(String n, int m, android.database.sqlite.SQLiteDatabase.CursorFactory f) { return android.database.sqlite.SQLiteDatabase.openOrCreateDatabase(getDatabasePath(n), f); }
  public boolean deleteDatabase(String n) { return getDatabasePath(n).delete(); } public String[] databaseList() { String[] l = getDatabasePath("x").getParentFile().list(); return l == null ? new String[0] : l; }
  public int checkSelfPermission(String p) { return 0; } public int checkCallingOrSelfPermission(String p) { return 0; }
  public final CharSequence getText(int id) { return ""; }

}