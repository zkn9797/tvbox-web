package android.content.pm;
public final class SigningInfo { final Signature[] s; public SigningInfo(Signature[] s) { this.s = s; } public Signature[] getApkContentsSigners() { return s; } public Signature[] getSigningCertificateHistory() { return s; } public boolean hasMultipleSigners() { return false; } public boolean hasPastSigningCertificates() { return false; } }
