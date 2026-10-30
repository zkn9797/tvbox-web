package tvbox.runtime;
import com.googlecode.d2j.Method; import com.googlecode.d2j.dex.Dex2jar; import com.googlecode.d2j.reader.*; import com.googlecode.d2j.visitors.*;
import java.io.File; import java.nio.file.*; import java.util.*;

/** dex -> jar with one dex-level repair: R8 drops trivial constructors, leaving `new-instance X; invoke-direct Object.<init>()`
 *  (or a further ancestor's). dex2jar then emits `new Object`, losing X. The constructor call is retargeted to X here,
 *  and Frames synthesises the trivial constructor in X when it is loaded. */
public final class DexFix {
  /** bump when the conversion changes, so cached jars are rebuilt */
  public static final String VERSION = "v2";

  public static void convert(File dex, File out) throws Exception {
    BaseDexFileReader r = MultiDexFileReader.open(Files.readAllBytes(dex.toPath()));
    BaseDexFileReader w = new BaseDexFileReader() {
      public int getDexVersion() { return r.getDexVersion(); }
      public List<String> getClassNames() { return r.getClassNames(); }
      public void accept(DexFileVisitor v) { r.accept(wrap(v)); }
      public void accept(DexFileVisitor v, int c) { r.accept(wrap(v), c); }
      public void accept(DexFileVisitor v, int i, int c) { r.accept(wrap(v), i, c); }
    };
    Dex2jar.from(w).reUseReg(false).topoLogicalSort().skipDebug(true).optimizeSynchronized(false).printIR(false).noCode(false)
        .skipExceptions(false).dontSanitizeNames(false).computeFrames(false).to(out.toPath());
    addCtors(out);
  }

