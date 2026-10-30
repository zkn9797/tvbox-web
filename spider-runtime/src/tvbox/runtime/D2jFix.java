package tvbox.runtime;
/** dex2jar 2.4.x translates fill-array-data into System.arraycopy(target, 0, decoded, 0, n) - source and
 *  destination swapped, leaving the array zero-filled. NativeLoader routes those calls here. */
public final class D2jFix {
  public static void copy(Object target, int tp, Object decoded, int dp, int n) { System.arraycopy(decoded, dp, target, tp, n); }
}
