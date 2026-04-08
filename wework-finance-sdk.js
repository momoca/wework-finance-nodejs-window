'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const koffi = require('koffi');

function normalizeUInt64(value, fieldName) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      throw new TypeError(`${fieldName} 必须是非负整数`);
    }
    return BigInt(Math.floor(value));
  }
  if (typeof value === 'string') {
    if (!/^\d+$/.test(value)) {
      throw new TypeError(`${fieldName} 必须是无符号整数数字字符串`);
    }
    return BigInt(value);
  }
  throw new TypeError(`${fieldName} 类型不支持`);
}

function normalizeCString(value) {
  return value == null ? '' : String(value);
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function getDefaultDllPath() {
  if (process.platform === 'win32') {
    return path.join(__dirname, 'WeWorkFinanceSdk.dll');
  }
  if (process.platform === 'darwin') {
    return path.join(__dirname, 'libWeWorkFinanceSdk.dylib');
  }
  return path.join(__dirname, 'libWeWorkFinanceSdk.so');
}

function rsaDecryptChatData(encryptData, privateKeyPem) {
  const decrypted = crypto.privateDecrypt(
    {
      key: privateKeyPem,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    },
    Buffer.from(encryptData, 'base64'),
  );

  return decrypted.toString('utf8').replace(/\0+$/g, '');
}

class WeWorkFinanceSdk {
  constructor(options = {}) {
    this.dllPath = path.resolve(options.dllPath || getDefaultDllPath());
    this.corpid = normalizeCString(options.corpid);
    this.secret = normalizeCString(options.secret);

    if (!fs.existsSync(this.dllPath)) {
      throw new Error(`SDK 动态库不存在: ${this.dllPath}`);
    }
    if (!this.corpid) {
      throw new Error('缺少 corpid');
    }
    if (!this.secret) {
      throw new Error('缺少 secret');
    }

    const Sdk = koffi.opaque('WeWorkFinanceSdk_t');
    const Slice = koffi.opaque('Slice_t');
    const MediaData = koffi.opaque('MediaData_t');

    const lib = koffi.load(this.dllPath);

    this.native = {
      NewSdk: lib.func('WeWorkFinanceSdk_t *NewSdk()'),
      Init: lib.func('int Init(WeWorkFinanceSdk_t *sdk, const char *corpid, const char *secret)'),
      GetChatData: lib.func('int GetChatData(WeWorkFinanceSdk_t *sdk, uint64_t seq, uint32_t limit, const char *proxy, const char *passwd, int timeout, Slice_t *chatDatas)'),
      DecryptData: lib.func('int DecryptData(const char *encrypt_key, const char *encrypt_msg, Slice_t *msg)'),
      GetMediaData: lib.func('int GetMediaData(WeWorkFinanceSdk_t *sdk, const char *indexbuf, const char *sdkFileid, const char *proxy, const char *passwd, int timeout, MediaData_t *media_data)'),
      DestroySdk: lib.func('void DestroySdk(WeWorkFinanceSdk_t *sdk)'),

      NewSlice: lib.func('Slice_t *NewSlice()'),
      FreeSlice: lib.func('void FreeSlice(Slice_t *slice)'),
      GetContentFromSlice: lib.func('const char *GetContentFromSlice(Slice_t *slice)'),
      GetSliceLen: lib.func('int GetSliceLen(Slice_t *slice)'),

      NewMediaData: lib.func('MediaData_t *NewMediaData()'),
      FreeMediaData: lib.func('void FreeMediaData(MediaData_t *media_data)'),
      GetOutIndexBuf: lib.func('const char *GetOutIndexBuf(MediaData_t *media_data)'),
      GetData: lib.func('void *GetData(MediaData_t *media_data)'),
      GetIndexLen: lib.func('int GetIndexLen(MediaData_t *media_data)'),
      GetDataLen: lib.func('int GetDataLen(MediaData_t *media_data)'),
      IsMediaDataFinish: lib.func('int IsMediaDataFinish(MediaData_t *media_data)'),

      __lib: lib,
      __types: { Sdk, Slice, MediaData },
    };

    this.sdk = this.native.NewSdk();
    if (!this.sdk) {
      throw new Error('NewSdk 失败');
    }

    const ret = this.native.Init(this.sdk, this.corpid, this.secret);
    if (ret !== 0) {
      this.close();
      throw new Error(`Init 失败，ret=${ret}`);
    }
  }

  close() {
    if (this.sdk) {
      this.native.DestroySdk(this.sdk);
      this.sdk = null;
    }
  }

  getChatData({ seq = 0, limit = 100, proxy = '', passwd = '', timeout = 5 } = {}) {
    const slice = this.native.NewSlice();
    if (!slice) {
      throw new Error('NewSlice 失败');
    }

    try {
      const ret = this.native.GetChatData(
        this.sdk,
        normalizeUInt64(seq, 'seq'),
        Number(limit),
        normalizeCString(proxy),
        normalizeCString(passwd),
        Number(timeout),
        slice,
      );

      if (ret !== 0) {
        throw new Error(`GetChatData 失败，ret=${ret}`);
      }

      const content = this.native.GetContentFromSlice(slice) || '';
      const len = this.native.GetSliceLen(slice);

      return {
        ret,
        len,
        raw: content,
        json: safeJsonParse(content),
      };
    } finally {
      this.native.FreeSlice(slice);
    }
  }

  decryptData(encryptKey, encryptMsg) {
    const slice = this.native.NewSlice();
    if (!slice) {
      throw new Error('NewSlice 失败');
    }

    try {
      const ret = this.native.DecryptData(
        normalizeCString(encryptKey),
        normalizeCString(encryptMsg),
        slice,
      );

      const content = this.native.GetContentFromSlice(slice) || '';

      return {
        ret,
        raw: content,
        json: safeJsonParse(content),
      };
    } finally {
      this.native.FreeSlice(slice);
    }
  }

  decryptChatDataByPrivateKey(encryptRandomKey, encryptChatMsg, privateKeyPem) {
    const encryptKey = rsaDecryptChatData(encryptRandomKey, privateKeyPem);
    const result = this.decryptData(encryptKey, encryptChatMsg);
    return {
      encryptKey,
      ...result,
    };
  }

  getMediaData({ sdkFileid, saveFile, proxy = '', passwd = '', timeout = 5 } = {}) {
    if (!sdkFileid) {
      throw new Error('缺少 sdkFileid');
    }
    if (!saveFile) {
      throw new Error('缺少 saveFile');
    }

    const resolvedFile = path.resolve(saveFile);
    fs.mkdirSync(path.dirname(resolvedFile), { recursive: true });
    if (fs.existsSync(resolvedFile)) {
      fs.unlinkSync(resolvedFile);
    }

    let index = '';
    let total = 0;
    const chunks = [];

    while (true) {
      const media = this.native.NewMediaData();
      if (!media) {
        throw new Error('NewMediaData 失败');
      }

      try {
        const ret = this.native.GetMediaData(
          this.sdk,
          normalizeCString(index),
          normalizeCString(sdkFileid),
          normalizeCString(proxy),
          normalizeCString(passwd),
          Number(timeout),
          media,
        );

        if (ret !== 0) {
          throw new Error(`GetMediaData 失败，ret=${ret}`);
        }

        const dataLen = this.native.GetDataLen(media);
        const isFinish = this.native.IsMediaDataFinish(media) === 1;
        const outIndex = this.native.GetOutIndexBuf(media) || '';
        const dataPtr = this.native.GetData(media);

        let buf = Buffer.alloc(0);
        if (dataLen > 0 && dataPtr) {
          const view = koffi.view(dataPtr, dataLen);
          buf = Buffer.from(view);
          fs.appendFileSync(resolvedFile, buf);
          total += buf.length;
        }

        chunks.push({
          index,
          outIndex,
          dataLen,
          isFinish,
        });

        if (isFinish) {
          return {
            ret,
            total,
            saveFile: resolvedFile,
            chunks,
          };
        }

        index = outIndex;
      } finally {
        this.native.FreeMediaData(media);
      }
    }
  }
}

module.exports = {
  WeWorkFinanceSdk,
  rsaDecryptChatData,
};
