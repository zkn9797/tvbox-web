package dalvik.system;
public class InMemoryDexClassLoader extends BaseDexClassLoader {
  public InMemoryDexClassLoader(java.nio.ByteBuffer b, ClassLoader p) { super(tmp(b), null, null, p); }
  static String tmp(java.nio.ByteBuffer b) { try { java.io.File f = java.io.File.createTempFile("mem", ".dex"); byte[] a = new byte[b.remaining()]; b.duplicate().get(a); java.nio.file.Files.write(f.toPath(), a); return f.getAbsolutePath(); } catch (Exception e) { return ""; } } }
