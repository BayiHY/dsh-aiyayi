// 阿依娅伊：认证 URL 端点（1.17.0 本地测试态，随引擎重启生效）。
// GET /api/aiyayi/auth-url —— 返回 { url: "<带启动 token 的完整 Web URL>" }。
// 用途：哑窗口（无 speechSynthesis 的内嵌 WebView）里点 🔊 按钮时，把
// dsh web 启动时打印的那种带 token 的 URL 递到剪贴板，用正路浏览器打开朗读。
//
// 鉴权与实现参照宿主自带范式（读源码核对过，不发明新机制）：
// - 路由挂在 Connection 的 exact fetch 注册表（connection.fetch.register）。
//   该注册表的 HTTP 面是 client-connection 在 /api 前缀上挂的统一路由
//   （dsh-client-connection lib/index.js apply() L1044-1058）：每个 /api 请求
//   都先过 admit() —— Host/Origin 栅栏 + 浏览器 cookie / API 凭据认证，
//   未登录请求根本到不了本 handler，所以路径必须以 /api/ 开头。
// - URL 生成用 connection.authenticatedUrl()（dsh-web-app printUrl 同款
//   调用链，dsh-web-app/lib/index.js L156-162），基底 URL 优先取 webApp
//   服务的 getAdvertisedUrl()（--public-url 意识），取不到退回 getOrigin()。
//
// 安全口径：只答 GET；无副作用；响应 no-store；路径与响应头不带任何 secret
// （启动 token 只进响应体 url，不进日志、不进路径）；失败 5xx 且不泄内部细节。

/** exact fetch 路由路径（必须在 /api 前缀下才在认证栅栏后面）。 */
export const AUTH_URL_PATH = '/api/aiyayi/auth-url'

/**
 * 注册认证 URL 路由。须在能解析到宿主 connection / webServer 服务的上下文里
 * 调用（本插件 apply(ctx) 在 preset 作用域，ctx.inject 从宿主根解析这两个
 * 服务；没有 web 面的 profile 里 inject 永不落地，静默零开销）。
 * @param ctx - 插件上下文。
 */
export function registerAuthUrlRoute(ctx) {
  ctx.inject(['connection', 'webServer'], (scope) => {
    // 基底 URL 请求时才解析：启动早期 listener 可能还没绑端口（getOrigin 会
    // throw "origin read before the listener bound a port"），lazy 口径同
    // dsh-web-app 的 appRootUrl 闭包。
    const resolveOrigin = () => {
      const advertised = scope.get('webApp')?.getAdvertisedUrl?.()
      return advertised ?? scope.webServer.getOrigin()
    }
    return scope.connection.fetch.register({
      path: AUTH_URL_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: () => {
        try {
          const url = scope.connection.authenticatedUrl(resolveOrigin())
          return Response.json({ url }, { headers: { 'cache-control': 'no-store' } })
        } catch {
          // 不把内部错误细节（token 机制、绑定地址等）带给页面
          return Response.json(
            { error: 'aiyayi: failed to build the authenticated URL' },
            { status: 500, headers: { 'cache-control': 'no-store' } },
          )
        }
      },
    })
    // 返回值是 inject 的 fiber；fetch.register 自己返回的 disposer 挂在
    // inject 子作用域上，插件卸载时自动反注册 exact 路由，不占坑。
  })
}
