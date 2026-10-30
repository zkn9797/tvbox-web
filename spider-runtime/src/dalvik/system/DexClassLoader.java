package dalvik.system;
public class DexClassLoader extends BaseDexClassLoader { public DexClassLoader(String d, String o, String l, ClassLoader p) { super(d, o == null ? null : new java.io.File(o), l, p); } }
