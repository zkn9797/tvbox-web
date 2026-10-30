package android.database.sqlite;
public class SQLiteException extends RuntimeException { public SQLiteException(String m) { super(m); } public SQLiteException(String m, Throwable t) { super(m, t); } }
