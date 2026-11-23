// [dsh-purge] 引擎层补丁表（v2 分类重组后）。
// 原 #9-#16（审批自动放行、沙箱 confine 直通、fs 围栏拆除、观察策略放行、
// 升级豁免）、#93/#94（品牌词中性化）属"拆审批/拆沙箱/摘牌"堆，v2 起退役。
// 保留两条对所有预设都是纯收益的桌面修复：
//   #91 会话 cookie 名忽略端口——官方按 host:port 取名，桌面每次启动端口
//      随机 → cookie 无限累积撑爆请求头（431），应用打不开；只按主机取名。
//   #92 放宽 host 进程请求头上限到 256KB——兜住已累积的历史 cookie 存量。
export const ENGINE_PATCHES = [
  {
    id: 91, name: "BROWSER_COOKIE_NAME_IGNORE_PORT", layer: "代码", layer_en: "Code",
    surfaces: ["desktop"],
    desc: "仅桌面端：会话 cookie 名忽略端口，避免随机端口累积 cookie 撑爆请求头（431）/ cookie name ignores port",
    file: "client-connection",
    rel: ["lib", "index.js"],
    replacements: [
      {
        pattern: 'encodeBase64Url(createHash("sha256").update(authority).digest())',
        replace:
          'encodeBase64Url(createHash("sha256").update(String(authority).replace(/:[0-9]+$/u, "")).digest()) /* [dsh-purge] cookie-name-ignore-port */',
      },
    ],
    marker: "[dsh-purge] cookie-name-ignore-port",
  },
  {
    id: 92, name: "HOST_MAX_HTTP_HEADER_SIZE", layer: "代码", layer_en: "Code",
    desc: "放宽 host 进程 HTTP 请求头上限到 256KB，兜住历史 cookie 累积 / raise host max-http-header-size",
    file: "desktop-shell",
    surfaces: ["desktop"],
    optional: true,
    replacements: [
      {
        pattern:
          /("--expose-internals",)(?: \/\* \[dsh-purge\] raise-host-header-limit \*\/ "--max-http-header-size=262144",)*/g,
        replace:
          '$1 /* [dsh-purge] raise-host-header-limit */ "--max-http-header-size=262144",',
      },
    ],
    marker: "[dsh-purge] raise-host-header-limit",
  },
];
