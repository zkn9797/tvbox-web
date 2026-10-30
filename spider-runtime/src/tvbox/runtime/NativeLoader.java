package tvbox.runtime;
import java.io.*; import java.net.*; import org.objectweb.asm.*;

/** URLClassLoader that rewrites System.load/loadLibrary in spider classes so Android .so files can load (see Native).
 *  System.load still runs inside the spider class, so the library binds to the spider's class loader. */
public class NativeLoader extends URLClassLoader {
  public NativeLoader(URL[] urls, ClassLoader parent) { super(urls, parent); }
  private StubGen stubGen;
  synchronized StubGen stubs() { if (stubGen == null) stubGen = new StubGen(getURLs()); return stubGen; }
  @Override protected Class<?> findClass(String name) throws ClassNotFoundException {
    URL u = findResource(name.replace('.', '/') + ".class");
    if (u == null) {
      String in = name.replace('.', '/');
      if (StubGen.eligible(in)) { StubGen g = stubs(); if (g.knows(in)) { byte[] sb = g.make(in, this); System.err.println("[stub] " + name); return defineClass(name, sb, 0, sb.length); } }
      throw new ClassNotFoundException(name);
    }
    byte[] b;
    try (InputStream in = u.openStream()) { b = in.readAllBytes(); } catch (IOException e) { throw new ClassNotFoundException(name, e); }
    if (contains(b, "loadLibrary") || contains(b, "java/lang/System") || contains(b, "java/lang/Runtime") || contains(b, "crawler/Spider") || contains(b, "$d2j$hex$") || contains(b, "danmuStart")) { try { b = rewrite(b); } catch (Throwable t) { /* keep original */ } }
    if (FIX_FRAMES) { try { b = frames().fix(b); } catch (Throwable t) { System.err.println("[frames] " + name + ": " + t); } }
    return defineClass(name, b, 0, b.length);
  }
  static final boolean FIX_FRAMES = !"0".equals(System.getenv("FIX_FRAMES"));
  private Frames frames;
  synchronized Frames frames() { if (frames == null) frames = new Frames(this); return frames; }
  static int indexOf(byte[] b, byte[] p) { outer: for (int i = 0; i + p.length <= b.length; i++) { for (int j = 0; j < p.length; j++) if (b[i + j] != p[j]) continue outer; return i; } return -1; }
  static boolean contains(byte[] b, String s) { byte[] p = s.getBytes(); outer: for (int i = 0; i + p.length <= b.length; i++) { for (int j = 0; j < p.length; j++) if (b[i + j] != p[j]) continue outer; return true; } return false; }
  static byte[] rewrite(byte[] b) {
    ClassReader cr = new ClassReader(b); ClassWriter cw = new ClassWriter(0); final boolean[] hit = { false };
    cr.accept(new ClassVisitor(Opcodes.ASM9, cw) {
      @Override public MethodVisitor visitMethod(int acc, String n, String d, String sig, String[] ex) {
        return new MethodVisitor(Opcodes.ASM9, super.visitMethod(acc, n, d, sig, ex)) {
          int d2j = 0; // 1 after a $d2j$hex$ decode call; stays while only int constants follow
          @Override public void visitInsn(int op) { if (!(op >= Opcodes.ICONST_M1 && op <= Opcodes.ICONST_5)) d2j = 0; super.visitInsn(op); }
          @Override public void visitIntInsn(int op, int v) { if (op == Opcodes.NEWARRAY) d2j = 0; super.visitIntInsn(op, v); }
          @Override public void visitLdcInsn(Object v) { if (!(v instanceof Integer)) d2j = 0; super.visitLdcInsn(v); }
          @Override public void visitVarInsn(int op, int v) { d2j = 0; super.visitVarInsn(op, v); }
          @Override public void visitFieldInsn(int op, String o, String nm, String ds) { d2j = 0; super.visitFieldInsn(op, o, nm, ds); }
          @Override public void visitJumpInsn(int op, Label l) { d2j = 0; super.visitJumpInsn(op, l); }
          @Override public void visitTypeInsn(int op, String t) { d2j = 0; super.visitTypeInsn(op, t); }
          @Override public void visitMethodInsn(int op, String owner, String name, String desc, boolean itf) {
            if (op == Opcodes.INVOKESTATIC && name.startsWith("$d2j$hex$")) { super.visitMethodInsn(op, owner, name, desc, itf); d2j = 1; return; }
            if (d2j == 1 && op == Opcodes.INVOKESTATIC && "java/lang/System".equals(owner) && "arraycopy".equals(name)) { d2j = 0; hit[0] = true; super.visitMethodInsn(op, "tvbox/runtime/D2jFix", "copy", desc, false); return; }
            d2j = 0;
            // a spider must never terminate the shared runtime process
            if (op == Opcodes.INVOKESTATIC && "java/lang/System".equals(owner) && "exit".equals(name)) { hit[0] = true; super.visitMethodInsn(op, "tvbox/runtime/Native", "exit", "(I)V", false); return; }
            if (op == Opcodes.INVOKEVIRTUAL && "java/lang/Runtime".equals(owner) && ("exit".equals(name) || "halt".equals(name))) { hit[0] = true; super.visitMethodInsn(Opcodes.INVOKESTATIC, "tvbox/runtime/Native", "rtExit", "(Ljava/lang/Runtime;I)V", false); return; }
            if (op == Opcodes.INVOKESTATIC && "(Ljava/lang/String;)V".equals(desc) && ("java/lang/System".equals(owner) || "java/lang/Runtime".equals(owner))) {
              if ("load".equals(name)) { hit[0] = true; super.visitMethodInsn(Opcodes.INVOKESTATIC, "tvbox/runtime/Native", "fix", "(Ljava/lang/String;)Ljava/lang/String;", false); super.visitMethodInsn(op, "java/lang/System", "load", desc, false); return; }
              if ("loadLibrary".equals(name)) { hit[0] = true; super.visitMethodInsn(Opcodes.INVOKESTATIC, "tvbox/runtime/Native", "libPath", "(Ljava/lang/String;)Ljava/lang/String;", false); super.visitMethodInsn(op, "java/lang/System", "load", desc, false); return; }
            }
            // 饭太硬 guard: inner dex calls DexNative.danmuStart(), which the outer bridge class lacks (danmaku only) -> no-op
            if (op == Opcodes.INVOKESTATIC && "com/github/catvod/spider/DexNative".equals(owner) && "danmuStart".equals(name) && "()V".equals(desc)) { hit[0] = true; super.visitMethodInsn(op, "tvbox/runtime/Native", "noop", "()V", false); return; }
            // newer CatVod API: static Spider.client()/safeDns() -> runtime equivalents
            if (op == Opcodes.INVOKESTATIC && "com/github/catvod/crawler/Spider".equals(owner) && "client".equals(name) && "()Lokhttp3/OkHttpClient;".equals(desc)) { hit[0] = true; super.visitMethodInsn(op, "tvbox/runtime/Net", "client", desc, false); return; }
            super.visitMethodInsn(op, owner, name, desc, itf);
          }
        };
      }
    }, 0);
    return hit[0] ? cw.toByteArray() : b;
  }
}
