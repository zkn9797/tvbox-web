package tvbox.runtime;
import java.io.*; import java.net.*; import java.util.*; import java.util.zip.*; import org.objectweb.asm.*;
/** Synthesises placeholder classes for Android / X5 / QuickJS types that a spider jar references but the runtime
 *  does not implement. Members the jar uses (constructors, methods, static fields) are generated as no-ops that
 *  return defaults, so UI-only code paths (config dialogs, QR popups, WebView setup) run harmlessly and bytecode
 *  verification of the spider classes succeeds. */
final class StubGen {
  static final String[] PREFIXES = { "android/", "androidx/", "dalvik/", "com/tencent/smtt/", "com/whl/quickjs/", "com/google/android/", "org/slf4j/impl/", "com/thegrizzlylabs/sardineandroid/" };
  static boolean eligible(String in) { for (String p : PREFIXES) if (in.startsWith(p)) return true; return false; }
  // real Android superclasses for types commonly referenced by spiders
  static final Map<String, String> SUPER = new HashMap<>();
  static {
    String[][] t = {
      { "android/widget/AdapterView", "android/view/ViewGroup" }, { "android/widget/AbsListView", "android/widget/AdapterView" }, { "android/widget/GridView", "android/widget/AbsListView" },
      { "android/widget/ListView", "android/widget/AbsListView" }, { "android/widget/AbsSpinner", "android/widget/AdapterView" }, { "android/widget/Spinner", "android/widget/AbsSpinner" },
      { "android/widget/CompoundButton", "android/widget/Button" }, { "android/widget/CheckBox", "android/widget/CompoundButton" }, { "android/widget/RadioButton", "android/widget/CompoundButton" },
      { "android/widget/Switch", "android/widget/CompoundButton" }, { "android/widget/ToggleButton", "android/widget/CompoundButton" }, { "android/widget/RadioGroup", "android/widget/LinearLayout" },
      { "android/widget/RelativeLayout", "android/view/ViewGroup" }, { "android/widget/ImageButton", "android/widget/ImageView" }, { "android/widget/SeekBar", "android/widget/ProgressBar" },
      { "android/widget/AbsListView$LayoutParams", "android/view/ViewGroup$LayoutParams" }, { "android/widget/RelativeLayout$LayoutParams", "android/view/ViewGroup$MarginLayoutParams" },
      { "android/widget/FrameLayout$LayoutParams", "android/view/ViewGroup$MarginLayoutParams" }, { "android/widget/GridLayout$LayoutParams", "android/view/ViewGroup$MarginLayoutParams" },
      { "android/widget/BaseAdapter", "java/lang/Object" }, { "android/webkit/WebView", "android/widget/FrameLayout" }, { "com/tencent/smtt/sdk/WebView", "android/widget/FrameLayout" },
      { "android/app/Service", "android/content/ContextWrapper" }, { "android/app/Fragment", "java/lang/Object" }, { "android/text/TextPaint", "android/graphics/Paint" },
      { "android/graphics/drawable/GradientDrawable", "android/graphics/drawable/Drawable" }, { "android/graphics/drawable/StateListDrawable", "android/graphics/drawable/Drawable" },
      { "android/graphics/drawable/LayerDrawable", "android/graphics/drawable/Drawable" }, { "android/os/HandlerThread", "java/lang/Thread" },
      { "android/graphics/LinearGradient", "android/graphics/Shader" }, { "android/graphics/RadialGradient", "android/graphics/Shader" }, { "android/graphics/SweepGradient", "android/graphics/Shader" },
      { "android/graphics/BitmapShader", "android/graphics/Shader" }, { "android/graphics/ComposeShader", "android/graphics/Shader" }, { "android/widget/EditText", "android/widget/TextView" }, { "android/os/BaseBundle", "java/lang/Object" },
    };
    for (String[] p : t) SUPER.put(p[0], p[1]);
  }
  /** Android types that are interfaces even when a jar never invokes them as such (verifier assignability) */
  static final Set<String> KNOWN_ITF = new HashSet<>(Arrays.asList("android/view/KeyEvent$Callback", "android/view/Window$Callback",
      "android/graphics/drawable/Drawable$Callback", "android/view/ViewParent", "android/view/ViewManager", "android/text/Spanned", "android/text/Spannable",
      "android/text/Editable", "android/text/TextWatcher", "android/content/DialogInterface", "android/os/Parcelable", "android/view/accessibility/AccessibilityEventSource"));
  static final Map<String, String[]> IFACES = new HashMap<>();
  static { IFACES.put("android/widget/BaseAdapter", new String[]{ "android/widget/ListAdapter" }); IFACES.put("android/text/SpannableString", new String[]{ "java/lang/CharSequence" }); IFACES.put("android/text/SpannableStringBuilder", new String[]{ "java/lang/CharSequence", "android/text/Editable" }); }

