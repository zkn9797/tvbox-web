package android.content.pm;
public class PackageManager { public static final int GET_META_DATA = 128;
  public ProviderInfo resolveContentProvider(String n, int f) { return null; } public boolean hasSystemFeature(String f) { return "android.software.leanback".equals(f); }
  public android.content.Intent getLaunchIntentForPackage(String p) { return null; }
  public PackageInfo getPackageInfo(String p, int f) throws NameNotFoundException { PackageInfo i = new PackageInfo(); i.packageName = p; i.versionName = "1.0.0"; i.versionCode = 100; return i; }
  public ApplicationInfo getApplicationInfo(String p, int f) throws NameNotFoundException { ApplicationInfo a = new ApplicationInfo(); a.packageName = p; return a; } public CharSequence getApplicationLabel(ApplicationInfo a) { return "TVBox"; } public java.util.List<ApplicationInfo> getInstalledApplications(int f) { return new java.util.ArrayList<>(); } public java.util.List<PackageInfo> getInstalledPackages(int f) { return new java.util.ArrayList<>(); }
  public static class NameNotFoundException extends Exception { } }