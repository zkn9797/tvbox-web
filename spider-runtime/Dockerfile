# TVBox Web spider-runtime: runs Android csp_ jar spiders on OpenJ9 (low RSS). Multi-arch (amd64/arm64).
# build/spider-runtime.jar + lib/*.jar are architecture-independent bytecode (rebuild with ./build.sh).
ARG REG=
FROM ${REG}ibm-semeru-runtimes:open-17-jre
RUN useradd -r -u 1000 -m spider 2>/dev/null || true; mkdir -p /data && chown 1000 /data \
 && mkdir -p /app/android-libs && for d in /lib/aarch64-linux-gnu /lib/x86_64-linux-gnu /usr/lib/aarch64-linux-gnu /usr/lib/x86_64-linux-gnu; do \
      [ -e $d/libc.so.6 ] || continue; cd /app/android-libs; ln -sf $d/libc.so.6 libc.so; ln -sf $d/libm.so.6 libm.so; ln -sf $d/libdl.so.2 libdl.so; \
      for l in liblog libandroid libz libstdc++ libc++_shared libjnigraphics libOpenSLES libEGL libGLESv2; do [ -e $l.so ] || ln -sf $d/libdl.so.2 $l.so; done; \
      [ -e $d/libz.so.1 ] && ln -sf $d/libz.so.1 libz.so; break; done
COPY android-shim /tmp/android-shim
RUN a=$(uname -m); [ -f /tmp/android-shim/$a/liblog.so ] && rm -f /app/android-libs/liblog.so && cp /tmp/android-shim/$a/liblog.so /app/android-libs/liblog.so; rm -rf /tmp/android-shim; ls -la /app/android-libs
WORKDIR /app
COPY lib ./lib
COPY build/spider-runtime.jar ./spider-runtime.jar
# bionic-name stubs so Android NDK .so files from spider jars can dlopen on glibc (see Native.java)
ENV LD_LIBRARY_PATH=/app/android-libs DATA_DIR=/data PORT=9978 IDLE_UNLOAD_MIN=10 CALL_TIMEOUT_S=25 \
    JAVA_OPTS="-Xmx320m -Xdump:none -Xdump:exit:events=systhrow,filter=java/lang/OutOfMemoryError -Xms16m -Xss320k -Xtune:virtualized -XX:+IdleTuningGcOnIdle -XX:+IdleTuningCompactOnIdle -XX:IdleTuningMinIdleWaitTime=60 -Xshareclasses:name=tvbox,cacheDir=/data/scc,nonfatal -Xscmx40m -Dfile.encoding=UTF-8"
USER 1000
EXPOSE 9978
VOLUME ["/data"]
CMD ["sh", "-c", "exec java $JAVA_OPTS -cp /app/spider-runtime.jar:/app/lib/* tvbox.runtime.Main"]
