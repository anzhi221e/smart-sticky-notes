# Bug Report: PWA 窄屏自适应问题

**日期**: 2026-06-26  
**环境**: Windows 11, Chrome 安装版 PWA (`display: standalone`)  
**部署**: Vercel (`smartstickynotes.vercel.app`), 源仓库 `anzhi221e/smart-sticky-notes-dev`

---

## Bug 1: 安装版 PWA 窗口最小宽度无法缩小到合理范围

**严重程度**: 高  
**状态**: 未解决

### 现象
安装版 PWA 窗口拖拽到最窄时约 500px，无法进一步缩小。用户期望能缩到当前最小宽度的 60%（约 300px）。

### 分析
- Chrome 桌面版 PWA (`display: standalone`) 对窗口有内部最小宽度限制
- CSS 的 `min-width: 0` 链 + `contain: inline-size` 已配置在 `html > body > #app > .screen > .top-bar` 全链路
- 但 Chrome 可能基于 viewport meta 标签 (`width=device-width, user-scalable=no`) 或自身启发式算法决定窗口最小值
- 当前响应式断点为 600→500→400→340→280→240，但 600/500 断点的视觉变化不够明显

### 涉及文件
- `pwa/css/app.css` — `#app` 的 `contain: inline-size`, `min-width: 0` 链
- `pwa/index.html` — viewport meta 标签 `user-scalable=no`（可能是干扰因素）
- `pwa/manifest.json` — `display: standalone`

### 已尝试的修复
| 尝试 | 结果 |
|------|------|
| 添加 `min-width: 0` 到 html, body, #app, .screen, .top-bar | 未解决 |
| 添加 `contain: inline-size` 到 #app | 未解决 |
| 添加 600px/500px 响应式断点 | 未解决（变化太细微）|
| 升级 Service Worker 缓存 v2→v3 | 解决了缓存问题，但宽度问题依旧 |

---

## Bug 2: 顶部 Top Bar 排列拥挤/溢出

**严重程度**: 中  
**状态**: 未解决

### 现象
top bar 包含 7 个控件：菜单按钮、工作区切换、搜索框、日历、刷新、置底（select-mode 默认隐藏）。在窄窗口下控件排列拥挤，部分可能溢出或被裁剪。

### 根因分析
```css
.top-bar {
    display: flex;
    justify-content: space-between;  /* 分散排列 */
    /* 缺少 flex-wrap: wrap 或 overflow-x: auto */
}

.icon-btn {
    flex-shrink: 0;  /* 不收缩 — 强制占满 40px */
    width: 40px;
}

#search-input {
    flex: 0 1 160px;  /* 唯一可收缩的元素 */
}
```

- 6 个 `flex-shrink: 0` 的按钮（各 40px）+ workspace toggle（~72px）+ 搜索框 = 默认 312px+ 不可压缩内容
- 搜索框是唯一有 `flex-shrink: 1` 的元素，承担所有收缩压力
- 搜索框缩到 0 后，剩余控件仍占 ~272px，此时开始溢出
- `justify-content: space-between` 不会让元素换行
- 缺少 `gap` 属性控制间距
- 600px/500px 断点将按钮从 40→38→36px，节省的空间有限（总计约 24px）

### 涉及文件
- `pwa/css/app.css` 行 43-63（top bar 基础样式）
- `pwa/css/app.css` 行 596-663（响应式断点）

---

## Bug 3: 侧边栏菜单内容被裁剪

**严重程度**: 中  
**状态**: 未解决

### 现象
打开侧边栏（汉堡菜单）后，"对话管理"、"标签"、"日历"、"回收站"、"设置" 等菜单项在窄屏下可能显示不全或被截断。

