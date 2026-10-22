/**
 * 微信 JS-SDK 浏览器脚本的 TypeScript + ESM 版本。
 *
 * 官方原版脚本（1.6.3）：https://res.wx.qq.com/open/js/jweixin-1.6.3.js
 * 转换依据：用户提供的压缩版源代码。此项目属于非官方源码重构，非腾讯官方 npm 包。
 *
 * 兼容原则：尽量沿用原版 WeixinJSBridge 名称、入参、回调和微信浏览器行为。
 * 注意：签名只应由后端计算；SDK 的桥方法需要在微信内置浏览器运行。
 */
import type {
  WxJSApi, WxConfig, WxCallbacks, WxResult, WxLocalIdOptions, WxPaymentOptions,
} from './types.js';

/** 源码对应的微信 JS-SDK 版本号；本字段由本包新增，非微信原版提供。 */
export const version = '1.6.3' as const;

// ============== 2. 桥与内部状态 ==============

interface WeixinJSBridge {
  invoke(name: string, params: Record<string, unknown>, callback?: (response: BridgeResponse) => void): void;
  on(name: string, callback: (response: BridgeResponse) => void): void;
}

interface WechatWindow extends Window {
  WeixinJSBridge?: WeixinJSBridge;
  __wxjs_environment?: string;
  wx?: WxJSApi;
  jWeixin?: WxJSApi;
}

/** 微信 JSBridge 的动态返回字段较多，内部仅此处宽松接收。 */
type BridgeResponse = WxResult & Record<string, any>;
type InternalCallbackOptions = WxCallbacks & {
  _complete?: (result: BridgeResponse) => void;
  trigger?: (result: BridgeResponse) => void;
};

const globalWindow = window as WechatWindow;
const documentRef = globalWindow.document;
const defaultTitle = documentRef.title;
const ua = globalWindow.navigator.userAgent.toLowerCase();
const platform = globalWindow.navigator.platform.toLowerCase();
const isDesktop = /mac|win/.test(platform);
const isDebugger = ua.includes('wxdebugger');
const isWeChat = ua.includes('micromessenger');
const isAndroid = ua.includes('android');
const isIOS = ua.includes('iphone') || ua.includes('ipad');
const isSaaASdk = ua.includes('saaasdk');
const clientVersion = ua.match(/micromessenger\/(\d+\.\d+\.\d+)/)?.[1]
  ?? ua.match(/micromessenger\/(\d+\.\d+)/)?.[1] ?? '';

/** wx 方法名 -> 桥 API 名；未列出的方法直接使用同名桥方法。 */
const jsApiMap: Record<string, string> = {
  config: 'preVerifyJSAPI',
  onMenuShareTimeline: 'menu:share:timeline',
  onMenuShareAppMessage: 'menu:share:appmessage',
  onMenuShareQQ: 'menu:share:qq',
  onMenuShareWeibo: 'menu:share:weiboApp',
  onMenuShareQZone: 'menu:share:QZone',
  previewImage: 'imagePreview',
  getLocation: 'geoLocation',
  openProductSpecificView: 'openProductViewWithPid',
  addCard: 'batchAddCard',
  openCard: 'batchViewCard',
  chooseWXPay: 'getBrandWCPayRequest',
  openEnterpriseRedPacket: 'getRecevieBizHongBaoRequest',
  startSearchBeacons: 'startMonitoringBeacons',
  stopSearchBeacons: 'stopMonitoringBeacons',
  onSearchBeacons: 'onBeaconsInRange',
  consumeAndShareCard: 'consumedShareCard',
  openAddress: 'editAddress',
};
const reverseApiMap = Object.fromEntries(Object.entries(jsApiMap).map(([key, val]) => [val, key]));

let currentConfig: Partial<WxConfig> = {};
let verifyStatus: -1 | 0 | 1 = 0;
let verifyResult: WxResult = {};
let configErrorHandler: ((error: WxResult) => void) | undefined;
let readyCallbacks: Array<() => void> = [];
let isGettingLocalImage = false;
const pendingLocalImages: Array<WxLocalIdOptions & WxCallbacks<WxResult & { localData?: string }>> = [];

