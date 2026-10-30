package android.database;
public interface Cursor extends java.io.Closeable {
  int getCount(); int getPosition(); boolean moveToFirst(); boolean moveToNext(); boolean moveToLast(); boolean moveToPrevious(); boolean moveToPosition(int p); boolean move(int o);
  boolean isFirst(); boolean isLast(); boolean isBeforeFirst(); boolean isAfterLast();
  int getColumnIndex(String n); int getColumnIndexOrThrow(String n); String getColumnName(int i); String[] getColumnNames(); int getColumnCount();
  String getString(int i); int getInt(int i); long getLong(int i); short getShort(int i); float getFloat(int i); double getDouble(int i); byte[] getBlob(int i); boolean isNull(int i); int getType(int i);
  void close(); boolean isClosed();
}
