package android.app;
public final class ActivityThread { static final ActivityThread I = new ActivityThread();
  /** Spiders reflect into mActivities to find the foreground Activity (FongMi Init.getActivity()). */
  final android.util.ArrayMap<Object, ActivityClientRecord> mActivities = new android.util.ArrayMap<>();
  ActivityThread() { mActivities.put(new Object(), new ActivityClientRecord()); }
  public static final class ActivityClientRecord { Activity activity = new Activity(); boolean paused = false, stopped = false; }
  public static ActivityThread currentActivityThread() { return I; } public static Application currentApplication() { return tvbox.runtime.Main.ctx(); }
  public Application getApplication() { return tvbox.runtime.Main.ctx(); } public static String currentPackageName() { return "com.github.tvbox.osc"; } }