  /** after retargeting, `new X; invokespecial X.<init>(d)` may name a constructor R8 removed from X: add trivial ones
   *  (chaining to the superclass with the same arguments) up the hierarchy until a class declares it. */
  static void addCtors(File jar) throws Exception {
    Map<String, byte[]> files = new LinkedHashMap<>(); Map<String, String> sup = new HashMap<>(); Map<String, Set<String>> ctors = new HashMap<>(); Set<String> itf = new HashSet<>();
    try (java.util.zip.ZipFile z = new java.util.zip.ZipFile(jar)) { for (java.util.zip.ZipEntry e : Collections.list(z.entries())) if (!e.isDirectory()) files.put(e.getName(), z.getInputStream(e).readAllBytes()); }
    Map<String, Set<String>> calls = new HashMap<>(); List<String[]> superCalls = new ArrayList<>();
    for (Map.Entry<String, byte[]> f : files.entrySet()) { if (!f.getKey().endsWith(".class")) continue;
      org.objectweb.asm.ClassReader cr = new org.objectweb.asm.ClassReader(f.getValue()); String n = cr.getClassName(); sup.put(n, cr.getSuperName());
      if ((cr.getAccess() & org.objectweb.asm.Opcodes.ACC_INTERFACE) != 0) itf.add(n);
      Set<String> cs = new HashSet<>(); ctors.put(n, cs);
      cr.accept(new org.objectweb.asm.ClassVisitor(org.objectweb.asm.Opcodes.ASM9) {
        @Override public org.objectweb.asm.MethodVisitor visitMethod(int a, String mn, String d, String sg, String[] ex) {
          if ("<init>".equals(mn)) cs.add(d); final boolean ctor = "<init>".equals(mn);
          return new org.objectweb.asm.MethodVisitor(org.objectweb.asm.Opcodes.ASM9) {
            @Override public void visitMethodInsn(int op, String o, String nm, String ds, boolean i) { if (op == org.objectweb.asm.Opcodes.INVOKESPECIAL && "<init>".equals(nm)) {
              calls.computeIfAbsent(o, k -> new HashSet<>()).add(ds);
              if (ctor && !o.equals(n)) superCalls.add(new String[]{ n, o, ds }); } } };
        } }, org.objectweb.asm.ClassReader.SKIP_FRAMES | org.objectweb.asm.ClassReader.SKIP_DEBUG);
    }
    // a constructor calling a further ancestor's <init> (R8 skipped trivial ones): Frames redirects it to the direct superclass
    for (String[] sc : superCalls) { String s0 = sup.get(sc[0]); if (s0 == null || s0.equals(sc[1])) continue;
      boolean anc = false; for (String x = s0; x != null; x = sup.get(x)) if (x.equals(sc[1])) { anc = true; break; }
      if (anc || "java/lang/Object".equals(sc[1]) || "java/lang/Enum".equals(sc[1])) calls.computeIfAbsent(s0, k -> new HashSet<>()).add(sc[2]); }
    Map<String, Set<String>> add = new HashMap<>();
    for (Map.Entry<String, Set<String>> c : calls.entrySet()) for (String d : c.getValue())
      for (String x = c.getKey(); x != null && ctors.containsKey(x) && !itf.contains(x) && !ctors.get(x).contains(d); x = sup.get(x)) { ctors.get(x).add(d); add.computeIfAbsent(x, k -> new TreeSet<>()).add(d); }
    if (add.isEmpty()) return;
    for (Map.Entry<String, Set<String>> a : add.entrySet()) {
      String key = a.getKey() + ".class"; org.objectweb.asm.ClassReader cr = new org.objectweb.asm.ClassReader(files.get(key));
      org.objectweb.asm.ClassWriter cw = new org.objectweb.asm.ClassWriter(cr, 0); String s = sup.get(a.getKey());
      cr.accept(new org.objectweb.asm.ClassVisitor(org.objectweb.asm.Opcodes.ASM9, cw) {
        @Override public void visitEnd() {
          for (String d : a.getValue()) { org.objectweb.asm.MethodVisitor m = super.visitMethod(org.objectweb.asm.Opcodes.ACC_PUBLIC | org.objectweb.asm.Opcodes.ACC_SYNTHETIC, "<init>", d, null, null);
            m.visitCode(); m.visitVarInsn(org.objectweb.asm.Opcodes.ALOAD, 0); int slot = 1;
            for (org.objectweb.asm.Type t : org.objectweb.asm.Type.getArgumentTypes(d)) { m.visitVarInsn(t.getOpcode(org.objectweb.asm.Opcodes.ILOAD), slot); slot += t.getSize(); }
            m.visitMethodInsn(org.objectweb.asm.Opcodes.INVOKESPECIAL, s, "<init>", d, false); m.visitInsn(org.objectweb.asm.Opcodes.RETURN); m.visitMaxs(slot, slot); m.visitEnd(); }
          super.visitEnd(); } }, 0);
      files.put(key, cw.toByteArray());
    }
    File tmp = new File(jar.getPath() + ".ctor");
    try (java.util.zip.ZipOutputStream o = new java.util.zip.ZipOutputStream(new java.io.FileOutputStream(tmp))) {
      for (Map.Entry<String, byte[]> f : files.entrySet()) { o.putNextEntry(new java.util.zip.ZipEntry(f.getKey())); o.write(f.getValue()); o.closeEntry(); } }
    Files.move(tmp.toPath(), jar.toPath(), StandardCopyOption.REPLACE_EXISTING);
    System.err.println("[jar] added " + add.values().stream().mapToInt(Set::size).sum() + " trivial constructors in " + add.size() + " classes");
  }

  static DexFileVisitor wrap(DexFileVisitor v) {
    return new DexFileVisitor(v) {
      @Override public DexClassVisitor visit(int acc, String cls, String sup, String[] itf) {
        DexClassVisitor cv = super.visit(acc, cls, sup, itf); if (cv == null) return null;
        return new DexClassVisitor(cv) {
          @Override public DexMethodVisitor visitMethod(int a, Method m) {
            DexMethodVisitor mv = super.visitMethod(a, m); if (mv == null) return null;
            return new DexMethodVisitor(mv) {
              @Override public DexCodeVisitor visitCode() {
                DexCodeVisitor c = super.visitCode(); if (c == null) return null;
                return new DexCodeVisitor(c) {
                  final Map<Integer, String> fresh = new HashMap<>();
                  @Override public void visitTypeStmt(Op op, int a1, int b, String type) {
                    if (op == Op.NEW_INSTANCE) fresh.put(a1, type); super.visitTypeStmt(op, a1, b, type);
                  }
                  @Override public void visitMethodStmt(Op op, int[] args, Method mt) {
                    if ((op == Op.INVOKE_DIRECT || op == Op.INVOKE_DIRECT_RANGE) && "<init>".equals(mt.getName()) && args.length > 0) {
                      String t = fresh.remove(args[0]);
                      if (t != null && !t.equals(mt.getOwner()) && !t.startsWith("[")) mt = new Method(t, mt.getName(), mt.getProto());
                    }
                    super.visitMethodStmt(op, args, mt);
                  }
                };
              }
            };
          }
        };
      }
    };
  }
}
