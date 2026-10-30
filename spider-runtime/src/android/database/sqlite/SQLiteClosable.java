package android.database.sqlite;
public abstract class SQLiteClosable implements java.io.Closeable { public void close() { onAllReferencesReleased(); } protected abstract void onAllReferencesReleased(); public void acquireReference() {} public void releaseReference() {} }
