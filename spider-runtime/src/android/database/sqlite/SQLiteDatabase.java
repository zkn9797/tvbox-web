package android.database.sqlite;
import android.content.ContentValues; import android.database.*; import java.sql.*; import java.util.*;
/** android SQLite API on top of sqlite-jdbc. */
public class SQLiteDatabase extends SQLiteClosable {
  public static final int OPEN_READWRITE = 0, OPEN_READONLY = 1, CREATE_IF_NECESSARY = 0x10000000, NO_LOCALIZED_COLLATORS = 0x10, CONFLICT_NONE = 0, CONFLICT_REPLACE = 5, CONFLICT_IGNORE = 4;
  public interface CursorFactory { }
  final Connection c; final String path; int txDepth; boolean txOk;
  SQLiteDatabase(String path) { this.path = path; try { Class.forName("org.sqlite.JDBC"); java.io.File f = new java.io.File(path); if (f.getParentFile() != null) f.getParentFile().mkdirs(); c = DriverManager.getConnection("jdbc:sqlite:" + path); } catch (Exception e) { throw new SQLiteException("open " + path + ": " + e.getMessage(), e); } }
  public static SQLiteDatabase openDatabase(String path, CursorFactory f, int flags) { return new SQLiteDatabase(path); }
  public static SQLiteDatabase openDatabase(String path, CursorFactory f, int flags, Object errHandler) { return new SQLiteDatabase(path); }
  public static SQLiteDatabase openOrCreateDatabase(String path, CursorFactory f) { return new SQLiteDatabase(path); }
  public static SQLiteDatabase openOrCreateDatabase(java.io.File file, CursorFactory f) { return new SQLiteDatabase(file.getAbsolutePath()); }
  public static SQLiteDatabase create(CursorFactory f) { return new SQLiteDatabase(":memory:"); }
  public String getPath() { return path; } public boolean isOpen() { try { return !c.isClosed(); } catch (SQLException e) { return false; } } public boolean isReadOnly() { return false; }
  @Override protected void onAllReferencesReleased() { try { c.close(); } catch (SQLException e) { } }
  PreparedStatement ps(String sql, Object[] a) throws SQLException { PreparedStatement p = c.prepareStatement(sql); if (a != null) for (int i = 0; i < a.length; i++) p.setObject(i + 1, a[i]); return p; }
  public void execSQL(String sql) { execSQL(sql, null); }
  public void execSQL(String sql, Object[] a) { try (PreparedStatement p = ps(sql, a)) { p.execute(); } catch (SQLException e) { throw new SQLiteException(e.getMessage(), e); } }
  public Cursor rawQuery(String sql, String[] a) { try (PreparedStatement p = ps(sql, a)) { return p.execute() ? MemCursor.of(p.getResultSet()) : new MemCursor(new String[0], new ArrayList<>()); } catch (SQLException e) { throw new SQLiteException(e.getMessage(), e); } }
  public Cursor rawQuery(String sql, String[] a, Object cancel) { return rawQuery(sql, a); }
  public Cursor query(String table, String[] cols, String sel, String[] args, String group, String having, String order) { return query(false, table, cols, sel, args, group, having, order, null); }
  public Cursor query(String table, String[] cols, String sel, String[] args, String group, String having, String order, String limit) { return query(false, table, cols, sel, args, group, having, order, limit); }
  public Cursor query(boolean distinct, String table, String[] cols, String sel, String[] args, String group, String having, String order, String limit) {
    StringBuilder s = new StringBuilder("SELECT ").append(distinct ? "DISTINCT " : "").append(cols == null || cols.length == 0 ? "*" : String.join(",", cols)).append(" FROM ").append(table);
    if (sel != null && !sel.isEmpty()) s.append(" WHERE ").append(sel); if (group != null && !group.isEmpty()) s.append(" GROUP BY ").append(group); if (having != null && !having.isEmpty()) s.append(" HAVING ").append(having);
    if (order != null && !order.isEmpty()) s.append(" ORDER BY ").append(order); if (limit != null && !limit.isEmpty()) s.append(" LIMIT ").append(limit); return rawQuery(s.toString(), args);
  }
  long ins(String verb, String table, ContentValues v) {
    List<String> k = new ArrayList<>(v.keySet()); if (k.isEmpty()) { execSQL(verb + " INTO " + table + " DEFAULT VALUES"); return lastId(); }
    String sql = verb + " INTO " + table + " (" + String.join(",", k) + ") VALUES (" + String.join(",", Collections.nCopies(k.size(), "?")) + ")";
    Object[] a = new Object[k.size()]; for (int i = 0; i < a.length; i++) a[i] = v.get(k.get(i));
    try (PreparedStatement p = ps(sql, a)) { p.executeUpdate(); return lastId(); } catch (SQLException e) { return -1; }
  }
  long lastId() { try (Statement s = c.createStatement(); ResultSet r = s.executeQuery("SELECT last_insert_rowid()")) { return r.next() ? r.getLong(1) : -1; } catch (SQLException e) { return -1; } }
  public long insert(String table, String nullHack, ContentValues v) { return ins("INSERT", table, v); }
  public long insertOrThrow(String table, String nullHack, ContentValues v) { long r = ins("INSERT", table, v); if (r < 0) throw new SQLiteException("insert failed"); return r; }
  public long replace(String table, String nullHack, ContentValues v) { return ins("INSERT OR REPLACE", table, v); }
  public long insertWithOnConflict(String table, String nullHack, ContentValues v, int alg) { return ins(alg == CONFLICT_REPLACE ? "INSERT OR REPLACE" : alg == CONFLICT_IGNORE ? "INSERT OR IGNORE" : "INSERT", table, v); }
  public int update(String table, ContentValues v, String where, String[] args) {
    List<String> k = new ArrayList<>(v.keySet()); if (k.isEmpty()) return 0; StringBuilder s = new StringBuilder("UPDATE " + table + " SET ");
    for (int i = 0; i < k.size(); i++) s.append(i > 0 ? "," : "").append(k.get(i)).append("=?"); if (where != null && !where.isEmpty()) s.append(" WHERE ").append(where);
    Object[] a = new Object[k.size() + (args == null ? 0 : args.length)]; for (int i = 0; i < k.size(); i++) a[i] = v.get(k.get(i)); if (args != null) System.arraycopy(args, 0, a, k.size(), args.length);
    try (PreparedStatement p = ps(s.toString(), a)) { return p.executeUpdate(); } catch (SQLException e) { throw new SQLiteException(e.getMessage(), e); }
  }
  public int delete(String table, String where, String[] args) { try (PreparedStatement p = ps("DELETE FROM " + table + (where != null && !where.isEmpty() ? " WHERE " + where : ""), args)) { return p.executeUpdate(); } catch (SQLException e) { throw new SQLiteException(e.getMessage(), e); } }
  public synchronized void beginTransaction() { try { if (txDepth++ == 0) { c.setAutoCommit(false); txOk = false; } } catch (SQLException e) { throw new SQLiteException(e.getMessage(), e); } }
  public void beginTransactionNonExclusive() { beginTransaction(); }
  public void setTransactionSuccessful() { txOk = true; }
  public synchronized void endTransaction() { try { if (--txDepth == 0) { if (txOk) c.commit(); else c.rollback(); c.setAutoCommit(true); } } catch (SQLException e) { throw new SQLiteException(e.getMessage(), e); } }
  public boolean inTransaction() { return txDepth > 0; }
  public int getVersion() { Cursor r = rawQuery("PRAGMA user_version", null); return r.moveToFirst() ? r.getInt(0) : 0; }
  public void setVersion(int v) { execSQL("PRAGMA user_version = " + v); }
}