const startInitTime = Date.now();
let endInitTime = 0;
let startVerifyTime = 0;
let endVerifyTime = 0;
let preVerifyOk = 1;
let resourceIdSeed = 1;
const resourceLoading = new Map<number, boolean>();

function onBridgeReady(callback: () => void): void {
  // 原 SDK 仅在微信浏览器或 SaaA SDK UA 中注册桥初始化事件。
  if (!isWeChat && !isSaaASdk) return;
  if (globalWindow.WeixinJSBridge) callback();
  else documentRef.addEventListener('WeixinJSBridgeReady', callback, false);
}

// 原版 SDK 在装载时就注册桥初始化时间记录，而不是等到 wx.config() 时。
onBridgeReady(() => { endInitTime = Date.now(); });

/** 转换清单中 wx API 名到 JSBridge 实际 API 名（复制，避免修改调用方数组）。 */
function mapApiList(items?: string[]): string[] | undefined {
  return items?.map((name) => jsApiMap[name] ?? name);
}

function bridgeParams(params: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...params,
    appId: currentConfig.appId,
    verifyAppId: currentConfig.appId,
    verifySignType: 'sha1',
    verifyTimestamp: String(currentConfig.timestamp),
    verifyNonceStr: currentConfig.nonceStr,
    verifySignature: currentConfig.signature,
  };
}

/** 将微信桥的 err_msg / errMsg 归一化成「SDK 方法名:结果」。 */
function normalizeErrMsg(apiName: string, original: string | undefined): string {
  const normalizedApi = reverseApiMap[apiName] ?? apiName;
  // 原版在缺少 err_msg 时默认视为 ok，不要误转成 fail。
  let status = original ? original.slice(original.indexOf(':') + 1) : 'ok';
  if (status === 'confirm') status = 'ok';
  else if (status === 'failed') status = 'fail';
  if (status.startsWith('failed_')) status = status.slice(7);
  if (status.startsWith('fail_')) status = status.slice(5);
  status = status.replace(/_/g, ' ').toLowerCase();
  if (status === 'access denied' || status === 'no permission to execute') status = 'permission denied';
  if (normalizedApi === 'config' && status === 'function not exist') status = 'ok';
  if (!status) status = 'fail';
  return `${normalizedApi}:${status}`;
}

function processResponse(apiName: string, result: BridgeResponse, options: InternalCallbackOptions = {}): void {
  // 企业相关桥 API 的 err_code 需要转换成 errCode。
  if (apiName === 'openEnterpriseChat' || apiName === 'openBusinessView') result.errCode = result.err_code;
  delete result.err_code;
  delete result.err_desc;
  delete result.err_detail;

  if (!result.errMsg) {
    result.errMsg = normalizeErrMsg(apiName, result.err_msg as string | undefined);
    delete result.err_msg;
  }
  // 内部数据整理，必须在公开 success / fail / complete 回调之前执行。
  options._complete?.(result);

  if (currentConfig.debug && !options.isInnerInvoke) globalWindow.alert(JSON.stringify(result));
  const status = (result.errMsg ?? '').split(':').slice(1).join(':');
  if (status === 'ok') options.success?.(result);
  else if (status === 'cancel') options.cancel?.(result);
  else options.fail?.(result);
  options.complete?.(result);
}

function debugLog(name: string, options?: InternalCallbackOptions): void {
  if (!currentConfig.debug || options?.isInnerInvoke) return;
  // 与原版一致：没有 JSBridge 时 debug 打印，但不自动调用 fail。
  console.log(`"${reverseApiMap[name] ?? name}",`, options ?? '');
}

function invokeBridge(name: string, params: Record<string, unknown>, options: InternalCallbackOptions = {}): void {
  const bridge = globalWindow.WeixinJSBridge;
  if (!bridge) {
    debugLog(name, options);
    return;
  }
  bridge.invoke(name, bridgeParams(params), (response) => processResponse(name, response, options));
}

