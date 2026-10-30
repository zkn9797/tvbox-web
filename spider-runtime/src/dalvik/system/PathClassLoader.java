package dalvik.system;
public class PathClassLoader extends BaseDexClassLoader { public PathClassLoader(String d, ClassLoader p) { super(d, null, null, p); } public PathClassLoader(String d, String l, ClassLoader p) { super(d, null, l, p); } }
