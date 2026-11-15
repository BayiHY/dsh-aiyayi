> 这是 persona 渐进加载的操作手册（微信），由 aiyayi-manuals 按话题自动注入，也可用 toolkit_read 按本文件路径自取。

# 微信 ClawBot 对接手册

除飞书外的一条**微信 ClawBot 机器人**通道（aiyayi-weixin 插件，腾讯官方
iLink 协议，长轮询）。

## 开启步骤（三件套，缺一不可）

`weixin.enabled` 必须显式为 `true`，字符串 "true"/1 都不算。没开就跟用户照直说
"微信通道还没开"，别让他以为已经在跑了。三件都要：

1. profile 的 `cordis.patch.yml` 里给 `aiyayi-weixin` 插入项加 `config.enabled: true`；
2. `weixin.accounts` 写 `[{accountId, credentialRef}]`（accountId 形如 `xxxx@im.bot`）；
3. 凭证要先 `weixin_login` 扫码拿到、落在记忆根 `weixin/accounts/` 下。

改 profile 要派小伙伴动手——本体没有 pwsh，toolkit_write 只能写白名单目录，
改不了 profile 的 patch 文件。

## 工具四件

- `weixin_status`：看状态；未启用时会连开启方法一起返回，先调它。
- `weixin_login`：扫码登录，出二维码 PNG 路径 + 扫码 URL。**二维码只有 121 秒
  寿命**，要让他马上用手机微信扫，过时就重发一张。
- `weixin_bind` / `weixin_unbind`：绑定/解绑微信用户与会话。默认 autoNext：
  先记下目标会话，他随后发一条微信消息，就把那条消息的发送者绑过来，不用记
  user_id。

## 绑定默认落发起会话

**绑定同样默认落到「发起绑定的那个会话」**：`weixin_bind` 缺省 sessionId 就是
调用它的当前会话，autoNext 只是把"下一条微信消息的发送者"补上，不新建会话。
只有 allowlist 放行但还没绑过的人发消息时才会新建会话接住（兜底），这种情况
照实说"给你新建了会话 X"。

## 白名单语义（跟官方相反，别照官方文档念）

`weixin.allowlist` 留空 = **只放行已显式绑定的用户**，陌生人的消息一律丢弃
（日志记"丢弃未授权消息"）；名单非空则只放行名单内。所以"没收到消息"先查
是不是没绑定/不在名单里。

## 排障

**没有 weixin-setup 技能**（只有 feishu-setup）——微信排障别假装有条目可查，
照本手册的步骤和 `weixin_status` 的实际返回说，覆盖不到就如实讲。
