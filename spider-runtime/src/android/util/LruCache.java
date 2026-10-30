package android.util;
public class LruCache<K,V> { private final java.util.LinkedHashMap<K,V> m; private final int max;
  public LruCache(int max) { this.max = max; m = new java.util.LinkedHashMap<K,V>(16, .75f, true) { protected boolean removeEldestEntry(java.util.Map.Entry<K,V> e) { return size() > LruCache.this.max; } }; }
  public synchronized V get(K k) { return m.get(k); } public synchronized V put(K k, V v) { return m.put(k, v); } public synchronized V remove(K k) { return m.remove(k); }
  public synchronized void evictAll() { m.clear(); } public synchronized int size() { return m.size(); } }