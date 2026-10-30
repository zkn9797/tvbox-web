package android.util;
public class TypedValue { public static final int COMPLEX_UNIT_PX=0, COMPLEX_UNIT_DIP=1, COMPLEX_UNIT_SP=2;
  public static float applyDimension(int unit, float v, DisplayMetrics m) { return unit == 0 ? v : v * m.density; } }