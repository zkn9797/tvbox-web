#!/bin/sh
# Rebuild build/spider-runtime.jar with any JDK 11+ (javac on PATH or JAVA_HOME set).
set -e
cd "$(dirname "$0")"
JAVAC=${JAVA_HOME:+$JAVA_HOME/bin/}javac; JAR=${JAVA_HOME:+$JAVA_HOME/bin/}jar
rm -rf build && mkdir -p build/classes
$JAVAC --release 11 -nowarn -encoding UTF-8 -cp "lib/*" -d build/classes $(find src -name '*.java')
$JAR cfe build/spider-runtime.jar tvbox.runtime.Main -C build/classes .
echo "built build/spider-runtime.jar"
