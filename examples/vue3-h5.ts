/**
 * Vue 3 / Vite H5 使用示例（在微信浏览器内实际运行）。
 * 假定：后端返回适用于当前网页 URL 的微信 JS-SDK 签名配置。
 */
import wx, { version, type WxConfig } from 'wechat-js-sdk-esm';

export async function initWechatSdk(): Promise<void> {
  // 在 Vue SPA 首次加载时应保存签名 URL；签名 URL 必须去除哈希部分。
  const signedUrl = location.href.split('#')[0];
  const response = await fetch(`/api/wechat/jssdk-sign?url=${encodeURIComponent(signedUrl)}`);
  if (!response.ok) throw new Error(`JSSDK 签名接口错误 ${response.status}`);

  const signature = await response.json() as Omit<WxConfig, 'jsApiList'>;
  console.info('微信 JS-SDK 封装版本:', version); // 1.6.3

  wx.config({
    ...signature,
    debug: false,
    jsApiList: [
      'updateAppMessageShareData',
      'updateTimelineShareData',
      'scanQRCode',
      'chooseImage',
    ],
  });

  wx.ready(() => {
    wx.updateAppMessageShareData({
      title: '示例标题',
      desc: '示例描述',
      link: signedUrl,
      imgUrl: 'https://example.com/share.png',
    });
  });

  wx.error((error) => {
    console.error('微信 JS-SDK 签名失败:', error);
  });
}
