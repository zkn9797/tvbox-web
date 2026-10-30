package android.database.sqlite;
public abstract class SQLiteOpenHelper {
  final android.content.Context ctx; final String name; final int version; SQLiteDatabase db;
  public SQLiteOpenHelper(android.content.Context c, String name, SQLiteDatabase.CursorFactory f, int version) { this.ctx = c; this.name = name; this.version = version; }
  public abstract void onCreate(SQLiteDatabase db); public abstract void onUpgrade(SQLiteDatabase db, int o, int n); public void onOpen(SQLiteDatabase db) {} public void onConfigure(SQLiteDatabase db) {} public void onDowngrade(SQLiteDatabase db, int o, int n) {}
  public String getDatabaseName() { return name; }
  public synchronized SQLiteDatabase getWritableDatabase() {
    if (db != null && db.isOpen()) return db;
    db = name == null ? SQLiteDatabase.create(null) : SQLiteDatabase.openOrCreateDatabase(ctx.getDatabasePath(name), null); onConfigure(db);
    int v = db.getVersion(); if (v != version) { db.beginTransaction(); try { if (v == 0) onCreate(db); else if (v < version) onUpgrade(db, v, version); else onDowngrade(db, v, version); db.setVersion(version); db.setTransactionSuccessful(); } finally { db.endTransaction(); } }
    onOpen(db); return db;
  }
  public SQLiteDatabase getReadableDatabase() { return getWritableDatabase(); }
  public synchronized void close() { if (db != null) db.close(); db = null; }
}
