package android.content.pm;
public class PackageInfo { public String packageName, versionName; public int versionCode; public long firstInstallTime, lastUpdateTime, longVersionCode;
  public ApplicationInfo applicationInfo = new ApplicationInfo(); public String[] requestedPermissions = new String[0];
  public Signature[] signatures = { new Signature("308201dd30820146020101300d06092a864886f70d010105050030373116301406035504030c0d416e64726f69642044656275673110300e060355040a0c07416e64726f6964310b3009060355040613025553") };
  public SigningInfo signingInfo = new SigningInfo(signatures);
  public long getLongVersionCode() { return versionCode; } }