  final Map<String, Boolean> iface = new HashMap<>();
  final Set<String> refs = new HashSet<>();
  final Map<String, Set<String>> members = new HashMap<>(); // owner -> {"v name desc" | "s name desc" | "i <init> desc" | "f name desc" | "F name desc"}
  StubGen(URL[] urls) {
    for (URL u : urls) {
      if (!"file".equals(u.getProtocol())) continue;
      try (ZipFile z = new ZipFile(new File(u.toURI()))) {
        for (ZipEntry e : Collections.list(z.entries())) {
          if (!e.getName().endsWith(".class")) continue;
          ClassReader cr = new ClassReader(z.getInputStream(e).readAllBytes());
          if (cr.getSuperName() != null) mark(cr.getSuperName(), false);
          for (String i : cr.getInterfaces()) mark(i, true);
          cr.accept(new ClassVisitor(Opcodes.ASM9) {
            @Override public FieldVisitor visitField(int a, String n, String d, String s, Object v) { desc(d); return null; }
            @Override public MethodVisitor visitMethod(int a, String n, String d, String s, String[] x) {
              desc(d);
              return new MethodVisitor(Opcodes.ASM9) {
                @Override public void visitTryCatchBlock(Label a, Label b, Label c, String t) { if (t != null) ref(t); }
                @Override public void visitMethodInsn(int op, String o, String nm, String ds, boolean itf) {
                  desc(ds);
                  if (op == Opcodes.INVOKEINTERFACE || (itf && op == Opcodes.INVOKESTATIC)) mark(o, true);
                  else if (op == Opcodes.INVOKESPECIAL && "<init>".equals(nm)) { mark(o, false); mem(o, "i " + nm + " " + ds); }
                  else { ref(o); if (op == Opcodes.INVOKESTATIC) mem(o, "s " + nm + " " + ds); else if (op == Opcodes.INVOKEVIRTUAL) mem(o, "v " + nm + " " + ds); }
                }
                @Override public void visitTypeInsn(int op, String t) { if (op == Opcodes.NEW) mark(t, false); else ref(t); }
                @Override public void visitFieldInsn(int op, String o, String nm, String ds) { ref(o); desc(ds); mem(o, (op == Opcodes.GETSTATIC || op == Opcodes.PUTSTATIC ? "F " : "f ") + nm + " " + ds); }
              };
            }
          }, ClassReader.SKIP_DEBUG | ClassReader.SKIP_FRAMES);
          char[] buf = new char[cr.getMaxStringLength()];
          for (int i = 1; i < cr.getItemCount(); i++) { int off = cr.getItem(i); if (off != 0 && cr.b[off - 1] == 7) { String n = cr.readUTF8(off, buf); if (n != null) ref(n.replaceAll("^\\[+L?|;$", "")); } }
        }
      } catch (Exception ignore) { }
    }
  }
  void mark(String n, boolean i) { if (!eligible(n)) return; refs.add(n); if (i) iface.put(n, true); else iface.putIfAbsent(n, false); }
  void ref(String n) { if (eligible(n)) refs.add(n); }
  void mem(String o, String m) { if (eligible(o)) members.computeIfAbsent(o, k -> new TreeSet<>()).add(m); }
  static final java.util.regex.Pattern OBJ = java.util.regex.Pattern.compile("L([^;]+);");
  void desc(String d) { if (d == null) return; java.util.regex.Matcher m = OBJ.matcher(d); while (m.find()) ref(m.group(1)); }
  boolean knows(String in) { return refs.contains(in) || SUPER.containsKey(in) || SUPER.containsValue(in); }

