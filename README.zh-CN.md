<div align="center">

# dsh-purge Community

**让 AI 更专注地辅助你的学习与动手实验。**

给 DeepSeek Harness 的自托管运行时控件 · 提示词注入仅限无限制/红队模式 · 零宿主源码修改 · 左侧栏整页设置

当前版本 **2.1.1** · 纯运行时插件（不写 DSH 安装目录）

[让 AI 安装或自己安装](#安装)

</div>

---

## 它是什么

dsh-purge Community 是一个跑在你自己机器上的 **纯运行时插件**。安装后重启 DSH 即生效——不改写任何宿主源码，不需要点「应用」，没有权限报错。

**核心功能**：
- **模式白名单注入**：仅在 `unrestricted`（无限制模式）与 `redteam`（红队模式）两个预设下生效的提示词注入——standard / minimal / ptc / cordis 等其他模式**零改动**，与未装插件完全一致；
- **面板**：左侧栏 Purge 整页（提示词编辑、规则集、技能、红队演练台、服务器设置）；
- **规则集**：AGENTS.md / CLAUDE.md 切换与工作区策略；
- **技能**：$DSH_HOME/skills 目录的 ZIP / TAR / TGZ 导入；
- **回退**：/rewind 命令与面板按钮，撤回上一轮对话；
- **红队演练台**：SQLite 资产库、证据账本、评分系统、25 个红队技能；
- **备份 / 回滚**：profile 级快照、版本回滚；
- **CLI**：`purge-community` 全套命令。

**不再包含**（v2.1.0 起整体移除）：
- ~~宿主源码补丁~~（原 88 条 → 33 条 → 0 条）；
- ~~审批自动放行 / 沙箱直通 / 文件围栏拆除~~（回到 DSH 官方行为）；
- ~~应用 / 还原 / 卸载按钮~~（面板已删）；
- ~~Hooks 拦截 / 补丁健康 / 换包状态~~（面板已删）；
- ~~宿主安装目录写操作~~（任何环境下都不会发生）。

## 架构

```
┌─────────────────────────────────────────────┐
│              DSH 宿主（不修改）              │
├─────────────────────────────────────────────┤
│  官方审批 │ 官方沙箱 │ 官方文件围栏 │ 官方身份 │
├─────────────────────────────────────────────┤
│        dsh-purge-community（纯运行时）       │
│                                             │
│  模式白名单 ──→ 仅 unrestricted / redteam    │
│  提示词注入 ──→ prompt-inject.md 每步重贴    │
│  强化段   ──→ boost 尾部 section            │
│  能力协议 ──→ 技能/MCP 选用指导              │
│  拒绝重试 ──→ nudge → fiction → decompose    │
│  续跑     ──→ 回答中断自动"继续"             │
│                                             │
│  standard 等其他模式 → 零注入、零改写       │
└─────────────────────────────────────────────┘
```

## 安装

**方式一：DSH 官方插件界面**

1. 打开 DSH → 插件 → 添加插件 → 安装源选择 npm 官方源；
2. 安装 `dsh-purge-community`；
3. 重启 DSH，左侧栏出现 Purge 面板。

**方式二：DSH 官方 CLI**

```sh
dsh plugin --profile <实际名称> add <TGZ URL>
```

**方式三：本仓库打包**

```sh
npm pack --ignore-scripts
dsh plugin --profile <实际名称> add ./dsh-purge-community-2.1.1.tgz
```

**安装后无需点「应用」**——本插件不再有任何宿主写操作。重启 DSH 即生效。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `purge-community status` | 宿主路径与基本信息 |
| `purge-community selfcheck [--json]` | 运行时注入自检 |
| `purge-community probe [new]` | 生成运行时探针，验证注入到达模型 |
| `purge-community boost [on\|off]` | 尾部强化段开关 |
| `purge-community preset [status\|install]` | unrestricted 预设落盘 |
| `purge-community audit [--limit n]` | 最近动作记录 |
| `purge-community usage` / `prune` | 备份占用与清理 |
| `purge-community backup` / `rollback <id>` | 快照 / 回滚插件 |

## 版本历史

| 版本 | 变更 |
| --- | --- |
| **2.1.1** | 架构精简：删除 9948 行死代码/文档/脚本/测试；面板状态页整体移除 |
| **2.1.0** | 宿主源码补丁层整体移除——插件变为纯运行时插件 |
| **2.0.2** | 红队提示词定稿；红队预设反斜杠清理 |
| **2.0.1** | 出厂注入模板 / boost / 人格换为用户提供的版本 |
| **2.0.0** | 补丁分类重组：88 → 33 条；#1-#3 转运行时；模式白名单 |
| 1.7.20 | 上游最后一个版本（86 条补丁架构） |

## 兼容性

| 组件 | 值 |
| --- | --- |
| 插件 | `dsh-purge-community` 2.1.1 |
| 已验证宿主 | DSH Desktop 0.2.2-rc.5 |
| 其他宿主 | 允许安装；运行时功能与宿主版本无关（不依赖宿主源码结构） |
| Node | ≥18；红队工具需 ≥22.5（`node:sqlite`） |

## 许可证

MIT。原项目作者：小杨 / YuJunZhiXue。本仓库独立维护社区版。详见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE.md)。
