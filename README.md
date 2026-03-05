# Zotero Literature Review Plugin

[![zotero target version](https://img.shields.io/badge/Zotero-7-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)
[![license](https://img.shields.io/badge/License-AGPL--3.0-blue?style=flat-square)](LICENSE)

一款基于大语言模型（LLM）的 Zotero 7 文献综述插件。自动提取 Zotero 文献库中的元数据与 PDF 全文，利用 LLM 生成**单篇文献摘要**和**多篇文献综述**。

A Zotero 7 plugin that leverages Large Language Models (LLMs) to automatically generate **single-item summaries** and **multi-item literature reviews** from your Zotero library.

---

## 功能特性 / Features

- **单篇文献摘要**：右键选中一篇文献，自动提取全文并调用 LLM 生成结构化摘要，结果保存为该文献的子笔记。
- **多篇文献综述**：选中多篇文献，LLM 先逐篇摘要，再整合生成完整的文献综述笔记。
- **长文本分块处理（MapReduce）**：当文献全文超过模型上下文窗口时，自动分块摘要再合并，避免截断。
- **兼容 OpenAI 格式 API**：支持 OpenAI、DeepSeek、Ollama 等任意兼容 OpenAI Chat API 的服务。
- **可配置项丰富**：API 地址、密钥、模型名称、温度、最大 token、超时等均可在偏好设置中调整。
- **中英双语界面**：支持中文和英文两种语言。

---

## 安装 / Installation

### 从 Release 安装（推荐）

1. 前往 [Releases](../../releases) 页面下载最新的 `.xpi` 文件。
2. 在 Zotero 7 中，打开 `工具` → `附加组件`（Add-ons），点击齿轮图标 → `Install Add-on From File...`，选择下载的 `.xpi` 文件。

### 从源码构建

```bash
git clone https://github.com/YOUR_USERNAME/zotero-literature-review.git
cd zotero-literature-review
npm install
npm run build
```

构建产物位于 `.scaffold/build/` 目录，其中 `.xpi` 文件即为插件安装包。

---

## 使用方法 / Usage

### 1. 配置 LLM API

安装插件后，打开 Zotero → `编辑` → `设置` → `Literature Review`，填写以下信息：

| 设置项 | 说明 | 示例 |
|--------|------|------|
| API URL | OpenAI 兼容的 API 地址 | `https://api.openai.com/v1/chat/completions` |
| API Key | 你的 API 密钥 | `sk-...` |
| Model | 模型名称 | `gpt-4o`、`deepseek-chat` |
| Temperature | 生成温度（0-1000，实际值/1000） | `700`（即 0.7） |
| Max Tokens | 最大生成 token 数 | `4096` |
| Timeout | API 请求超时（秒） | `120` |

### 2. 生成单篇文献摘要

1. 在 Zotero 文献库中**右键点击**一篇文献条目。
2. 选择 **「生成文献总结」**。
3. 插件将提取 PDF 全文（或摘要），调用 LLM 生成摘要，并保存为该文献的**子笔记**。

### 3. 生成多篇文献综述

1. 在 Zotero 文献库中**选中多篇**文献条目。
2. **右键** → **「生成文献综述」**。
3. 插件将逐篇生成摘要，再综合所有摘要生成一篇完整的文献综述笔记。

---

## 技术架构 / Architecture

```
src/
├── index.ts                # 插件入口
├── addon.ts                # 插件生命周期管理
├── hooks.ts                # 事件钩子（菜单注册、偏好设置等）
└── modules/
    ├── llmService.ts       # LLM API 调用、MapReduce 分块摘要
    ├── reviewGenerator.ts  # 文献信息提取、全文获取、笔记生成
    └── preferenceScript.ts # 偏好设置脚本
```

### 核心流程

1. **元数据提取**：从 Zotero 条目中提取标题、作者、年份、期刊、摘要等。
2. **全文获取**：读取 PDF 附件的全文内容（通过 Zotero 内置的全文索引）。
3. **长文本分块**：若全文过长，按字符数切分为多个块（chunk）。
4. **MapReduce 摘要**：先对每个块生成部分摘要（Map），再将所有部分摘要合并为最终摘要（Reduce）。
5. **笔记创建**：将生成的摘要或综述保存为 Zotero 子笔记。

---

## 开发 / Development

### 环境要求

- [Node.js](https://nodejs.org/) (LTS)
- [Git](https://git-scm.com/)
- [Zotero 7](https://www.zotero.org/support/beta_builds)

### 开发流程

```bash
# 安装依赖
npm install

# 复制环境变量文件并配置 Zotero 路径
cp .env.example .env

# 启动开发服务器（自动编译 + 热重载）
npm start

# 生产构建
npm run build

# 代码检查
npm run lint:check

# 代码格式化
npm run lint:fix
```

---

## 贡献 / Contributing

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建你的特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add some amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

---

## 致谢 / Acknowledgements

- [Zotero Plugin Template](https://github.com/windingwind/zotero-plugin-template) - 插件模板框架
- [Zotero Plugin Toolkit](https://github.com/windingwind/zotero-plugin-toolkit) - 插件开发工具包
- [Zotero](https://www.zotero.org/) - 开源文献管理工具

---

## 许可证 / License

[AGPL-3.0](LICENSE)