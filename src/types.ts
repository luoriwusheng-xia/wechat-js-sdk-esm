/**
 * 微信 JS-SDK 1.6.3 TypeScript API 定义（手工重构）。
 * 原始浏览器脚本：https://res.wx.qq.com/open/js/jweixin-1.6.3.js
 * 注意：非腾讯官方维护的类型定义。
 */

export interface WxResult {
  errMsg?: string;
  errCode?: number;
  [key: string]: unknown;
}

/** 传给 JSAPI 的统一回调选项。 */
export interface WxCallbacks<T extends WxResult = WxResult> {
  success?: (result: T) => void;
  cancel?: (result: T) => void;
  fail?: (result: T) => void;
  complete?: (result: T) => void;
  /** 内部使用：跳过 SDK 调试弹窗。 */
  isInnerInvoke?: boolean;
}

/** 微信签名配置：由你自己的后端生成。 */
export interface WxConfig {
  debug?: boolean;
  appId: string;
  timestamp: number | string;
  nonceStr: string;
  signature: string;
  jsApiList: string[];
  openTagList?: string[];
  /** 原源码里的开关：false 则不执行 preVerifyJSAPI。 */
  check?: boolean;
}

export interface WxShareOptions extends WxCallbacks {
  title?: string;
  desc?: string;
  link?: string;
  imgUrl?: string;
  type?: string;
  dataUrl?: string;
}

export interface WxLocalIdOptions extends WxCallbacks {
  localId: string;
}

export interface WxServerIdOptions extends WxCallbacks {
  serverId: string;
}

export interface WxMediaProgressOptions extends WxCallbacks {
  isShowProgressTips?: 0 | 1;
}

export interface WxChooseImageOptions extends WxCallbacks {
  count?: number;
  sizeType?: Array<'original' | 'compressed'>;
  sourceType?: Array<'album' | 'camera'>;
}

export interface WxChooseImageResult extends WxResult {
  localIds?: string[];
}

export interface WxLocationResult extends WxResult {
  latitude?: number;
  longitude?: number;
  speed?: number;
  accuracy?: number;
}

export interface WxScanResult extends WxResult {
  resultStr?: string;
}

export interface WxNetworkResult extends WxResult {
  networkType?: string;
}

export interface WxPaymentOptions extends WxCallbacks {
  timestamp: number | string;
  nonceStr: string;
  package: string;
  paySign: string;
  signType?: string;
}

export interface WxCardInfo {
  cardId: string;
  cardExt?: string;
  code?: string;
  [key: string]: unknown;
}

export interface WxCardResult extends WxResult {
  cardList?: Array<WxCardInfo & { isSuccess?: boolean }> | string;
}

export interface WxChooseCardOptions extends WxCallbacks<WxCardResult> {
  shopId?: string;
  signType?: string;
  cardId?: string;
  cardType?: string;
  cardSign: string;
  timestamp: number | string;
  nonceStr: string;
}

export interface WxMiniProgram {
  navigateBack(options?: { delta?: number } & WxCallbacks): void;
  navigateTo(options: { url: string } & WxCallbacks): void;
  redirectTo(options: { url: string } & WxCallbacks): void;
  switchTab(options: { url: string } & WxCallbacks): void;
  reLaunch(options: { url: string } & WxCallbacks): void;
  postMessage(options: { data: Record<string, unknown> } & WxCallbacks): void;
  getEnv(callback: (result: { miniprogram: boolean }) => void): void;
}

/** 用户给出的压缩包中实现的完整公开方法列表。 */
export interface WxJSApi {
  /** 本包的 SDK API 版本，与 package.json 一致。 */
  readonly version: '1.6.3';
  config(options: WxConfig): void;
  ready(callback: () => void): void;
  error(callback: (error: WxResult) => void): void;
  /** 原生桥透传：执行微信的底层 JSAPI（不等于 wx.config）。 */
  invoke(name: string, params?: Record<string, unknown>, callback?: (result: WxResult) => void): void;
  /** 原生桥事件订阅。 */
  on(name: string, callback: (result: WxResult) => void): void;
  checkJsApi(options: { jsApiList: string[] } & WxCallbacks<WxResult & { checkResult?: Record<string, boolean> }>): void;

