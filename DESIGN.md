---
name: Wanxing
description: 萬星的运行台账世界——slate 中性面、单枚印章红、等宽念数字，状态只有一枚徽标。
colors:
  accent: "#a6402f"
  accent-strong: "#8f3425"
  accent-soft: "#c2604c"
  accent-wash: "#f6eae7"
  accent-dark: "#d98a77"
  accent-dark-strong: "#e8a894"
  accent-dark-soft: "#b06a58"
  accent-dark-wash: "#2a1512"
  page-light: "#f8fafc"
  page-dark: "#020617"
  text-light: "#0f172a"
  text-dark: "#f1f5f9"
typography:
  sans:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"
    note: 浏览器默认栈，全站唯一正文族；中文优先的工业标准栈
  mono:
    fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace"
    note: 只用于 slug、调用键、A2A 路由、代码块——机器写的东西
  seal:
    fontFamily: "'Noto Serif SC', 'Songti SC', 'SimSun', serif"
    note: 只用于 SiteMark 的汉字方章，与兄弟线记号成套
  scale:
    body: "text-sm (14px)"
    meta: "text-xs (12px)"
    micro: "text-[11px]"
    page-title: "text-xl font-semibold"
    landing-title: "text-2xl font-semibold tracking-tight"
  rule: 正文 14px／元信息 12px／微标 11px——三档，不引入第四档；无 fluid clamp
rounded:
  chip: "rounded-full"
  control: "rounded-md (6px)"
  panel: "rounded-lg (8px)"
  card: "rounded-xl (12px)"
  seal: "5px"
spacing:
  side: "px-4"
  panel: "p-3 … p-4"
  grid: "gap-3 … gap-4"
  section: "space-y-6 … space-y-10"
layout:
  container: "max-w-5xl (1024px), mx-auto, px-4"
  console-drawer: "right drawer, max-w-xl"
components:
  accent-fill: 印章红底 + 白字（主按钮、选中的 tab、当前导航）
  accent-text: 印章红字（链接、强调操作）
  status-badge: 分类色底 + 同族深字（status-facts.js 七事实唯一真源）
  panel: "rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
---

# Design System: 萬星

从现存实现提取（`wanxing-web/src/index.css` 31 行 + 各组件 Tailwind 类）。这份文档钉住**已经在跑的
世界**，供后续每一刀引用；它不是重设计方案。

## Overview

**这个世界是什么：一张运行台账。** 萬星不是品牌站，是部署者与访客查看「谁在跑、谁在赚、谁坏了」的
工作面。所以视觉语言是浅色纸面（`slate-50`）上的白卡片、1px 淡边、大量留白，靠**信息密度与对齐**
建立秩序感，不靠装饰、不靠渐变、不靠阴影。

**唯一的颜色是一个印章。** `#a6402f` 是站点记号 `SiteMark` 的印章红，同时是全站唯一强调色：主按钮、
选中的 tab、当前导航、链接、强调操作。它出现的频率低是设计意图——红色出现时，它是在说「这是动作 /
你在这里」。除此之外，只有**状态语义色**（绿=在役、琥珀=待办/暂停、红=失败、石板灰=无/未知、
青=分类、紫=集群）承担信息，而它们全部出自 `status-facts.js` 的同一张事实表。

**Antipatterns（真机抓到的，明令禁止）：**
- 彩虹徽章：一张卡上并排 6 枚同声量彩色 chip——每枚都在喊，结果一枚也没被读到。
- 同质填充语：19 张卡带同一句兜底文案——重复的文字是噪声，不是内容。
- 假承诺入口：CTA 全部写「可对话」，点进去一堵登录墙。
- 原样漏出的 markdown：`**粗体**` 与 `- 列表` 出现在气泡里。

## Colors

### 强调

| 令牌 | 浅色 | 暗色 | 用途 |
|---|---|---|---|
| `accent` | `#a6402f` | `#d98a77` | 主按钮底、选中态、链接、强调字 |
| `accent-strong` | `#8f3425` | `#e8a894` | 悬停加深 |
| `accent-soft` | `#c2604c` | `#b06a58` | 次级强调 |
| `accent-wash` | `#f6eae7` | `#2a1512` | 强调区淡底 |

