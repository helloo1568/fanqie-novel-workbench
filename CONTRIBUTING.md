# 贡献指南

感谢参与长篇工坊。`main` 应始终可构建、可测试，并能在没有本机私有数据和知识包的干净环境中运行。

## 开始开发

需要 Node.js 20+ 和 pnpm 11+。Fork 并克隆仓库后运行：

```powershell
pnpm install
pnpm dev
```

打开 `http://127.0.0.1:5173`。开发模式同时启动 Fastify 3210 和 Vite 5173。

## 提交前检查

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm audit --prod --registry=https://registry.npmjs.org
```

E2E 测试应自包含，不依赖开发者本机的 `.data/`、小说或供应商密钥。测试使用独立端口和临时数据库，绝不能复用正在写作的生产数据。针对较小改动可以先运行相关用例，但 PR 合入前应通过完整 CI。

## 不得提交的内容

- `.data/` 中的数据库、`.secret-key`、日志和快照
- `.env`、API Key、访问令牌、私人供应商地址
- 小说正文、导出文件、用户截图和个人路径
- 课程提炼、书籍语料或其他没有明确再分发权利的材料
- Stitch/Figma 等设计工具的私有导出和访问凭据

`.codex/skills/` 中现有的番茄知识包属于产品核心。新增或修改知识包时，请同步更新检索测试；引入外部材料时仍需在 PR 中说明来源、许可证和再分发依据。

## 代码约定

- TypeScript 严格模式，避免未使用的变量和参数。
- React 使用函数组件和 hooks；共享交互优先复用现有组件。
- 保持桌面端工作流完整。本项目不以手机端适配为目标。
- API 改动应同步更新共享类型、错误处理和相关测试。
- AI 生成结果默认先成为候选，不得绕过审核直接覆盖正式正文。
- 数据迁移和恢复逻辑必须保留用户已有内容。

## 分支与提交

从最新 `main` 创建短分支，例如 `feat/chapter-target` 或 `fix/candidate-save`。提交信息遵循 Conventional Commits：

```text
feat(chapters): 支持单章字数目标
fix(planning): 恢复后台深度开书入口
docs(security): 说明本地密钥边界
```

PR 请说明动机、行为变化、验证命令和必要截图。较大功能应先提交设计说明或 Issue，明确数据迁移、失败恢复和测试范围。

## 安全问题

未修复的安全问题不要公开提交 Issue，请按 [SECURITY.md](SECURITY.md) 使用 GitHub 私密漏洞报告。

## 行为准则

讨论应聚焦事实、复现和可验证方案。批评代码和设计，不攻击参与者。
