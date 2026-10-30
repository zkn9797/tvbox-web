package tvbox.runtime;
import java.io.InputStream; import java.net.URL; import java.util.*; import java.util.concurrent.ConcurrentHashMap;
import org.objectweb.asm.*; import org.objectweb.asm.tree.*; import org.objectweb.asm.tree.analysis.*;

/** Repairs dex2jar output that only ART accepts:
 *  1. dex2jar computes stack map frames without the class hierarchy, so merged types collapse to Object.
 *     Frames are recomputed with the real hierarchy (read from the class files, nothing is loaded).
 *  2. R8 drops trivial constructors and calls Object.<init>() directly on a new X / on `this`; dex2jar then even
 *     emits `new Object` for `new-instance X`. The allocated type is recovered from how the value is used, the call is
 *     redirected to X / the direct superclass, and classes get a trivial no-arg constructor chaining upwards.
 *  3. dex2jar parks the uninitialised object in a local (new X; astore n; aload n; invokespecial), which OpenJ9
 *     rejects: the store is dropped and the object is allocated where it is loaded, then stored after <init>. */
final class Frames {
  static final class H { final String sup; final boolean itf; H(String s, boolean i) { sup = s; itf = i; } }
  static final boolean DBG = System.getenv("FRAMES_DBG") != null;
  static final Object THIS = new Object();
  final ClassLoader cl; final Map<String, H> hier = new ConcurrentHashMap<>();
  /** constructors (class -> descriptors) that redirected calls need; synthesised when the class is defined */
  static final Map<String, Set<String>> NEED = new ConcurrentHashMap<>();
  void need(String c, String d, String upto) { for (String x = c; x != null && !x.equals(upto) && !"java/lang/Object".equals(x); x = info(x).sup) NEED.computeIfAbsent(x, k -> ConcurrentHashMap.newKeySet()).add(d); }
  Frames(ClassLoader cl) { this.cl = cl; }

  H info(String in) {
    H h = hier.get(in); if (h != null) return h;
    String sup = "java/lang/Object"; boolean itf = false;
    try { URL u = cl.getResource(in + ".class");
      if (u != null) { try (InputStream s = u.openStream()) { ClassReader r = new ClassReader(s.readAllBytes()); sup = r.getSuperName(); itf = (r.getAccess() & Opcodes.ACC_INTERFACE) != 0; } }
      else if (StubGen.eligible(in)) { sup = StubGen.superOf(in); itf = StubGen.KNOWN_ITF.contains(in); }
      else { Class<?> c = Class.forName(in.replace('/', '.'), false, cl); itf = c.isInterface(); sup = c.getSuperclass() == null ? null : c.getSuperclass().getName().replace('.', '/'); }
    } catch (Throwable t) { }
    if (sup == null && !"java/lang/Object".equals(in)) sup = "java/lang/Object";
    h = new H(sup, itf); hier.put(in, h); return h;
  }
  List<String> chain(String in) { List<String> l = new ArrayList<>(); for (String c = in; c != null && l.size() < 40; c = info(c).sup) l.add(c); if (!l.contains("java/lang/Object")) l.add("java/lang/Object"); return l; }