暗色档提亮是刻意的：近黑背景上 `#a6402f` 对比度不足，提亮后实心控件才保得住可读性。
**令牌定义在 `index.css` 的 `@theme`，暗色档走 `prefers-color-scheme`，不支持 `.dark` 类切换。**

### 中性（Tailwind slate）

页面 `slate-50` / `slate-950`；卡片 `white` / `slate-900`；边框 `slate-200` / `slate-800`；
正文 `slate-900` / `slate-100`；元信息 `slate-500`/`slate-400`；极弱 `slate-400`。

### 状态语义（仅出自七事实表）

`已暂停` 琥珀 · `状态未知` 石板 · `持续失败` 红 · `部分失败` 琥珀 · `该跑没跑` 橙 ·
`尚无调用` 石板 · `在役` 绿。**任何界面不得自造第八种状态，也不得在同一实体的同一位置并列两枚。**

### 分类信号（唯一一个，不叠加）

分类 `sky` · 集群 `violet` · 精选 `amber`（★）。一张卡最多带一个。

## Typography

三族，各司其职，不混用：

- **sans**（系统栈，含 CJK 回退）：全部人读文字。
- **mono**：slug、调用键、A2A 路由、代码块、token 数字。**判据：机器会不会写出这个字符串。**
- **seal 宋体**：只有 `SiteMark` 的方章用。

尺度只有三档：14px 正文、12px 元信息、11px 微标。页标题 `text-xl`（控制台）/ `text-2xl`（首屏 hero）。
**不引入 clamp 流体排版**（Operate 面固定 DPI 阅读）。

## Layout

- 单容器 `max-w-5xl`，`px-4`，`py-6` 主区。
- 卡片网格 `grid gap-4 sm:grid-cols-2 lg:grid-cols-3`。
- 控制台管理面板走右侧抽屉（`max-w-xl`），一次只开一个。
- 响应式是结构性的（列数、抽屉、折叠），不是字号缩放。

## Elevation & Depth

**无阴影是默认。** 层次来自三件东西：1px 边框（`slate-200`/`slate-800`）、底色差（卡片白 vs 页面
slate-50）、留白。全站唯一允许的阴影是抽屉面板与 toast——它们**浮在内容之上**，物理上必须分离。

圆角四档：`full`（chip/徽标）、`md`（控件）、`lg`（面板小节）、`xl`（卡片）。章节记号 5px。

## Components

- **主按钮**：`bg-accent text-white rounded-md px-3 py-2 text-sm`；禁用 `disabled:opacity-40`。
- **次按钮**：`border border-slate-300 dark:border-slate-700 rounded-md`，悬停转浅底。
- **面板**：`rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4`。
- **徽标**：`text-xs px-1.5 py-0.5 rounded` + 分类色；只有主状态徽标可用实心强调。
- **输入**：`rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm`；
  焦点态当前依赖浏览器默认——**改界面时应补 `focus-visible` 环（`accent` 2px）**，这是已知缺口。
- **加载**：skeleton（`animate-pulse`）不是转圈；错误就地横幅，不弹窗。
- **空态**：说清单身是什么状态（「尚无调用」），不写「暂无数据」。
- **代码块**（对话气泡内）：`rounded-lg bg-slate-100 dark:bg-slate-800 font-mono text-xs` +
  `overflow-x-auto`，横向滚动**在气泡内**，不撑破布局。

## Do's and Don'ts

**Do**
- 数字用 mono，人读文字用 sans。
- 一枚主徽标；其余信号降为文本或次级色。
- 强调红出现在动作与当前位置上，其余地方忍住。
- 明暗双模都要看一遍；新颜色必须同时给出两档。
- 对比度按 craft floor：正文与占位 ≥4.5:1，大字 ≥3:1。

**Don't**
- 不新增第五档字号、第三种字体族。
- 不用彩虹徽章堆信息。
- 不给卡片加装饰阴影或渐变文字。
- 不用 emoji 当图标（`SiteMark` 与 `★` 是既有例外）。
- 不为「显得完整」补填充文案——**空白是诚实的信息**。