### 根因分析
- 侧边栏使用 `position: fixed; width: 280px`，以覆盖层形式展示
- 在窄视口（如 500px）下，260-280px 的侧边栏覆盖了大半内容区域
- 这不是 "裁剪" 而是覆盖——但用户感知为内容被遮挡
- `.nav-item` 的字体在 500px 断点为 14px，400px 为 14px，340px 才降到 13px——变化不够激进
- `.sidebar-header h2` 从默认 17px → 16px → 15px → 14px 逐步缩小，但缩小幅度小
- `.sidebar { max-width: 100vw }` 确保侧边栏不超出视口，但内部内容可能溢出

### 涉及文件
- `pwa/css/app.css` 行 166-182（侧边栏基础样式）
- `pwa/css/app.css` 行 600-655（响应式断点中的侧边栏规则）

---

## Bug 4: 无痕模式下多彩主题不加载

**严重程度**: 低  
**状态**: 部分修复

### 现象
Chrome 无痕窗口打开 PWA 时，多彩主题颜色不显示，回退到默认暗色主题。

### 根因分析
- 主题通过 `localStorage.getItem('ssn-theme')` 读取，无痕模式下返回 null
- `applyTheme(null || 'blue-light')` 理论上应回退到 blue-light
- 但 `applyTheme` 函数通过 JS 动态设置 `--bg`, `--surface`, `--accent` 等 CSS 变量
- 如果 JS 加载失败或执行时序有问题，CSS 变量不会被设置
- 已在 `:root` 添加了 `--bubble-bg` 和 `--bubble-text` 的 CSS 默认值，但其他颜色变量（`--bg`, `--surface` 等）已有硬编码暗色默认值，这部分应该不受影响

### 已修复
- `:root` 中新增 `--bubble-bg: var(--surface)` 和 `--bubble-text: var(--text)` 作为 CSS 层面的回退

### 待确认
- 需要确认无痕模式下 JS 是否正常执行（可能被扩展程序阻止）

### 涉及文件
- `pwa/js/ui.js` 行 162-178（`applyTheme` 函数）
- `pwa/js/app.js` 行 46（初始化主题调用）
- `pwa/css/app.css` 行 14-15（`--bubble-bg` / `--bubble-text` 默认值）

---

## 已部署的 CSS 修改摘要

以下修改已在 Vercel 生产环境 (`smartstickynotes.vercel.app`) 生效：

1. `html, body` — 添加 `min-width: 0`
2. `#app` — 添加 `min-width: 0; contain: inline-size`
3. `.screen` — 添加 `min-width: 0`
4. `.top-bar` — 添加 `min-width: 0`
5. `:root` — 添加 `--bubble-bg` / `--bubble-text` 默认值
6. `.sidebar-header h2` — 添加 `font-size: 17px` 基础规则
7. 响应式断点（文件末尾，由宽到窄排列）：
   - 600px: 按钮 38px, 侧边栏 260px, 搜索 120px
   - 500px: 按钮 36px, 侧边栏 250px, 搜索 80px
   - 400px: 侧边栏 230px, nav-item 14px
   - 340px: 按钮 34px, 侧边栏 210px, 搜索 48px
   - 280px: 按钮 28px, 侧边栏 240px, 搜索 36px
   - 240px: 按钮 24px, 搜索 28px
8. Service Worker 缓存名 v2→v3
9. `.sidebar { max-width: 100vw }` — 防止侧边栏超出视口

---

## 建议的下一步排查方向

1. **Chrome PWA 窗口最小宽度** — 需要确认 Chrome 版本的具体限制。可能需要在 Chrome 源码或文档中查找 PWA 窗口最小宽度的决定因素
2. **Top bar 布局重构** — 考虑将 top bar 改为 `flex-wrap: wrap` + `overflow-x: auto`，或使用 CSS Grid 替代 flexbox
3. **侧边栏模式改为推挤式** — 当前为覆盖式 (overlay)，可考虑推挤式 (push) 布局，避免内容被遮挡
4. **更激进的断点** — 在 600px 和 500px 断点处做更大幅度的缩小（例如按钮直降到 32px、搜索完全隐藏仅图标），让用户能感知到明显变化
