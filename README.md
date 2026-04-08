# 企业微信会话存档 SDK - Node.js Window 版示例

这是一个基于 `koffi` 的 Node.js 封装版本，用来直接调用 `WeWorkFinanceSdk.dll`。

## 为什么改成 Koffi

原先版本使用 `ffi-napi`，在 Windows + Node 22 环境里很容易因为 `node-gyp` / Python / 编译链而安装失败。

这个版本改成：

```bash
npm install koffi
```

通常不需要你本地再去编译 `ffi-napi`。

## 文件放置

建议目录：

```txt
wework-finance-nodejs-window/
  WeWorkFinanceSdk.dll
  libcrypto-3-x64.dll
  libssl-3-x64.dll
  libcurl-x64.dll
  private_key.pem
  wework-finance-sdk.js
  example.js
  package.json
```

## 安装

```bash
npm install
```

## 运行

先改 `example.js` 里的：

- `corpid`
- `secret`
- `private_key.pem`

然后执行：

```bash
npm start
```

## 功能

- `getChatData()` 拉取会话存档
- `decryptChatDataByPrivateKey()` 先 RSA 解密随机密钥，再解密消息体
- `getMediaData()` 分片下载媒体文件

## 注意

1. `seq` 建议保存为字符串或 bigint。
2. 媒体文件是分片拉取，封装里已经自动循环下载。
3. 你的 `private_key.pem` 必须和企业微信管理台配置的公钥对应。
