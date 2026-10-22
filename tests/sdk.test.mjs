import { test } from 'node:test';
import assert from 'node:assert/strict';

// 模拟微信浏览器和 WeixinJSBridge；这里不执行微信实际签名/权限验证。
const invoked = [];
const eventHandlers = new Map();
const listeners = new Map();
let reportUrl = '';

class FakeImage {
  set src(url) { reportUrl = url; }
  get src() { return reportUrl; }
}

globalThis.Image = FakeImage;
globalThis.window = {
  document: {
    title: '微信测试页',
    addEventListener(type, handler) { listeners.set(type, handler); },
  },
  location: { href: 'https://test.example.com/?a=1#page' },
  navigator: {
    platform: 'Linux armv8l',
    userAgent: 'Mozilla/5.0 (Linux; Android 13) MicroMessenger/8.0.50',
  },
  __wxjs_environment: 'miniprogram',
  alert() {},
  WeixinJSBridge: {
    invoke(name, params, callback) {
      invoked.push({ name, params });
      queueMicrotask(() => {
        if (name === 'chooseImage') {
          callback?.({ err_msg: 'chooseImage:ok', localIds: '["local-1","local-2"]' });
        } else if (name === 'getNetworkType') {
          callback?.({ err_msg: 'getNetworkType:wifi' });
        } else if (name === 'checkJsApi') {
          callback?.({ err_msg: 'checkJsApi:ok', checkResult: '{"geoLocation":true}' });
        } else if (name === 'getLocalImgData') {
          callback?.({ err_msg: 'getLocalImgData:ok', localData: 'data:image/png;base64,AA' });
        } else {
          callback?.({ err_msg: `${name}:ok` });
        }
      });
    },
    on(name, callback) { eventHandlers.set(name, callback); },
  },
};

// 测试工具：等微任务队列中的桥回调完成。
const flush = async () => {
  await new Promise((resolve) => setImmediate(resolve));
};

const { default: wx, version } = await import('../dist/index.js');

test('提供 1.6.3 双版本字段、ESM 默认与具名导出、浏览器全局', () => {
  assert.equal(version, '1.6.3');
  assert.equal(wx.version, '1.6.3');
  assert.equal(window.wx, wx);
  assert.equal(window.jWeixin, wx);
});

test('config 映射底层 API + 回调 ready 顺序', async () => {
  let readyCalled = 0;
  wx.ready(() => { readyCalled++; });
  wx.config({
    appId: 'wx-abc', timestamp: 123, nonceStr: 'nonce-test', signature: 'signature-test',
    jsApiList: ['getLocation', 'chooseImage', 'chooseWXPay'],
  });
  await flush();
  assert.equal(readyCalled, 1);
  const verify = invoked.find((entry) => entry.name === 'preVerifyJSAPI');
  assert.ok(verify);
  assert.deepEqual(verify.params.verifyJsApiList, ['geoLocation', 'chooseImage', 'getBrandWCPayRequest']);
  assert.equal(verify.params.appId, 'wx-abc');
  assert.equal(verify.params.verifySignature, 'signature-test');
});

test('checkJsApi 在 Android 把 JSON 和桥 API 名恢复为 JS API 名', async () => {
  let checked;
  wx.checkJsApi({
    jsApiList: ['getLocation'],
    success(result) { checked = result.checkResult; },
  });
  await flush();
  assert.deepEqual(checked, { getLocation: true });
});

test('图片本地 ID、语音、支付参数按微信规范映射', async () => {
  let images;
  wx.chooseImage({ success(result) { images = result.localIds; } });
  wx.playVoice({ localId: 'voice-a' });
  wx.chooseWXPay({
    timestamp: 12345, nonceStr: 'test-nonce', package: 'prepay_id=123', paySign: 'signature',
  });
  await flush();
  assert.deepEqual(images, ['local-1', 'local-2']);
  assert.equal(invoked.find((x) => x.name === 'playVoice').params.localId, 'voice-a');
  const pay = invoked.find((x) => x.name === 'getBrandWCPayRequest');
  assert.equal(pay.params.timeStamp, '12345');
  assert.equal(pay.params.signType, 'SHA1');
});

test('旧分享接口注册事件后调用 sendAppMessage', async () => {
  wx.onMenuShareAppMessage({ title: '分享标题', desc: '分享正文', link: 'https://example.com/' });
  const handler = eventHandlers.get('menu:share:appmessage');
  assert.equal(typeof handler, 'function');
  handler({ err_msg: 'menu:share:appmessage:ok' });
  await flush();
  const send = invoked.find((item) => item.name === 'sendAppMessage');
  assert.equal(send.params.title, '分享标题');
  assert.equal(send.params.desc, '分享正文');
});

test('小程序 bridge 调用保持 invokeMiniProgramAPI', async () => {
  wx.miniProgram.navigateTo({ url: '/pages/home/index' });
  let isMiniprogram;
  wx.miniProgram.getEnv((env) => { isMiniprogram = env.miniprogram; });
  await flush();
  assert.equal(isMiniprogram, true);
  assert.deepEqual(invoked.find((item) => item.name === 'invokeMiniProgramAPI').params.arg, {
    url: '/pages/home/index',
  });
});

test('getLocalImgData 保持原版 FIFO 串行请求', async () => {
  const results = [];
  wx.getLocalImgData({ localId: 'a', success: () => results.push('a') });
  wx.getLocalImgData({ localId: 'b', success: () => results.push('b') });
  await flush();
  assert.deepEqual(results, ['a', 'b']);
  assert.equal(invoked.filter((entry) => entry.name === 'getLocalImgData').length, 2);
});

test('统计 URL 不重复编码且能正确解析网络类型', async () => {
  await flush();
  assert.ok(reportUrl.startsWith('https://open.weixin.qq.com/sdk/report?'));
  assert.ok(reportUrl.includes('&n=wifi'));
  assert.ok(reportUrl.includes('&u=https%3A%2F%2Ftest.example.com'));
  assert.ok(!reportUrl.includes('%253A'));
});
