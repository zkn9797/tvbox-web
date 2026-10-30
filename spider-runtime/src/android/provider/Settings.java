package android.provider;
public final class Settings {
  public static final class Secure { public static final String ANDROID_ID = "android_id";
    public static String getString(android.content.ContentResolver r, String n) { return "android_id".equals(n) ? "7a3f9c21d4e8b605" : null; }
    public static int getInt(android.content.ContentResolver r, String n, int d) { return d; } }
  public static final class System { public static String getString(android.content.ContentResolver r, String n) { return null; } public static int getInt(android.content.ContentResolver r, String n, int d) { return d; } }
  public static final class Global { public static String getString(android.content.ContentResolver r, String n) { return null; } public static int getInt(android.content.ContentResolver r, String n, int d) { return d; } }
}
