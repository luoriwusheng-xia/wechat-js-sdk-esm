/**
 * 微信 JS-SDK 1.6.3 —— TypeScript + 纯 ESM 包入口。
 * 微信原始脚本：https://res.wx.qq.com/open/js/jweixin-1.6.3.js
 * 本包为第三方源码重构，不是官方维护的包。
 */
export { wx, version } from './sdk.js';
export { wx as default } from './sdk.js';
export type {
  WxJSApi, WxConfig, WxResult, WxCallbacks, WxShareOptions,
  WxLocalIdOptions, WxServerIdOptions, WxMediaProgressOptions,
  WxChooseImageOptions, WxChooseImageResult, WxLocationResult,
  WxScanResult, WxNetworkResult, WxPaymentOptions,
  WxCardInfo, WxCardResult, WxChooseCardOptions, WxMiniProgram,
} from './types.js';
