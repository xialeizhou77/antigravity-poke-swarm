# Poke Swarm HUD

宝可梦风格的 Google Antigravity 蜂群（Swarm）实时监控看板插件。

## 功能特性

- **10 款内联矢量 SVG 宝可梦化身**：自动按成员角色匹配喷火龙（Coordinator + 皇冠徽章）、洛托姆（Monitor）、伊布（UI/前端）、耿鬼（核心/后端）、皮卡丘（文档/测试）、妙蛙种子、杰尼龟、胖丁、卡比兽与路卡利欧，全部采用内联高精度矢量 SVG，无需外网 CDN，并支持点击头像随时自定义更换。
- **双色环形指标**：头像外圈以双色圆弧直观展示「左环：上下文窗口占用率」与「右环：模型配额剩余」（未连接本地服务时自动回退为「消息板同步率」）。
- **实时动作与推理气泡**：读取各成员 `transcript.jsonl`，在头像上方展示当前工具调用（如 `swarm`、`read_file`）或思考推理标题。
- **皮肤颜色双重自适应**：自动跟随 Antigravity 宿主明暗主题及配色变量（卡片、气泡、圆环底轨与文本对比度自适应），同时成员卡片、悬停光晕及详情徽章会呼应所选宝可梦皮肤主色。
- **单行紧凑胶囊与一键跳转**：保持单行横向排列并在超出宽度时支持无滚动条平滑滑动与边缘渐隐提示，点击成员名称可一键跳转对应会话，也可通过顶部下拉框切换查看本机其它历史 Swarm。

## 安装方式

将本插件克隆到 Antigravity 全局插件目录即可自动被识别并启用：

```bash
git clone https://github.com/xialeizhou77/antigravity-poke-swarm.git ~/.gemini/config/plugins/poke-swarm
```

如需更新插件，在插件目录执行 `git pull` 后在 Antigravity 插件管理页重新开关即可。

## 使用方式

1. 在 Antigravity 对话中发送 `/poke-swarm` 或提示“打开宝可梦蜂群看板”；
2. 或直接点击技能提供的 Sidecar 快捷链接打开辅助侧边栏：

   `[Poke Swarm 看板](sidecar://poke-swarm/poke_swarm/)`

3. 点击任意宝可梦头像即可弹出皮肤切换面板并持久化保存；点击成员名称或详情列表中的「进入对话」即可直达对应子智能体会话。

## 目录结构

```text
poke-swarm/
├── plugin.json                      # Antigravity 插件清单
├── README.md                        # 说明文档
├── LICENSE                          # MIT 开源协议
├── .gitignore
├── assets/
│   └── logo.svg                     # 插件图标
├── skills/
│   └── poke-swarm/
│       └── SKILL.md                 # 对话触发技能定义
└── sidecars/
    └── poke_swarm/
        ├── sidecar.json             # Sidecar 运行配置与辅助侧边栏入口
        ├── package.json             # Sidecar 包描述与测试脚本
        ├── main.mjs                 # Sidecar HTTP 服务入口
        ├── swarm_data.mjs           # Swarm 成员、消息板与配额聚合模块
        ├── swarm_data.test.mjs      # 单元测试
        ├── pokemon.js               # 宝可梦 SVG 绘制与角色匹配引擎
        ├── index.html               # 看板页面结构
        ├── styles.css               # 宿主皮肤自适应与宝可梦视觉样式
        └── app.js                   # 前端轮询、主题同步与交互逻辑
```

## 本地开发与测试

本插件零第三方运行时依赖，直接基于 Node.js 内置能力与 Antigravity Sidecar SDK 运行：

```bash
cd sidecars/poke_swarm
npm test
```

## 开源协议

本项目基于 [MIT License](LICENSE) 开源。
