package com.github.catvod.crawler;
import android.content.Context; import java.util.*;
/** Host-side CatVod Spider API (TVBox / FongMi compatible superset). */
public abstract class Spider {
  public String siteKey;
  public void init(Context context) throws Exception {}
  public void init(Context context, String extend) throws Exception { init(context); }
  public String homeContent(boolean filter) throws Exception { return ""; }
  public String homeVideoContent() throws Exception { return ""; }
  public String categoryContent(String tid, String pg, boolean filter, HashMap<String, String> extend) throws Exception { return ""; }
  public String detailContent(List<String> ids) throws Exception { return ""; }
  public String searchContent(String key, boolean quick) throws Exception { return ""; }
  public String searchContent(String key, boolean quick, String pg) throws Exception { return searchContent(key, quick); }
  public String playerContent(String flag, String id, List<String> vipFlags) throws Exception { return ""; }
  public String liveContent(String url) throws Exception { return ""; }
  public boolean isVideoFormat(String url) throws Exception { return false; }
  public boolean manualVideoCheck() throws Exception { return false; }
  public Object[] proxyLocal(Map<String, String> params) throws Exception { return null; }
  public Object[] proxy(Map<String, String> params) throws Exception { return proxyLocal(params); }
  public String action(String action) throws Exception { return ""; }
  public void destroy() {}
  public static okhttp3.Dns safeDns() { return okhttp3.Dns.SYSTEM; }
  public okhttp3.OkHttpClient client() { return tvbox.runtime.Net.client(); }
}