package android.os;
public class Bundle { final java.util.HashMap<String,Object> m = new java.util.HashMap<>();
  public String getString(String k) { Object o = m.get(k); return o == null ? null : o.toString(); } public String getString(String k, String d) { String s = getString(k); return s == null ? d : s; }
  public void putString(String k, String v) { m.put(k, v); } public int getInt(String k) { Object o = m.get(k); return o instanceof Integer ? (Integer) o : 0; }
  public void putInt(String k, int v) { m.put(k, v); } public boolean containsKey(String k) { return m.containsKey(k); } public Object get(String k) { return m.get(k); } }