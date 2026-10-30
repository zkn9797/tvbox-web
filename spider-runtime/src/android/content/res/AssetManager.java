package android.content.res;
public class AssetManager { public java.io.InputStream open(String n) throws java.io.IOException { java.io.InputStream in = Thread.currentThread().getContextClassLoader().getResourceAsStream("assets/" + n); if (in == null) throw new java.io.FileNotFoundException(n); return in; }
  public String[] list(String p) { return new String[0]; } }