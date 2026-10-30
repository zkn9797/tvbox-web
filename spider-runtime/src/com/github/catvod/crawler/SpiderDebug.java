package com.github.catvod.crawler;
public class SpiderDebug { static final boolean ON = System.getenv("SPIDER_DEBUG") != null;
  public static void log(Throwable t) { if (ON && t != null) t.printStackTrace(); } public static void log(String m) { if (ON) System.err.println("[spider] " + m); } }