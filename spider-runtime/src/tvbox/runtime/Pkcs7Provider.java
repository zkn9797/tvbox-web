package tvbox.runtime;
import javax.crypto.*; import java.security.*; import java.security.spec.AlgorithmParameterSpec;
/** Android accepts "PKCS7Padding" (BouncyCastle); the JVM only knows PKCS5Padding (identical for 8/16-byte blocks). */
public final class Pkcs7Provider extends Provider {
  public Pkcs7Provider() {
    super("TVBoxPkcs7", "1.0", "PKCS7Padding alias for AES/DES/DESede");
    // register ONLY the PKCS7 transformations so every other cipher stays on the JDK providers
    String[][] t = {{"AES", "CBC", AesCbc.class.getName()}, {"AES", "ECB", AesEcb.class.getName()}, {"AES", "CFB", AesCfb.class.getName()}, {"AES", "OFB", AesOfb.class.getName()},
      {"DES", "CBC", DesCbc.class.getName()}, {"DES", "ECB", DesEcb.class.getName()}, {"DESede", "CBC", DesedeCbc.class.getName()}, {"DESede", "ECB", DesedeEcb.class.getName()}};
    for (String[] x : t) { put("Cipher." + x[0] + "/" + x[1] + "/PKCS7Padding", x[2]); put("Cipher." + x[0] + "/" + x[1] + "/PKCS7", x[2]); }
    put("Cipher.AES//PKCS7Padding", AesEcb.class.getName());
    // Android: Cipher.getInstance("RSA") is RSA/ECB/NoPadding (the JDK defaults to PKCS1Padding); explicit paddings pass through
    put("Cipher.RSA", Rsa.class.getName());
  }
  public static class AesCbc extends Wrap { public AesCbc() { super("AES", "CBC"); } } public static class AesEcb extends Wrap { public AesEcb() { super("AES", "ECB"); } }
  public static class AesCfb extends Wrap { public AesCfb() { super("AES", "CFB"); } } public static class AesOfb extends Wrap { public AesOfb() { super("AES", "OFB"); } }
  public static class DesCbc extends Wrap { public DesCbc() { super("DES", "CBC"); } } public static class DesEcb extends Wrap { public DesEcb() { super("DES", "ECB"); } }
  public static class DesedeCbc extends Wrap { public DesedeCbc() { super("DESede", "CBC"); } } public static class DesedeEcb extends Wrap { public DesedeEcb() { super("DESede", "ECB"); } }
  public static class Rsa extends Wrap { public Rsa() { super("RSA", "ECB"); pad = "NoPadding"; }
    @Override protected void engineSetPadding(String p) { pad = p.equalsIgnoreCase("NONE") ? "NoPadding" : p; }
    @Override protected int engineGetBlockSize() { return 0; }
    @Override protected int engineGetKeySize(Key k) { return k instanceof java.security.interfaces.RSAKey ? ((java.security.interfaces.RSAKey) k).getModulus().bitLength() : 0; }
    @Override protected void engineSetMode(String m) { mode = m.equalsIgnoreCase("NONE") ? "ECB" : m; } }
  public abstract static class Wrap extends CipherSpi {
    final String alg; String mode = "ECB", pad = "PKCS5Padding"; Cipher c;
    Wrap(String a, String m) { alg = a; mode = m; }
    protected int engineGetKeySize(Key k) { return k.getEncoded().length * 8; }
    protected void engineSetMode(String m) { mode = m; }
    protected void engineSetPadding(String p) { pad = p.equalsIgnoreCase("PKCS7Padding") || p.equalsIgnoreCase("PKCS7") ? "PKCS5Padding" : p; }
    Cipher c() throws GeneralSecurityException { if (c == null) c = Cipher.getInstance(alg + "/" + mode + "/" + pad, "SunJCE"); return c; }
    protected int engineGetBlockSize() { return alg.equals("AES") ? 16 : 8; }
    protected int engineGetOutputSize(int n) { try { return c().getOutputSize(n); } catch (Exception e) { return n + 32; } }
    protected byte[] engineGetIV() { return c == null ? null : c.getIV(); }
    protected AlgorithmParameters engineGetParameters() { return c == null ? null : c.getParameters(); }
    protected void engineInit(int op, Key k, SecureRandom r) throws InvalidKeyException { try { c().init(op, k, r); } catch (InvalidKeyException e) { throw e; } catch (GeneralSecurityException e) { throw new InvalidKeyException(e); } }
    protected void engineInit(int op, Key k, AlgorithmParameterSpec p, SecureRandom r) throws InvalidKeyException, InvalidAlgorithmParameterException { try { c().init(op, k, p, r); } catch (InvalidKeyException | InvalidAlgorithmParameterException e) { throw e; } catch (GeneralSecurityException e) { throw new InvalidKeyException(e); } }
    protected void engineInit(int op, Key k, AlgorithmParameters p, SecureRandom r) throws InvalidKeyException, InvalidAlgorithmParameterException { try { c().init(op, k, p, r); } catch (InvalidKeyException | InvalidAlgorithmParameterException e) { throw e; } catch (GeneralSecurityException e) { throw new InvalidKeyException(e); } }
    protected byte[] engineUpdate(byte[] in, int o, int l) { return c.update(in, o, l); }
    protected int engineUpdate(byte[] in, int o, int l, byte[] out, int oo) throws ShortBufferException { return c.update(in, o, l, out, oo); }
    protected byte[] engineDoFinal(byte[] in, int o, int l) throws IllegalBlockSizeException, BadPaddingException { return c.doFinal(in, o, l); }
    protected int engineDoFinal(byte[] in, int o, int l, byte[] out, int oo) throws ShortBufferException, IllegalBlockSizeException, BadPaddingException { return c.doFinal(in, o, l, out, oo); }
  }
}
