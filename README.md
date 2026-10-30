# TVBox Web

在浏览器里播放 TVBox 配置源（饭太硬、肥猫、高天流云等，含安卓 jar `csp_` 爬虫、drpy/catvod JS 源），部署在软路由上。支持 arm64（如 N1/iStoreOS）和 x86_64。

一个容器包含三部分：

- 网页和管理后台（端口 8686）
- Jar 爬虫运行时（OpenJ9，运行安卓 csp_ 爬虫）
- 无头 Chromium 嗅探器（普通嗅探失败时才启用，空闲 2 分钟自动关闭）

## 安装

```sh
git clone https://github.com/zkn9797/tvbox-web.git && cd tvbox-web
# 国内网络加上镜像参数
docker build --build-arg REG=docker.1ms.run/library/ \
  --build-arg APT_MIRROR=mirrors.aliyun.com \
  --build-arg NPM_REGISTRY=https://registry.npmmirror.com -t tvbox-web .
docker run -d --name tvbox-web --restart unless-stopped \
  -p 8686:8686 --memory 896m --shm-size 128m \
  -v /opt/docker-data/tvbox-web:/data tvbox-web:latest
docker logs tvbox-web   # 首次启动会打印 admin 初始密码
```

或者 `docker compose up -d --build`。

打开 `http://路由器IP:8686`，后台在 `/admin`。

## 可选项

| 方式 | 作用 |
| --- | --- |
| `-e ENABLE_SNIFFER=0` | 关闭无头浏览器，省内存 |
| `-e ENABLE_SPIDER=0` | 关闭 jar 爬虫 |
| `--build-arg WITH_BROWSER=0` | 构建不含浏览器的精简镜像 |
| `-e UPSTREAM_PROXY=http://IP:7890` | 上游代理（默认直连，也可在后台设置） |
| `-e ADMIN_PATH=xxx` | 自定义后台路径 |
| `Dockerfile.lite` | 只有网页、不含爬虫和浏览器的 Alpine 镜像 |

## 已知限制

- 需要扫码登录的网盘类站点暂不支持
- Python（Chaquopy）爬虫不支持
- Go 编译的安卓原生库（如 goproxy）不支持
