// Full-page shell for the left sidebar entry. Replaces the old right-sidebar
// drawer: same components, but laid out like a DSH settings page (host font,
// host tokens, one column, explanations in "?" tips instead of paragraphs).
import { h, useState, useEffect, useCallback } from "../shared/react.js";
import { PURGE_CSS, NATIVE_CSS, PAGE_CSS } from "../styles/index.js";
import { compatibilityLevelText, useT } from "../shared/locale.js";
import { RewindSetting } from "./rewind-setting.js";
import { apiJson, unavailableStatus } from "../api/client.js";
import { Btn, HelpTip } from "./primitives.js";
import { PurgifySection } from "./settings-form.js";
import { RulesSection } from "./rules.js";
import { SkillsSection } from "./skills.js";
import { CommunityMaintenance, StatusExtras } from "./maintenance.js";
import { __dshPurgeDrill } from "../vendor/drill.js";
import { readDrillAuth, setDock, requestDrill } from "../state/dock.js";

const TABS = [
  ["prompt", "提示词", "注入正文与破甲强化段"],
  ["rules", "规则", "规则集与工作区策略"],
  ["skills", "技能", "DSH 技能目录"],
  ["drill", "演练台", "红队演练与环境适配"],
  ["more", "更多", "会话外观与服务器设置"],
];

function PurgeGlyph({ size = 18 } = {}) {
  return h(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.6,
      "aria-hidden": true,
    },
    h("path", { d: "M12 3l7 3v6c0 4.2-2.9 7.4-7 9-4.1-1.6-7-4.8-7-9V6l7-3z" }),
    h("path", { d: "M9.5 12.2l1.8 1.8 3.4-3.6" }),
  );
}

export function StatusStrip({ info }) {
  const t = useT();
  const compat = info?.compatibility || {};
  const level = compat.level || "";
  const ok = level === "qualified";
  return h(
    "div",
    { className: "dshpp-strip" },
    h(
      "span",
      { className: "dshpp-strip-item" },
      h("i", {
        className: "dshpp-dot " + (ok ? "is-ok" : level ? "is-warn" : ""),
      }),
      "DSH ",
      h("b", null, compat.host_version || "…"),
    ),
    h(
      "span",
      { className: "dshpp-strip-item" },
      "兼容级别 ",
      h(
        "b",
        null,
        level
          ? compatibilityLevelText(t, level)
          : info?.ok === false
            ? "读取失败"
            : "检测中",
      ),
      h(
        HelpTip,
        { title: "兼容级别" },
        compat.message ||
          "读取宿主组件版本后给出结论。qualified 表示该 DSH 版本的补丁锚点已逐条回归。",
      ),
    ),
    h(
      "span",
      { className: "dshpp-strip-item" },
      "磁盘写入计数 ",
      h(
        "b",
        null,
        "",
      ),
      h(
        HelpTip,
        { title: "宿主补丁" },
        "仅有逐条明细时统计实际写入数。部分生效、缺失或无法读取均不算已写入。",
      ),
    ),
    h(
      "span",
      { className: "dshpp-strip-item" },
      "插件 ",
      h("b", null, info?.plugin_version || __PANEL_VERSION__),
    ),
  );
}

/** 磁盘归档与进程入口分别呈现；不能从磁盘写入推断运行时已加载。 */
// [v2.1.1] LayoutNotice（换包状态）随宿主补丁层移除。

export function VersionNotice({ info }) {
  if (info && info.ok === false) {
    return h(
      "p",
      { className: "dshpp-warn", role: "status" },
      `状态读取失败：${info.error || "接口不可用"}。当前宿主与补丁状态未知，请点「刷新」重试；持续失败时请提供操作系统、DSH/插件版本和此错误。`,
    );
  }
  const backend = info?.plugin_version;
  if (!backend || backend === __PANEL_VERSION__) return null;
  return h(
    "p",
    { className: "dshpp-warn", role: "status" },
    `官方版本 ${backend}；界面 ${__PANEL_VERSION__}。两者不一致时设置可能不生效，请更新到同一版本后重启 DSH。`,
  );
}

