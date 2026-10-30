package dalvik.system;
/** Android dex class loader on the JVM: converts the dex/jar/apk with dex2jar (cached) and loads it. */
public class BaseDexClassLoader extends ClassLoader {
  private final java.net.URLClassLoader inner;
  public BaseDexClassLoader(String dexPath, java.io.File opt, String libPath, ClassLoader parent) {
    super(parent == null ? BaseDexClassLoader.class.getClassLoader() : parent);
    java.net.URLClassLoader u = null;
    try { u = tvbox.runtime.JarManager.convertLocal(dexPath, getParent()); } catch (Exception e) { android.util.Log.e("DexClassLoader", "convert failed " + dexPath, e); }
    inner = u;
  }
  @Override protected Class<?> findClass(String name) throws ClassNotFoundException { if (inner == null) throw new ClassNotFoundException(name); return inner.loadClass(name); }
  @Override public java.net.URL getResource(String n) { java.net.URL r = super.getResource(n); return r != null || inner == null ? r : inner.getResource(n); }
  public String findLibrary(String n) { return null; }
}