  byte[] make(String in, ClassLoader cl) {
    boolean isI = KNOWN_ITF.contains(in) || Boolean.TRUE.equals(iface.get(in)) || (!iface.containsKey(in) && in.matches(".*(Listener|Callback|Watcher|Handler|Interface|Function|Callable|Getter|Filter)(\\$.*)?$") && !in.endsWith("$Callback"));
    Set<String> ms = members.getOrDefault(in, Collections.emptySet());
    ClassWriter cw = new ClassWriter(ClassWriter.COMPUTE_MAXS);
    if (isI) {
      cw.visit(Opcodes.V1_8, Opcodes.ACC_PUBLIC | Opcodes.ACC_INTERFACE | Opcodes.ACC_ABSTRACT, in, null, "java/lang/Object", null);
      for (String m : ms) { String[] p = m.split(" "); if (p[0].equals("s")) defaultMethod(cw, Opcodes.ACC_PUBLIC | Opcodes.ACC_STATIC, p[1], p[2]); }
      cw.visitEnd(); return cw.toByteArray();
    }
    String sup = superOf(in);
    cw.visit(Opcodes.V1_5, Opcodes.ACC_PUBLIC, in, null, sup, IFACES.get(in)); // pre-StackMapTable version: branchy bodies need no frames
    Set<String> ctors = new TreeSet<>(Arrays.asList("()V", "(Landroid/content/Context;)V"));
    Set<String> fields = new HashSet<>();
    for (String m : ms) { String[] p = m.split(" ");
      if (p[0].equals("i")) ctors.add(p[2]);
      else if (p[0].equals("v")) { if (!hasMethod(cl, sup, p[1], p[2])) defaultMethod(cw, Opcodes.ACC_PUBLIC, p[1], p[2]); }
      else if (p[0].equals("s")) defaultMethod(cw, Opcodes.ACC_PUBLIC | Opcodes.ACC_STATIC, p[1], p[2]);
      else if ((p[0].equals("F") || p[0].equals("f")) && fields.add(p[1]) && !hasField(cl, sup, p[1])) cw.visitField(Opcodes.ACC_PUBLIC | (p[0].equals("F") ? Opcodes.ACC_STATIC : 0), p[1], p[2], null, null).visitEnd();
    }
    for (String d : ctors) ctor(cw, cl, sup, d);
    cw.visitEnd(); return cw.toByteArray();
  }
  static void defaultMethod(ClassWriter cw, int acc, String n, String d) {
    MethodVisitor mv = cw.visitMethod(acc, n, d, null, null); mv.visitCode(); Type r = Type.getReturnType(d);
    switch (r.getSort()) { case Type.VOID: mv.visitInsn(Opcodes.RETURN); break; case Type.LONG: mv.visitInsn(Opcodes.LCONST_0); mv.visitInsn(Opcodes.LRETURN); break;
      case Type.FLOAT: mv.visitInsn(Opcodes.FCONST_0); mv.visitInsn(Opcodes.FRETURN); break; case Type.DOUBLE: mv.visitInsn(Opcodes.DCONST_0); mv.visitInsn(Opcodes.DRETURN); break;
      case Type.OBJECT: case Type.ARRAY:
        if (r.getDescriptor().equals("Ljava/lang/String;")) { mv.visitLdcInsn(""); mv.visitInsn(Opcodes.ARETURN); }
        else if ((acc & Opcodes.ACC_STATIC) == 0 && r.getSort() == Type.OBJECT && !r.getInternalName().startsWith("java/")) { mv.visitVarInsn(Opcodes.ALOAD, 0); mv.visitTypeInsn(Opcodes.INSTANCEOF, r.getInternalName()); Label no = new Label(); mv.visitJumpInsn(Opcodes.IFEQ, no); mv.visitVarInsn(Opcodes.ALOAD, 0); mv.visitTypeInsn(Opcodes.CHECKCAST, r.getInternalName()); mv.visitInsn(Opcodes.ARETURN); mv.visitLabel(no); mv.visitInsn(Opcodes.ACONST_NULL); mv.visitInsn(Opcodes.ARETURN); } // builder-style setters return this
        else { mv.visitInsn(Opcodes.ACONST_NULL); mv.visitInsn(Opcodes.ARETURN); } break;
      default: mv.visitInsn(Opcodes.ICONST_0); mv.visitInsn(Opcodes.IRETURN); }
    mv.visitMaxs(0, 0); mv.visitEnd();
  }
  static void ctor(ClassWriter cw, ClassLoader cl, String sup, String d) {
    MethodVisitor mv = cw.visitMethod(Opcodes.ACC_PUBLIC, "<init>", d, null, null); mv.visitCode(); mv.visitVarInsn(Opcodes.ALOAD, 0);
    Type[] args = Type.getArgumentTypes(d);
    if (hasCtor(cl, sup, d)) { int slot = 1; for (Type t : args) { mv.visitVarInsn(t.getOpcode(Opcodes.ILOAD), slot); slot += t.getSize(); } mv.visitMethodInsn(Opcodes.INVOKESPECIAL, sup, "<init>", d, false); }
    else if (hasCtor(cl, sup, "()V")) mv.visitMethodInsn(Opcodes.INVOKESPECIAL, sup, "<init>", "()V", false);
    else if (hasCtor(cl, sup, "(Landroid/content/Context;)V")) { mv.visitInsn(Opcodes.ACONST_NULL); mv.visitMethodInsn(Opcodes.INVOKESPECIAL, sup, "<init>", "(Landroid/content/Context;)V", false); }
    else if (hasCtor(cl, sup, "(II)V")) { mv.visitInsn(Opcodes.ICONST_M1); mv.visitInsn(Opcodes.ICONST_M1); mv.visitMethodInsn(Opcodes.INVOKESPECIAL, sup, "<init>", "(II)V", false); }
    else mv.visitMethodInsn(Opcodes.INVOKESPECIAL, sup, "<init>", "()V", false);
    mv.visitInsn(Opcodes.RETURN); mv.visitMaxs(0, 0); mv.visitEnd();
  }
  static Class<?> cls(ClassLoader cl, String in) { try { return Class.forName(in.replace('/', '.'), false, cl); } catch (Throwable t) { return null; } }
  static Class<?>[] params(ClassLoader cl, String d) { Type[] a = Type.getArgumentTypes(d); Class<?>[] r = new Class<?>[a.length];
    for (int i = 0; i < a.length; i++) { Type t = a[i]; switch (t.getSort()) { case Type.INT: r[i] = int.class; break; case Type.LONG: r[i] = long.class; break; case Type.FLOAT: r[i] = float.class; break; case Type.DOUBLE: r[i] = double.class; break; case Type.BOOLEAN: r[i] = boolean.class; break; case Type.BYTE: r[i] = byte.class; break; case Type.CHAR: r[i] = char.class; break; case Type.SHORT: r[i] = short.class; break; default: r[i] = cls(cl, t.getSort() == Type.ARRAY ? t.getDescriptor().replace('/', '.') : t.getInternalName()); if (r[i] == null) return null; } } return r; }
  static boolean hasCtor(ClassLoader cl, String sup, String d) { Class<?> c = cls(cl, sup); Class<?>[] p = params(cl, d); if (c == null || p == null) return false; try { c.getDeclaredConstructor(p); return true; } catch (Throwable t) { return false; } }
  static boolean hasMethod(ClassLoader cl, String sup, String n, String d) { Class<?> c = cls(cl, sup); Class<?>[] p = params(cl, d); if (c == null || p == null) return false; for (Class<?> k = c; k != null; k = k.getSuperclass()) try { k.getDeclaredMethod(n, p); return true; } catch (Throwable t) { } return false; }
  static boolean hasField(ClassLoader cl, String sup, String n) { Class<?> c = cls(cl, sup); if (c == null) return false; try { c.getField(n); return true; } catch (Throwable t) { return false; } }
  static String superOf(String in) {
    String s = SUPER.get(in); if (s != null) return s;
    String n = in.substring(in.lastIndexOf('/') + 1);
    if (n.endsWith("$LayoutParams")) return "android/view/ViewGroup$MarginLayoutParams";
    if (n.contains("$")) return "java/lang/Object";
    if (n.endsWith("Exception") || n.endsWith("Error")) return "java/lang/RuntimeException";
    if (n.endsWith("Drawable")) return "android/graphics/drawable/Drawable";
    if (n.endsWith("Layout") || n.endsWith("ViewGroup") || n.endsWith("ListView") || n.endsWith("GridView") || n.endsWith("Pager")) return "android/view/ViewGroup";
    if (n.endsWith("View") || n.endsWith("Bar")) return "android/view/View";
    if (n.endsWith("Button")) return "android/widget/Button";
    if (n.endsWith("Dialog")) return "android/app/Dialog";
    return "java/lang/Object";
  }
}