/** 注册微信菜单/桥事件，保留原版本的 trigger -> 回调链。 */
function onBridge(name: string, options: InternalCallbackOptions, extra?: InternalCallbackOptions): void {
  const bridge = globalWindow.WeixinJSBridge;
  if (!bridge) {
    debugLog(name, extra ?? options);
    return;
  }
  bridge.on(name, (response) => {
    extra?.trigger?.(response);
    processResponse(name, response, options);
  });
}

function flushReadyCallbacks(): void {
  const callbacks = readyCallbacks;
  readyCallbacks = [];
  callbacks.forEach((callback) => callback());
}

/** 微信 SDK 原版的运行数据统计请求，仅在满足其环境检查时发出。 */
function report(jsApiName = ''): void {
  // 字符串版本比较延续原件；统计行为与业务 JSAPI 无关。
  if (isDesktop || isDebugger || currentConfig.debug || clientVersion < '6.0.2' || (!isIOS && !isAndroid)) return;
  const image = new Image();
  // 和原版一致，走 SDK 的 getNetworkType 做回包归一化后再上报。
  wx.getNetworkType({
    isInnerInvoke: true,
    success(response) {
      // 原版先 encodeURIComponent(url)，然后直接拼 URL；不能再次 URLSearchParams 编码。
      image.src = 'https://open.weixin.qq.com/sdk/report?v=1'
        + `&o=${preVerifyOk}&s=${isIOS ? '1' : '2'}&c=${clientVersion}`
        + `&a=${currentConfig.appId ?? ''}&n=${String(response.networkType ?? '')}`
        + `&i=${endInitTime - startInitTime}&p=${endVerifyTime - startVerifyTime}`
        + `&u=${encodeURIComponent(globalWindow.location.href)}&jsapi_name=${jsApiName}`;
    },
  });
}

function paymentParams(options: WxPaymentOptions): Record<string, unknown> {
  return {
    timeStamp: String(options.timestamp), nonceStr: options.nonceStr,
    package: options.package, paySign: options.paySign, signType: options.signType || 'SHA1',
  };
}

/** 根据原源码方式拼接小程序路径；注意会直接加 .html，不检查已有扩展名。 */
function convertMiniProgramPath(path?: string): string | undefined {
  if (!path) return undefined;
  const [page, query] = path.split('?');
  return `${page}.html${query !== undefined ? `?${query}` : ''}`;
}

/** 将需要微信签名的调用参数与回调传入桥；消除原版的 _complete 对调用方对象的修改。 */
function callWithTransform(
  name: string,
  params: Record<string, unknown>,
  callbacks: WxCallbacks | undefined,
  transform: (result: BridgeResponse) => void,
): void {
  invokeBridge(name, params, { ...callbacks, _complete: transform });
}

// ============== 3. ESM 公开实例（保留原源码全部 API） ==============

