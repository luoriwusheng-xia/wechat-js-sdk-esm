# 微信 JS-SDK 1.6.3 — TypeScript + ESM

将浏览器端微信 JS-SDK 压缩脚本改造成可直接用于 Vite 项目的 TypeScript + ES Module npm 包。

> **原版微信 JS-SDK 1.6.3 脚本：** https://res.wx.qq.com/open/js/jweixin-1.6.3.js
>
> 这是对所提供浏览器源码的 **非官方重构**，不是微信官方发布或维护的 npm 包。目标是保持桥接 API、参数映射、回调行为基本一致，新增 TypeScript 类型和 ESM 导出。必须在真实微信环境验证有权限要求的 API。

## 目录

```text
wechat-js-sdk-ts/
├── package.json            # npm 元信息、版本 1.6.3、仅 ESM exports
├── vite.config.ts          # Vite 8 库构建，formats 只有 ['es']
├── tsconfig.json           # 严格 TS 类型检查
├── tsconfig.build.json     # 输出 .d.ts / .d.ts.map
├── tsconfig.emit.json      # 纯 TypeScript 预编译配置（非发布必需）
├── src/
│   ├── index.ts            # ESM 入口 / 默认导出
│   ├── sdk.ts              # 微信 JSBridge API 实现和中文注释
│   └── types.ts            # 完整 TypeScript 类型定义
├── examples/
│   └── vue3-h5.ts          # H5 引入示例
├── tests/
│   └── sdk.test.mjs        # 桥调用/版本/回调冒烟测试
└── dist/                   # 输出 JS (ESM) / sourcemap / d.ts
```

## 安装、构建、测试

要求 Node.js `^20.19.0` 或 `>=22.12.0`，npm 或 pnpm 均可。

```bash
npm install
npm run typecheck
npm run build
npm test
npm run pack:check
```

实际构建命令是 `vite build && tsc -p tsconfig.build.json`：

- Vite 8 的 `build.lib.formats: ['es']` 保证 **只输出 ESM**，不会生成 `.cjs`、UMD。
- Vite 生成 `dist/index.js` 和 `dist/index.js.map`；`tsc` 生成 `.d.ts` 类型声明及声明映射。
- 打包时同时包含 `src/*.ts` 源码，便于审查与调试，**npm 的运行入口仍然是 dist/index.js**。
- 无运行时 npm 依赖，无需在 H5 再插入微信 `<script>`。

**随附 `dist/` 说明：** 由于制作压缩包的环境无法连接 npm registry，这份附件中先用 TypeScript 编译提供了**可运行的多文件 ESM 预构建版**（`index.js`、`sdk.js` 等），并完成了类型检查及桥接模拟测试。你在本地执行 `npm install && npm run build` 后，Vite 8 会按上面的库模式配置将 JS 重新打包成 `dist/index.js`，同时由 TypeScript 输出 `.d.ts`。打包配置已按 Vite 8 官方文档编写，但当前环境未实际执行 Vite 8 构建。

## 使用方式

```ts
import wx, { version, type WxConfig } from '@your-scope/wechat-js-sdk-esm';

console.log(version);    // '1.6.3'
console.log(wx.version); // '1.6.3'（前提：未先加载另一份全局 jWeixin）

const config: WxConfig = {
  appId: 'wx***',
  timestamp: 1234567890,
  nonceStr: 'server-generated-nonce',
  signature: 'server-generated-signature',
  jsApiList: ['scanQRCode', 'updateAppMessageShareData'],
};

// config 内的 timestamp、nonceStr、signature 均应来自服务端，不要在前端硬编码。
wx.config(config);
wx.ready(() => {
  wx.scanQRCode({
    needResult: 1,
    success: ({ resultStr }) => console.log('扫码：', resultStr),
    fail: ({ errMsg }) => console.warn('扫码失败：', errMsg),
  });
});
wx.error((error) => console.error('微信 SDK 配置失败', error));
```

还有完整的 H5 场景示例：`examples/vue3-h5.ts`。

## 版本字段

- `package.json.version`: `1.6.3`（npm 包自己的版本号）
- `version`: `'1.6.3'`（具名导出）
- `wx.version`: `'1.6.3'`（**本包新增字段**，微信原始浏览器脚本中没有这个字段）

若页面事先加载了其他微信 JS-SDK 并挂载 `window.jWeixin`，本实现按原版的**复用策略**优先使用原有实例，不会覆盖全局。此时既有实例的 `wx.version` 可能不同或不存在，不应将两份 SDK 同时加载。

## 兼容和行为说明

- `import` 会初始化浏览器全局 `window.wx` 和 `window.jWeixin`（原脚本行为），并注册微信 `wxlocalresource://` 媒体资源兼容事件。因此包标记了 `sideEffects: true`。
- 必须从 **浏览器客户端** 导入；`window`/`document`/微信 JSBridge 在 SSR / Node 环境下不可用。Nuxt 等 SSR 框架应使用客户端专用入口或动态加载。
- API 保留 `config`、`ready`、`error`、`checkJsApi`、分享、录音、图片、位置、扫码、卡券、支付、企业 API、小程序容器 API 等接口。
- 没有真正 `WeixinJSBridge` 的普通浏览器不会凭空产生扫码、支付等功能；需要微信环境和账号 API 权限。
- H5 SPA 微信签名所用 URL 必须遵循微信相关平台规则，通常不包含 `#` 及其后内容；不同微信客户端对 SPA 首次 URL 的签名处理可能有差异。
- 生产环境使用者自行完成微信 JSAPI 签名、授权域名、业务权限及功能回归测试。

## 发布到 npm

```bash
npm login
npm run build
npm run pack:check
npm publish --access public  # 公开的 scoped npm 包
```

## 开发维护须知

- 与压缩源版比较时，注意 `WeixinJSBridge.invoke/on` 的底层 API 名、参数字段以及 `errMsg` 的归一化逻辑。
- 类型定义对已知返回值做了显式声明；微信回包有若干动态字段仍保留 `[key: string]: unknown`。
- 该重构源自用户提交的压缩脚本，未针对所有微信版本和特殊接口开展真实设备端到端验证；测试仅覆盖模拟桥接行为。
