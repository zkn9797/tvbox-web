package tvbox.runtime;
import android.database.sqlite.SQLiteDatabase;
/** Mimics the FongMi TV host database ("tv", Room) that some spiders read, e.g. the current config URL. */
public final class HostDb {
  static volatile String lastUrl;
  public static synchronized void setConfig(String url) {
    if (url == null || url.isEmpty() || url.equals(lastUrl)) return;
    try {
      SQLiteDatabase db = SQLiteDatabase.openOrCreateDatabase(Main.ctx().getDatabasePath("tv"), null);
      try {
        db.execSQL("CREATE TABLE IF NOT EXISTS Config (id INTEGER PRIMARY KEY AUTOINCREMENT, type INTEGER NOT NULL DEFAULT 0, time INTEGER NOT NULL DEFAULT 0, url TEXT, json TEXT, name TEXT, logo TEXT, home TEXT, parse TEXT)");
        db.execSQL("CREATE TABLE IF NOT EXISTS Site (\"key\" TEXT PRIMARY KEY, name TEXT, searchable INTEGER, changeable INTEGER)");
        db.execSQL("CREATE TABLE IF NOT EXISTS Keep (\"key\" TEXT PRIMARY KEY, siteName TEXT, vodName TEXT, vodPic TEXT, createTime INTEGER, type INTEGER, cid INTEGER)");
        db.execSQL("DELETE FROM Config WHERE type = 0 AND url = ?", new Object[]{ url });
        db.execSQL("INSERT INTO Config (type, time, url, name) VALUES (0, ?, ?, ?)", new Object[]{ System.currentTimeMillis(), url, url });
      } finally { db.close(); }
      lastUrl = url;
    } catch (Throwable t) { System.err.println("[hostdb] " + t); }
  }
}