  byte[] fix(byte[] b) {
    ClassReader cr = new ClassReader(b);
    ClassNode cn = new ClassNode(); cr.accept(cn, ClassReader.SKIP_FRAMES);
    boolean itf = (cn.access & Opcodes.ACC_INTERFACE) != 0;
    for (MethodNode m : cn.methods) {
      if (m.instructions.size() == 0) continue;
      try { fixMethod(cn, m); } catch (Throwable t) { if (DBG) System.err.println("[frames] " + cn.name + "." + m.name + ": " + t); }
    }
    if (!itf && cn.superName != null) {
      Set<String> ds = new TreeSet<>(); ds.add("()V"); Set<String> nd = NEED.get(cn.name); if (nd != null) ds.addAll(nd);
      for (MethodNode m0 : cn.methods) if ("<init>".equals(m0.name)) ds.remove(m0.desc);
      for (String d : ds) { // trivial constructor chaining to the superclass, used by redirected calls only
        MethodNode m = new MethodNode(Opcodes.ACC_PUBLIC | Opcodes.ACC_SYNTHETIC, "<init>", d, null, null);
        m.instructions.add(new VarInsnNode(Opcodes.ALOAD, 0)); int slot = 1;
        for (Type t : Type.getArgumentTypes(d)) { m.instructions.add(new VarInsnNode(t.getOpcode(Opcodes.ILOAD), slot)); slot += t.getSize(); }
        m.instructions.add(new MethodInsnNode(Opcodes.INVOKESPECIAL, cn.superName, "<init>", d, false));
        m.instructions.add(new InsnNode(Opcodes.RETURN)); m.maxStack = slot; m.maxLocals = slot; cn.methods.add(m);
      }
    }
    ClassWriter w = new ClassWriter(ClassWriter.COMPUTE_FRAMES) {
      @Override protected String getCommonSuperClass(String a, String c) {
        if (a.equals(c)) return a;
        if (info(a).itf || info(c).itf) return "java/lang/Object";
        List<String> ca = chain(a); for (String x : chain(c)) if (ca.contains(x)) return x;
        return "java/lang/Object";
      }
      @Override protected ClassLoader getClassLoader() { return cl; }
    };
    cn.accept(w);
    return w.toByteArray();
  }

  /** where a stack/local value was allocated: NEW nodes, or THIS for the constructor's receiver */
  static void origins(Map<AbstractInsnNode, Integer> ix, Frame<SourceValue>[] fr, SourceValue v, Set<Object> out, Set<AbstractInsnNode> seen, boolean ctor) {
    if (v == null) return;
    if (v.insns.isEmpty()) { out.add(THIS); return; }
    for (AbstractInsnNode i : v.insns) {
      if (!seen.add(i)) continue;
      int op = i.getOpcode(); Integer at = ix.get(i); Frame<SourceValue> f = at == null ? null : fr[at];
      if (f == null) continue;
      if (op == Opcodes.NEW) out.add(i);
      else if (op == Opcodes.ALOAD) { int var = ((VarInsnNode) i).var; SourceValue l = f.getLocal(var); if (l.insns.isEmpty()) { if (ctor && var == 0) out.add(THIS); } else origins(ix, fr, l, out, seen, ctor); }
      else if (op == Opcodes.ASTORE || op == Opcodes.DUP || op == Opcodes.CHECKCAST) origins(ix, fr, f.getStack(f.getStackSize() - 1), out, seen, ctor);
    }
  }

