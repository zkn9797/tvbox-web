package android.app;
public class Application extends android.content.ContextWrapper { public Application() { super(null); } public Application(android.content.Context b) { super(b); }
  public void onCreate() {} public void registerActivityLifecycleCallbacks(ActivityLifecycleCallbacks c) {}
  public interface ActivityLifecycleCallbacks { } }