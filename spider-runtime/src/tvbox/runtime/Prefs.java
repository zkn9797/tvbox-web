package tvbox.runtime;
import android.content.SharedPreferences; import java.io.*; import java.util.*;
/** File-backed SharedPreferences (java.util.Properties, type-tagged). */
public class Prefs implements SharedPreferences {
  final File f; final Map<String, Object> m = new LinkedHashMap<>();
  Prefs(File f) { this.f = f; load(); }
  synchronized void load() { if (!f.exists()) return; try (Reader r = new InputStreamReader(new FileInputStream(f), "UTF-8")) { Properties p = new Properties(); p.load(r);
    for (String k : p.stringPropertyNames()) { String v = p.getProperty(k); char t = v.isEmpty() ? 's' : v.charAt(0); String s = v.isEmpty() ? "" : v.substring(1);
      try { switch (t) { case 'i': m.put(k, Integer.parseInt(s)); break; case 'l': m.put(k, Long.parseLong(s)); break; case 'f': m.put(k, Float.parseFloat(s)); break; case 'b': m.put(k, Boolean.parseBoolean(s)); break;
        case 'S': m.put(k, new LinkedHashSet<>(Arrays.asList(s.isEmpty() ? new String[0] : s.split("\u0001")))); break; default: m.put(k, s); } } catch (Exception e) { m.put(k, s); } } } catch (IOException e) { } }
  synchronized void save() { Properties p = new Properties(); for (Map.Entry<String, Object> e : m.entrySet()) { Object v = e.getValue(); String t = v instanceof Integer ? "i" : v instanceof Long ? "l" : v instanceof Float ? "f" : v instanceof Boolean ? "b" : v instanceof Set ? "S" : "s";
      p.setProperty(e.getKey(), t + (v instanceof Set ? String.join("\u0001", (Set<String>) v) : String.valueOf(v))); }
    f.getParentFile().mkdirs(); try (Writer w = new OutputStreamWriter(new FileOutputStream(f), "UTF-8")) { p.store(w, null); } catch (IOException e) { } }
  public synchronized Map<String, ?> getAll() { return new HashMap<>(m); }
  public synchronized String getString(String k, String d) { Object o = m.get(k); return o == null ? d : String.valueOf(o); }
  public synchronized Set<String> getStringSet(String k, Set<String> d) { Object o = m.get(k); return o instanceof Set ? (Set<String>) o : d; }
  public synchronized int getInt(String k, int d) { Object o = m.get(k); return o instanceof Number ? ((Number) o).intValue() : d; }
  public synchronized long getLong(String k, long d) { Object o = m.get(k); return o instanceof Number ? ((Number) o).longValue() : d; }
  public synchronized float getFloat(String k, float d) { Object o = m.get(k); return o instanceof Number ? ((Number) o).floatValue() : d; }
  public synchronized boolean getBoolean(String k, boolean d) { Object o = m.get(k); return o instanceof Boolean ? (Boolean) o : d; }
  public synchronized boolean contains(String k) { return m.containsKey(k); }
  public void registerOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener l) {} public void unregisterOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener l) {}
  public Editor edit() { return new Ed(); }
  class Ed implements Editor { final Map<String, Object> ch = new LinkedHashMap<>(); boolean clear;
    public Editor putString(String k, String v) { ch.put(k, v); return this; } public Editor putStringSet(String k, Set<String> v) { ch.put(k, v == null ? null : new LinkedHashSet<>(v)); return this; }
    public Editor putInt(String k, int v) { ch.put(k, v); return this; } public Editor putLong(String k, long v) { ch.put(k, v); return this; }
    public Editor putFloat(String k, float v) { ch.put(k, v); return this; } public Editor putBoolean(String k, boolean v) { ch.put(k, v); return this; }
    public Editor remove(String k) { ch.put(k, null); return this; } public Editor clear() { clear = true; return this; }
    public boolean commit() { synchronized (Prefs.this) { if (clear) m.clear(); for (Map.Entry<String, Object> e : ch.entrySet()) { if (e.getValue() == null) m.remove(e.getKey()); else m.put(e.getKey(), e.getValue()); } save(); } return true; }
    public void apply() { commit(); } }
}