  void fixMethod(ClassNode cn, MethodNode m) throws AnalyzerException {
    boolean ctor = "<init>".equals(m.name);
    Frame<SourceValue>[] fr = new Analyzer<>(new SourceInterpreter()).analyze(cn.name, m);
    AbstractInsnNode[] insns = m.instructions.toArray();
    Map<AbstractInsnNode, Integer> ix = new IdentityHashMap<>(); for (int k = 0; k < insns.length; k++) ix.put(insns[k], k);
    List<Runnable> edits = new ArrayList<>();
    // 2a. `new Object` that is used as an X: retype to X
    Map<TypeInsnNode, String> want = new HashMap<>();
    for (int k = 0; k < insns.length; k++) {
      AbstractInsnNode i = insns[k]; Frame<SourceValue> f = fr[k]; if (f == null) continue;
      List<Object[]> uses = new ArrayList<>(); int top = f.getStackSize() - 1;
      if (i instanceof MethodInsnNode) { MethodInsnNode mi = (MethodInsnNode) i; Type[] at = Type.getArgumentTypes(mi.desc); int p = top;
        for (int a = at.length - 1; a >= 0; a--) { if (at[a].getSort() == Type.OBJECT) uses.add(new Object[]{ f.getStack(p), at[a].getInternalName() }); p--; }
        if (i.getOpcode() != Opcodes.INVOKESTATIC && !"<init>".equals(mi.name)) uses.add(new Object[]{ f.getStack(p), mi.owner });
      } else if (i instanceof FieldInsnNode) { FieldInsnNode fi = (FieldInsnNode) i; Type t = Type.getType(fi.desc);
        if (i.getOpcode() == Opcodes.PUTFIELD) { if (t.getSort() == Type.OBJECT) uses.add(new Object[]{ f.getStack(top), t.getInternalName() }); uses.add(new Object[]{ f.getStack(top - 1), fi.owner }); }
        else if (i.getOpcode() == Opcodes.PUTSTATIC && t.getSort() == Type.OBJECT) uses.add(new Object[]{ f.getStack(top), t.getInternalName() });
        else if (i.getOpcode() == Opcodes.GETFIELD) uses.add(new Object[]{ f.getStack(top), fi.owner });
      } else if (i.getOpcode() == Opcodes.ARETURN) { Type r = Type.getReturnType(m.desc); if (r.getSort() == Type.OBJECT) uses.add(new Object[]{ f.getStack(top), r.getInternalName() }); }
      for (Object[] u : uses) { String t = (String) u[1]; if ("java/lang/Object".equals(t) || info(t).itf) continue;
        Set<Object> o = new HashSet<>(); origins(ix, fr, (SourceValue) u[0], o, new HashSet<>(), ctor);
        for (Object n : o) if (n instanceof TypeInsnNode && "java/lang/Object".equals(((TypeInsnNode) n).desc)) {
          TypeInsnNode tn = (TypeInsnNode) n; String cur = want.get(tn); if (cur == null || chain(t).contains(cur)) want.put(tn, t); } }
    }
    for (Map.Entry<TypeInsnNode, String> e : want.entrySet()) { if (DBG) System.err.println("[frames] " + cn.name + "." + m.name + ": new Object -> " + e.getValue()); e.getKey().desc = e.getValue(); }
    // 2b/3. constructor calls
    for (int k = 0; k < insns.length; k++) {
      if (!(insns[k] instanceof MethodInsnNode)) continue; MethodInsnNode mi = (MethodInsnNode) insns[k];
      if (mi.getOpcode() != Opcodes.INVOKESPECIAL || !"<init>".equals(mi.name)) continue;
      Frame<SourceValue> f = fr[k]; if (f == null) continue;
      int slots = 0; for (Type t : Type.getArgumentTypes(mi.desc)) slots += t.getSize();
      SourceValue recv = f.getStack(f.getStackSize() - 1 - slots);
      Set<Object> o = new HashSet<>(); origins(ix, fr, recv, o, new HashSet<>(), ctor);
      if (DBG) System.err.println("[frames] " + m.name + " init " + mi.owner + " recv=" + recv.insns.size() + " origins=" + o.size());
      if (o.size() != 1) continue;
      Object n = o.iterator().next();
      String target = n == THIS ? (mi.owner.equals(cn.name) ? cn.name : cn.superName) : ((TypeInsnNode) n).desc;
      if (target != null && !target.equals(mi.owner) && chain(target).contains(mi.owner)) { if (!"()V".equals(mi.desc)) need(target, mi.desc, mi.owner); mi.owner = target; }
      if (n == THIS || recv.insns.size() != 1) continue;
      AbstractInsnNode src = recv.insns.iterator().next();
      if (src.getOpcode() != Opcodes.ALOAD) continue;
      // parked in a local: allocate here instead, store after <init>, drop the stores of the original allocation
      final TypeInsnNode nw = (TypeInsnNode) n; final int var = ((VarInsnNode) src).var; final AbstractInsnNode fsrc = src; final MethodInsnNode fmi = mi;
      for (int j = 0; j < insns.length; j++) if (insns[j].getOpcode() == Opcodes.ASTORE && fr[j] != null) {
        Set<AbstractInsnNode> direct = fr[j].getStack(fr[j].getStackSize() - 1).insns; // only the store of the fresh, uninitialised object
        if (direct.size() == 1 && direct.contains(nw)) { final AbstractInsnNode st = insns[j]; edits.add(() -> { if (m.instructions.contains(st)) m.instructions.set(st, new InsnNode(Opcodes.POP)); }); } }
      edits.add(() -> { InsnList rep = new InsnList(); rep.add(new TypeInsnNode(Opcodes.NEW, nw.desc)); rep.add(new InsnNode(Opcodes.DUP));
        m.instructions.insert(fsrc, rep); m.instructions.remove(fsrc); m.instructions.insert(fmi, new VarInsnNode(Opcodes.ASTORE, var)); });
    }
    for (Runnable r : edits) r.run();
  }
}