function createWechatSdk(): WxJSApi {
  const sdk: WxJSApi = {
    version,
    config(options) {
      currentConfig = { ...options };
      debugLog('config');
      const shouldCheck = options.check !== false;
      onBridgeReady(() => {
        if (!shouldCheck) {
          verifyStatus = 1;
          flushReadyCallbacks();
          return;
        }
        startVerifyTime = Date.now();
        invokeBridge(jsApiMap.config, {
          verifyJsApiList: mapApiList(options.jsApiList),
          verifyOpenTagList: mapApiList(options.openTagList),
        }, {
          _complete(result) {
            endVerifyTime = Date.now();
            verifyStatus = 1;
            verifyResult = result;
          },
          success() {
            preVerifyOk = 0;
          },
          fail(error) {
            if (configErrorHandler) configErrorHandler(error);
            else verifyStatus = -1;
          },
          complete() {
            report();
            flushReadyCallbacks();
          },
        });
      });
    },
    ready(callback) {
      // 原版在非微信调试模式可立即执行（检查开关 check=false 也能触发）。
      if (verifyStatus !== 0 || (!isWeChat && currentConfig.debug)) callback();
      else readyCallbacks.push(callback);
    },
    error(callback) {
      if (clientVersion < '6.0.2') return;
      if (verifyStatus === -1) callback(verifyResult);
      else configErrorHandler = callback;
    },
    invoke(name, params = {}, callback) {
      const bridge = globalWindow.WeixinJSBridge;
      if (bridge) bridge.invoke(name, bridgeParams(params), callback as (result: BridgeResponse) => void);
    },
    on(name, callback) {
      globalWindow.WeixinJSBridge?.on(name, callback as (result: BridgeResponse) => void);
    },
    checkJsApi(options) {
      callWithTransform('checkJsApi', { jsApiList: mapApiList(options.jsApiList) }, options, (response) => {
        if (isAndroid && typeof response.checkResult === 'string') {
          response.checkResult = JSON.parse(response.checkResult);
        }
        const result = response.checkResult as Record<string, boolean> | undefined;
        if (!result) return;
        for (const name of Object.keys(result)) {
          const mappedName = reverseApiMap[name];
          if (mappedName) {
            result[mappedName] = result[name];
            delete result[name];
          }
        }
      });
    },

    onMenuShareTimeline(options) {
      onBridge(jsApiMap.onMenuShareTimeline, {
        complete() {
          invokeBridge('shareTimeline', {
            title: options.title || defaultTitle, desc: options.title || defaultTitle,
            img_url: options.imgUrl || '', link: options.link || globalWindow.location.href,
            type: options.type || 'link', data_url: options.dataUrl || '',
          }, options);
        },
      });
    },
    onMenuShareAppMessage(options) {
      onBridge(jsApiMap.onMenuShareAppMessage, {
        complete(response) {
          const payload = {
            title: options.title || defaultTitle, desc: options.desc || '',
            link: options.link || globalWindow.location.href, img_url: options.imgUrl || '',
            type: options.type || 'link', data_url: options.dataUrl || '',
          };
          // 原稿场景为 favorite 时不附带业务回调。
          if (response.scene === 'favorite') invokeBridge('sendAppMessage', payload);
          else invokeBridge('sendAppMessage', payload, options);
        },
      });
    },
    onMenuShareQQ(options) {
      onBridge(jsApiMap.onMenuShareQQ, {
        complete() {
          invokeBridge('shareQQ', {
            title: options.title || defaultTitle, desc: options.desc || '',
            img_url: options.imgUrl || '', link: options.link || globalWindow.location.href,
          }, options);
        },
      });
    },
    onMenuShareWeibo(options) {
      onBridge(jsApiMap.onMenuShareWeibo, {
        complete() {
          invokeBridge('shareWeiboApp', {
            title: options.title || defaultTitle, desc: options.desc || '',
            img_url: options.imgUrl || '', link: options.link || globalWindow.location.href,
          }, options);
        },
      });
    },
    onMenuShareQZone(options) {
      onBridge(jsApiMap.onMenuShareQZone, {
        complete() {
          invokeBridge('shareQZone', {
            title: options.title || defaultTitle, desc: options.desc || '',
            img_url: options.imgUrl || '', link: options.link || globalWindow.location.href,
          }, options);
        },
      });
    },
    updateTimelineShareData(options) {
      invokeBridge('updateTimelineShareData', { title: options.title, link: options.link, imgUrl: options.imgUrl }, options);
    },
    updateAppMessageShareData(options) {
      invokeBridge('updateAppMessageShareData', {
        title: options.title, desc: options.desc, link: options.link, imgUrl: options.imgUrl,
      }, options);
    },

    startRecord(options = {}) { invokeBridge('startRecord', {}, options); },
    stopRecord(options = {}) { invokeBridge('stopRecord', {}, options); },
    onVoiceRecordEnd(options) { onBridge('onVoiceRecordEnd', options); },
    playVoice(options) { invokeBridge('playVoice', { localId: options.localId }, options); },
    pauseVoice(options) { invokeBridge('pauseVoice', { localId: options.localId }, options); },
    stopVoice(options) { invokeBridge('stopVoice', { localId: options.localId }, options); },
    onVoicePlayEnd(options) { onBridge('onVoicePlayEnd', options); },
    uploadVoice(options) {
      invokeBridge('uploadVoice', { localId: options.localId, isShowProgressTips: options.isShowProgressTips === 0 ? 0 : 1 }, options);
    },
    downloadVoice(options) {
      invokeBridge('downloadVoice', { serverId: options.serverId, isShowProgressTips: options.isShowProgressTips === 0 ? 0 : 1 }, options);
    },
    translateVoice(options) {
      invokeBridge('translateVoice', { localId: options.localId, isShowProgressTips: options.isShowProgressTips === 0 ? 0 : 1 }, options);
    },

    chooseImage(options) {
      callWithTransform('chooseImage', {
        scene: '1|2', count: options.count || 9,
        sizeType: options.sizeType || ['original', 'compressed'],
        sourceType: options.sourceType || ['album', 'camera'],
      }, options, (response) => {
        if (isAndroid && typeof response.localIds === 'string') {
          try { response.localIds = JSON.parse(response.localIds); } catch { /* 保留原值 */ }
        }
      });
    },
    getLocation(options) {
      callWithTransform(jsApiMap.getLocation, { type: options.type || 'wgs84' }, options, (response) => {
        delete response.type;
      });
    },
    previewImage(options) {
      invokeBridge(jsApiMap.previewImage, { current: options.current, urls: options.urls }, options);
    },
    uploadImage(options) {
      invokeBridge('uploadImage', { localId: options.localId, isShowProgressTips: options.isShowProgressTips === 0 ? 0 : 1 }, options);
    },
    downloadImage(options) {
      invokeBridge('downloadImage', { serverId: options.serverId, isShowProgressTips: options.isShowProgressTips === 0 ? 0 : 1 }, options);
    },
    getLocalImgData(options) {
      // 原版限制同时仅有一个 getLocalImgData 运行，并按 FIFO 处理等待队列。
      if (isGettingLocalImage) {
        pendingLocalImages.push(options);
        return;
      }
      isGettingLocalImage = true;
      callWithTransform('getLocalImgData', { localId: options.localId }, options, () => {
        isGettingLocalImage = false;
        const next = pendingLocalImages.shift();
        if (next) sdk.getLocalImgData(next);
      });
    },
    getNetworkType(options) {
      callWithTransform('getNetworkType', {}, options, (response) => {
        const originalMsg = response.errMsg ?? '';
        const subtype = response.subtype;
        response.errMsg = 'getNetworkType:ok';
        delete response.subtype;
        if (subtype) response.networkType = subtype;
        else {
          const type = originalMsg.slice(originalMsg.indexOf(':') + 1);
          if (['wifi', 'edge', 'wwan'].includes(type)) response.networkType = type;
          else response.errMsg = 'getNetworkType:fail';
        }
      });
    },
    openLocation(options) {
      invokeBridge('openLocation', {
        latitude: options.latitude, longitude: options.longitude,
        name: options.name || '', address: options.address || '',
        scale: options.scale || 28, infoUrl: options.infoUrl || '',
      }, options);
    },
    hideOptionMenu(options = {}) { invokeBridge('hideOptionMenu', {}, options); },
    showOptionMenu(options = {}) { invokeBridge('showOptionMenu', {}, options); },
    closeWindow(options = {}) { invokeBridge('closeWindow', {}, options); },
    hideMenuItems(options) { invokeBridge('hideMenuItems', { menuList: options.menuList }, options); },
    showMenuItems(options) { invokeBridge('showMenuItems', { menuList: options.menuList }, options); },
    hideAllNonBaseMenuItem(options = {}) { invokeBridge('hideAllNonBaseMenuItem', {}, options); },
    showAllNonBaseMenuItem(options = {}) { invokeBridge('showAllNonBaseMenuItem', {}, options); },
    scanQRCode(options = {}) {
      callWithTransform('scanQRCode', {
        needResult: options.needResult || 0,
        scanType: options.scanType || ['qrCode', 'barCode'],
      }, options, (response) => {
        if (isIOS && response.resultStr) {
          // 原版 iOS 用嵌套 JSON 的 scan_code.scan_result 返回扫码内容。
          const parsed = JSON.parse(response.resultStr) as { scan_code?: { scan_result?: string } };
          response.resultStr = parsed?.scan_code?.scan_result;
        }
      });
    },
    openAddress(options = {}) {
      callWithTransform(jsApiMap.openAddress, {}, options, (response) => {
        const fields: Record<string, string> = {
          addressPostalCode: 'postalCode',
          proviceFirstStageName: 'provinceName',
          addressCitySecondStageName: 'cityName',
          addressCountiesThirdStageName: 'countryName',
          addressDetailInfo: 'detailInfo',
        };
        for (const [source, target] of Object.entries(fields)) {
          response[target] = response[source];
          delete response[source];
        }
      });
    },
    openProductSpecificView(options) {
      invokeBridge(jsApiMap.openProductSpecificView, {
        pid: options.productId, view_type: options.viewType || 0, ext_info: options.extInfo,
      }, options);
    },
    addCard(options) {
      callWithTransform(jsApiMap.addCard, {
        card_list: options.cardList.map((card) => ({ card_id: card.cardId, card_ext: card.cardExt })),
      }, options, (response) => {
        if (response.card_list) {
          const items = JSON.parse(response.card_list) as Array<Record<string, any>>;
          response.cardList = items.map((card) => {
            const { card_id, card_ext, is_succ, ...rest } = card;
            return { ...rest, cardId: card_id, cardExt: card_ext, isSuccess: Boolean(is_succ) };
          });
          delete response.card_list;
        }
      });
    },
    chooseCard(options) {
      callWithTransform('chooseCard', {
        app_id: currentConfig.appId, location_id: options.shopId || '',
        sign_type: options.signType || 'SHA1', card_id: options.cardId || '',
        card_type: options.cardType || '', card_sign: options.cardSign,
        time_stamp: String(options.timestamp), nonce_str: options.nonceStr,
      }, options, (response) => {
        response.cardList = response.choose_card_info;
        delete response.choose_card_info;
      });
    },
    openCard(options) {
      // 原版 Object.assign({ card_id: card.cardId }, card)，故保留 cardId 原字段。
      invokeBridge(jsApiMap.openCard, {
        card_list: options.cardList.map((card) => ({ card_id: card.cardId, ...card })),
      }, options);
    },
    consumeAndShareCard(options) {
      invokeBridge(jsApiMap.consumeAndShareCard, { consumedCardId: options.cardId, consumedCode: options.code }, options);
    },
    chooseWXPay(options) {
      invokeBridge(jsApiMap.chooseWXPay, paymentParams(options), options);
      report('chooseWXPay');
    },
    openEnterpriseRedPacket(options) {
      invokeBridge(jsApiMap.openEnterpriseRedPacket, paymentParams(options), options);
    },
    startSearchBeacons(options) {
      invokeBridge(jsApiMap.startSearchBeacons, { ticket: options.ticket }, options);
    },
    stopSearchBeacons(options = {}) { invokeBridge(jsApiMap.stopSearchBeacons, {}, options); },
    onSearchBeacons(options) { onBridge(jsApiMap.onSearchBeacons, options); },
    openEnterpriseChat(options) {
      invokeBridge('openEnterpriseChat', { useridlist: options.userIds, chatname: options.groupName }, options);
    },
    launchMiniProgram(options) {
      invokeBridge('launchMiniProgram', {
        targetAppId: options.targetAppId,
        path: convertMiniProgramPath(options.path), envVersion: options.envVersion,
      }, options);
    },
    openBusinessView(options) {
      callWithTransform('openBusinessView', {
        businessType: options.businessType, queryString: options.queryString || '', envVersion: options.envVersion,
      }, options, (response) => {
        if (isAndroid && response.extraData) {
          try { response.extraData = JSON.parse(response.extraData); }
          catch { response.extraData = {}; }
        }
      });
    },
    miniProgram: {
      navigateBack(options = {}) {
        onBridgeReady(() => invokeBridge('invokeMiniProgramAPI', { name: 'navigateBack', arg: { delta: options.delta || 1 } }, options));
      },
      navigateTo(options) {
        onBridgeReady(() => invokeBridge('invokeMiniProgramAPI', { name: 'navigateTo', arg: { url: options.url } }, options));
      },
      redirectTo(options) {
        onBridgeReady(() => invokeBridge('invokeMiniProgramAPI', { name: 'redirectTo', arg: { url: options.url } }, options));
      },
      switchTab(options) {
        onBridgeReady(() => invokeBridge('invokeMiniProgramAPI', { name: 'switchTab', arg: { url: options.url } }, options));
      },
      reLaunch(options) {
        onBridgeReady(() => invokeBridge('invokeMiniProgramAPI', { name: 'reLaunch', arg: { url: options.url } }, options));
      },
      postMessage(options) {
        onBridgeReady(() => invokeBridge('invokeMiniProgramAPI', { name: 'postMessage', arg: options.data || {} }, options));
      },
      getEnv(callback) {
        onBridgeReady(() => callback({ miniprogram: globalWindow.__wxjs_environment === 'miniprogram' }));
      },
    },
    requestFacialVerify(options) {
      callWithTransform('requestWxFacePictureVerify', {
        appId: options.appId,
        request_verify_pre_info: JSON.stringify({ verify_id: options.verifyId || '', version: 1 }),
      }, options, (response) => {
        if (response.verifyResult) {
          delete response.verifyResult;
          response.errCode = 0;
          response.errMsg = 'requestFacialVerify:ok';
        }
      });
    },
    requestFacialVerifyAndUploadVideo(options) {
      callWithTransform('requestWxFacePictureVerifyUnionVideo', {
        appId: options.appId,
        request_verify_pre_info: JSON.stringify({ verify_id: options.verifyId || '', version: 1 }),
      }, options, (response) => {
        if (response.verifyResult) {
          delete response.verifyResult;
          response.errCode = 0;
          response.errMsg = 'requestFacialVerifyAndUploadVideo:ok';
        }
      });
    },
  };
  return sdk;
}

