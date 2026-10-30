package android.util;
public class Pair<F, S> { public final F first; public final S second;
  public Pair(F f, S s) { first = f; second = s; } public static <A, B> Pair<A, B> create(A a, B b) { return new Pair<>(a, b); } }