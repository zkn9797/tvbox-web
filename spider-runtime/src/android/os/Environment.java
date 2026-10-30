package android.os;
public class Environment { public static boolean isExternalStorageManager() { return true; } public static final String DIRECTORY_DOWNLOADS = "Download", DIRECTORY_MOVIES = "Movies";
  public static java.io.File getExternalStorageDirectory() { java.io.File f = new java.io.File(System.getProperty("spider.data", "/data"), "sdcard"); f.mkdirs(); return f; }
  public static java.io.File getExternalStoragePublicDirectory(String t) { java.io.File f = new java.io.File(getExternalStorageDirectory(), t); f.mkdirs(); return f; }
  public static String getExternalStorageState() { return "mounted"; } }