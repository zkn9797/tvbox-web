package android.database;
import java.util.*;
/** Fully materialised result set (the runtime's Cursor implementation). */
public class MemCursor implements Cursor {
  final String[] cols; final List<Object[]> rows; int pos = -1; boolean closed;
  public MemCursor(String[] cols, List<Object[]> rows) { this.cols = cols; this.rows = rows; }
  public static MemCursor of(java.sql.ResultSet rs) throws java.sql.SQLException {
    java.sql.ResultSetMetaData md = rs.getMetaData(); int n = md.getColumnCount(); String[] c = new String[n]; for (int i = 0; i < n; i++) c[i] = md.getColumnLabel(i + 1);
    List<Object[]> r = new ArrayList<>(); while (rs.next()) { Object[] o = new Object[n]; for (int i = 0; i < n; i++) o[i] = rs.getObject(i + 1); r.add(o); } rs.close(); return new MemCursor(c, r);
  }
  public int getCount() { return rows.size(); } public int getPosition() { return pos; }
  public boolean moveToPosition(int p) { if (p < 0) { pos = -1; return false; } if (p >= rows.size()) { pos = rows.size(); return false; } pos = p; return true; }
  public boolean move(int o) { return moveToPosition(pos + o); } public boolean moveToFirst() { return moveToPosition(0); } public boolean moveToLast() { return moveToPosition(rows.size() - 1); }
  public boolean moveToNext() { return moveToPosition(pos + 1); } public boolean moveToPrevious() { return moveToPosition(pos - 1); }
  public boolean isFirst() { return pos == 0 && !rows.isEmpty(); } public boolean isLast() { return !rows.isEmpty() && pos == rows.size() - 1; } public boolean isBeforeFirst() { return rows.isEmpty() || pos < 0; } public boolean isAfterLast() { return rows.isEmpty() || pos >= rows.size(); }
  public int getColumnIndex(String n) { for (int i = 0; i < cols.length; i++) if (cols[i].equalsIgnoreCase(n)) return i; return -1; }
  public int getColumnIndexOrThrow(String n) { int i = getColumnIndex(n); if (i < 0) throw new IllegalArgumentException("column '" + n + "' does not exist"); return i; }
  public String getColumnName(int i) { return cols[i]; } public String[] getColumnNames() { return cols.clone(); } public int getColumnCount() { return cols.length; }
  Object v(int i) { return rows.get(pos)[i]; }
  public String getString(int i) { Object o = v(i); return o == null ? null : o instanceof byte[] ? new String((byte[]) o) : o.toString(); }
  long num(int i) { Object o = v(i); if (o == null) return 0; if (o instanceof Number) return ((Number) o).longValue(); try { return Long.parseLong(o.toString().trim()); } catch (Exception e) { return 0; } }
  public int getInt(int i) { return (int) num(i); } public long getLong(int i) { return num(i); } public short getShort(int i) { return (short) num(i); }
  public double getDouble(int i) { Object o = v(i); if (o instanceof Number) return ((Number) o).doubleValue(); try { return Double.parseDouble(String.valueOf(o)); } catch (Exception e) { return 0; } }
  public float getFloat(int i) { return (float) getDouble(i); }
  public byte[] getBlob(int i) { Object o = v(i); return o == null ? null : o instanceof byte[] ? (byte[]) o : o.toString().getBytes(); }
  public boolean isNull(int i) { return v(i) == null; }
  public int getType(int i) { Object o = v(i); return o == null ? 0 : o instanceof Long || o instanceof Integer ? 1 : o instanceof Number ? 2 : o instanceof byte[] ? 4 : 3; }
  public void close() { closed = true; } public boolean isClosed() { return closed; }
}
