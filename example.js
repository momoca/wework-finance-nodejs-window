'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { WeWorkFinanceSdk } = require('./wework-finance-sdk');

async function main() {
  const sdk = new WeWorkFinanceSdk({
    dllPath: path.join(__dirname, 'WeWorkFinanceSdk.dll'),
    corpid: '你的企业corpid',
    secret: '你的会话存档secret',
  });

  try {
    const chat = sdk.getChatData({
      seq: 0,
      limit: 100,
      proxy: '',
      passwd: '',
      timeout: 5,
    });

    console.log('GetChatData 原始返回:');
    console.log(chat.raw);

    const first = chat.json?.chatdata?.[0];
    if (!first) {
      console.log('没有拉到消息');
      return;
    }

    const privateKeyPem = fs.readFileSync(path.join(__dirname, 'private_key.pem'), 'utf8');

    const decrypted = sdk.decryptChatDataByPrivateKey(
      first.encrypt_random_key,
      first.encrypt_chat_msg,
      privateKeyPem,
    );

    console.log('解密后的消息:');
    console.log(decrypted.raw);

    const sdkFileid =
      decrypted.json?.image?.sdkfileid ||
      decrypted.json?.voice?.sdkfileid ||
      decrypted.json?.video?.sdkfileid ||
      decrypted.json?.file?.sdkfileid ||
      decrypted.json?.mixed?.sdkfileid;

    if (sdkFileid) {
      const media = sdk.getMediaData({
        sdkFileid,
        saveFile: path.join(__dirname, 'downloads', sdkFileid),
        proxy: '',
        passwd: '',
        timeout: 5,
      });
      console.log('媒体下载完成:', media);
    }
  } finally {
    sdk.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