  // 分享：新接口与旧菜单接口同时保留
  onMenuShareTimeline(options: WxShareOptions): void;
  onMenuShareAppMessage(options: WxShareOptions): void;
  onMenuShareQQ(options: WxShareOptions): void;
  onMenuShareWeibo(options: WxShareOptions): void;
  onMenuShareQZone(options: WxShareOptions): void;
  updateTimelineShareData(options: WxShareOptions): void;
  updateAppMessageShareData(options: WxShareOptions): void;

  // 录音与语音
  startRecord(options?: WxCallbacks): void;
  stopRecord(options?: WxCallbacks): void;
  onVoiceRecordEnd(options: WxCallbacks): void;
  playVoice(options: WxLocalIdOptions): void;
  pauseVoice(options: WxLocalIdOptions): void;
  stopVoice(options: WxLocalIdOptions): void;
  onVoicePlayEnd(options: WxCallbacks): void;
  uploadVoice(options: WxLocalIdOptions & WxMediaProgressOptions): void;
  downloadVoice(options: WxServerIdOptions & WxMediaProgressOptions): void;
  translateVoice(options: WxLocalIdOptions & WxMediaProgressOptions): void;

  // 图片
  chooseImage(options: WxChooseImageOptions & WxCallbacks<WxChooseImageResult>): void;
  previewImage(options: { current?: string; urls: string[] } & WxCallbacks): void;
  uploadImage(options: WxLocalIdOptions & WxMediaProgressOptions): void;
  downloadImage(options: WxServerIdOptions & WxMediaProgressOptions): void;
  getLocalImgData(options: WxLocalIdOptions & WxCallbacks<WxResult & { localData?: string }>): void;

  // 位置、网络、菜单、扫码
  getLocation(options: { type?: 'wgs84' | 'gcj02' } & WxCallbacks<WxLocationResult>): void;
  openLocation(options: { latitude: number; longitude: number; name?: string; address?: string; scale?: number; infoUrl?: string } & WxCallbacks): void;
  getNetworkType(options: WxCallbacks<WxNetworkResult>): void;
  hideOptionMenu(options?: WxCallbacks): void;
  showOptionMenu(options?: WxCallbacks): void;
  closeWindow(options?: WxCallbacks): void;
  hideMenuItems(options: { menuList: string[] } & WxCallbacks): void;
  showMenuItems(options: { menuList: string[] } & WxCallbacks): void;
  hideAllNonBaseMenuItem(options?: WxCallbacks): void;
  showAllNonBaseMenuItem(options?: WxCallbacks): void;
  scanQRCode(options?: { needResult?: 0 | 1; scanType?: Array<'qrCode' | 'barCode'> } & WxCallbacks<WxScanResult>): void;

  // 地址、商品、卡券
  openAddress(options?: WxCallbacks): void;
  openProductSpecificView(options: { productId: string; viewType?: number; extInfo?: string } & WxCallbacks): void;
  addCard(options: { cardList: WxCardInfo[] } & WxCallbacks<WxCardResult>): void;
  chooseCard(options: WxChooseCardOptions): void;
  openCard(options: { cardList: WxCardInfo[] } & WxCallbacks): void;
  consumeAndShareCard(options: { cardId: string; code: string } & WxCallbacks): void;

  // 支付、企业与蓝牙 Beacon
  chooseWXPay(options: WxPaymentOptions): void;
  openEnterpriseRedPacket(options: WxPaymentOptions): void;
  startSearchBeacons(options: { ticket: string } & WxCallbacks): void;
  stopSearchBeacons(options?: WxCallbacks): void;
  onSearchBeacons(options: WxCallbacks): void;
  openEnterpriseChat(options: { userIds: string; groupName?: string } & WxCallbacks): void;

  // 小程序与业务组件
  launchMiniProgram(options: { targetAppId: string; path?: string; envVersion?: 'develop' | 'trial' | 'release' } & WxCallbacks): void;
  openBusinessView(options: { businessType: string; queryString?: string; envVersion?: string } & WxCallbacks): void;
  miniProgram: WxMiniProgram;

  // 人脸核验：是否可用取决于微信环境及账号权限
  requestFacialVerify(options: { appId: string; verifyId?: string } & WxCallbacks): void;
  requestFacialVerifyAndUploadVideo(options: { appId: string; verifyId?: string } & WxCallbacks): void;
}

