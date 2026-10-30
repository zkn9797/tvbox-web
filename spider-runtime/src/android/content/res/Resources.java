package android.content.res;
public class Resources { final android.util.DisplayMetrics dm = new android.util.DisplayMetrics(); final Configuration cfg = new Configuration();
  public android.util.DisplayMetrics getDisplayMetrics() { return dm; } public Configuration getConfiguration() { return cfg; }
  public int getIdentifier(String n, String t, String p) { return 0; } public String getString(int id) { return ""; } public static Resources getSystem() { return new Resources(); } }