export function PurgePage() {
  const t = useT();
  const [tab, setTab] = useState("prompt");
  const [visited, setVisited] = useState({ status: true });
  const [info, setInfo] = useState(null);
  const select = (id) => {
    setTab(id);
    setVisited((v) => Object.assign({}, v, { [id]: true }));
  };
  const loadInfo = () =>
    apiJson("/dsh-purge/status")
      .then(setInfo)
      .catch((error) => setInfo(unavailableStatus(error)));
  // 子组件的 onStatus 在依赖里，必须是稳定引用，否则每次渲染都会再 setInfo 一次。
  const mergeInfo = useCallback((s) => s && setInfo(s), []);
  useEffect(() => {
    if (tab === "prompt") loadInfo();
  }, [tab]);
  // [v2.1.1] asar 换包轮询随宿主补丁层移除。
  const active = TABS.find((row) => row[0] === tab) || TABS[0];
  return h(
    "div",
    { className: "dshpp-page" },
    h("style", null, PURGE_CSS + NATIVE_CSS + PAGE_CSS),
    h(
      "header",
      { className: "dshpp-page-head" },
      h("span", { className: "dshpp-page-glyph" }, h(PurgeGlyph, { size: 20 })),
      h(
        "div",
        { className: "dshpp-page-title" },
        h("h1", null, "Purge"),
        h(
          "p",
          null,
          active[2],
          __COMMUNITY__
            ? h(
                "span",
                { className: "dshpp-page-ver" },
                "社区版 " + __PANEL_VERSION__,
              )
            : null,
        ),
      ),
    ),
    h(VersionNotice, { info }),
    h(
      "nav",
      { className: "dshpp-page-tabs", role: "tablist" },
      TABS.map(([id, label]) =>
        h(
          "button",
          {
            key: id,
            type: "button",
            role: "tab",
            "aria-selected": tab === id ? "true" : "false",
            className: tab === id ? "is-on" : "",
            onClick: () => select(id),
          },
          label,
        ),
      ),
    ),
    h(
      "div",
      { className: "dshpp-page-body" },
      h(
        "div",
        { hidden: tab !== "status", className: "dshpp-sec" },
        h(StatusStrip, { info }),
        h(PurgifySection, { page: "status", onStatus: mergeInfo }),
        h(StatusExtras),
        h(CommunityMaintenance, { localVersion: info?.plugin_version || "" }),
      ),
      h(
        "div",
        { hidden: tab !== "prompt", className: "dshpp-sec" },
        visited.prompt ? h(PurgifySection, { page: "prompt" }) : null,
      ),
      h(
        "div",
        { hidden: tab !== "rules", className: "dshpp-sec" },
        visited.rules ? h(RulesSection) : null,
      ),
      h(
        "div",
        { hidden: tab !== "skills", className: "dshpp-sec" },
        visited.skills ? h(SkillsSection) : null,
      ),
      h(
        "div",
        { hidden: tab !== "more", className: "dshpp-sec" },
        __COMMUNITY__ && tab === "more" ? h(RewindSetting) : null,
        visited.more ? h(PurgifySection, { page: "more" }) : null,
      ),
      tab === "drill"
        ? h(
            "div",
            { className: "dshpp-sec dshpp-page-drill" },
            __dshPurgeDrill && __dshPurgeDrill.CSS
              ? h("style", { "data-dsh-purge-drill": "1" }, __dshPurgeDrill.CSS)
              : null,
            readDrillAuth()
              ? h(__dshPurgeDrill.Panel, { embedded: true })
              : h(
                  "div",
                  { className: "dshpp-card" },
                  h(
                    "p",
                    { className: "dshpp-muted" },
                    "演练台需要先完成一次授权。",
                  ),
                  h(
                    Btn,
                    {
                      kind: "primary",
                      onClick: () => {
                        setDock({ tab: "drill", authOpen: true });
                        requestDrill("auth");
                      },
                    },
                    "去授权",
                  ),
                ),
          )
        : null,
    ),
    h(
      "footer",
      { className: "dshpp-page-foot" },
      __COMMUNITY__
        ? "基于 YuJunZhiXue/dsh-purge 1.1.71 独立维护 · MIT · 保留原作者署名"
        : "界面独立维护 · 基于 YuJunZhiXue/dsh-purge 1.1.71（MIT）",
    ),
  );
}

export { PurgeGlyph };
