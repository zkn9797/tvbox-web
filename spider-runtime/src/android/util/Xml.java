package android.util;
public final class Xml {
  public static org.xmlpull.v1.XmlPullParser newPullParser() { return new org.kxml2.io.KXmlParser(); }
  public static org.xmlpull.v1.XmlSerializer newSerializer() { return new org.kxml2.io.KXmlSerializer(); }
}