/**
 * 与原版一致：若 window.jWeixin 已存在则复用。
 * 注意：若先加载了另一份 SDK，已存在对象的 version 可能不是本包版本；
 * 不应将两份微信 SDK 同时引入同一页面。
 */
export const wx: WxJSApi = globalWindow.jWeixin ?? createWechatSdk();

// 原浏览器脚本同时暴露 window.wx / window.jWeixin；ESM 导入也可直接使用 wx。
if (!globalWindow.jWeixin) {
  globalWindow.jWeixin = wx;
  globalWindow.wx = wx;
}

// 原版 iOS 非 Android 下修复 wxlocalresource:// 的媒体资源 src。
// 这段保留为浏览器副作用，与普通图片 URL 不冲突。
if (!isAndroid) {
  documentRef.addEventListener('error', (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLImageElement || target instanceof HTMLVideoElement
      || target instanceof HTMLAudioElement || target instanceof HTMLSourceElement)) return;
    const url = target.src;
    if (!url?.includes('wxlocalresource://')) return;
    event.preventDefault();
    event.stopPropagation();
    const element = target as typeof target & { __wxSdkResourceId?: number };
    const id = element.__wxSdkResourceId ?? (element.__wxSdkResourceId = resourceIdSeed++);
    if (resourceLoading.get(id)) return;
    resourceLoading.set(id, true);
    wx.ready(() => {
      wx.getLocalImgData({
        localId: url,
        success(result) {
          if (typeof result.localData === 'string') element.src = result.localData;
        },
      });
    });
  }, true);
  documentRef.addEventListener('load', (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLImageElement || target instanceof HTMLVideoElement
      || target instanceof HTMLAudioElement || target instanceof HTMLSourceElement)) return;
    const id = (target as typeof target & { __wxSdkResourceId?: number }).__wxSdkResourceId;
    if (id) resourceLoading.set(id, false);
  }, true);
}

export default wx;
