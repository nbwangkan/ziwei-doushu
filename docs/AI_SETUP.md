# 在自己的副本中启用 AI 解读

本副本补齐了 `/api/interpret`：把排盘结构和提问交给模型服务，将回答逐段显示在页面上。
这是新增的独立实现，不包含原作者官网的私有断语库、AI 提示词或用户系统。

## 第一次使用（Codespaces）

1. 在 GitHub 合并本次修改后，回到 Codespaces；在左下角终端按 Control+C 停止开发服务器。
2. 输入 `git pull --ff-only`，获取已合并的代码。若提示本地文件冲突，保留现场，不要使用强制覆盖。
3. 左侧找到 `.env.example`，复制一份并命名为 `.env.local`。
4. 在 `.env.local` 中填写你自己的模型服务配置。默认 DeepSeek：

```dotenv
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=在这里填写你自己的密钥
DEEPSEEK_MODEL=deepseek-flash
```

DeepSeek 官方 API 文档：https://api-docs.deepseek.com/
API 密钥入口：https://platform.deepseek.com/api_keys

模型 API 按服务商规则计费。网页聊天账号和 API 调用凭证是不同用途的配置。
把密钥直接填写在你自己的 Codespaces 文件中，不要发在聊天、截图或公开仓库里。
`.env.local` 已被本项目的 `.gitignore` 排除。

5. 运行 `npm run dev`，从端口 3000 的“在浏览器中打开”进入页面。
6. 重新排盘，点击“生成命格解读”或一个主题按钮。页面加载时不会自动发起付费模型请求。
7. 若仍显示旧的“开源版不含接口”，刷新网页，并确认代码已同步、开发服务器已重启。

只使用排盘功能可以不配置密钥。未配置时，AI 按钮会显示具体缺少哪项配置。

## 换成其他兼容服务

```dotenv
AI_PROVIDER=compatible
AI_API_KEY=你自己的密钥
AI_BASE_URL=https://服务商给你的API地址/v1
AI_MODEL=服务商提供的模型名称
```

这里的服务地址是 API 地址，不是聊天网页的网址。需要支持 Chat Completions 和 SSE 流式输出。
也兼容原有 `AI_PROVIDER=mimo`、`MIMO_API_KEY`、`MIMO_BASE_URL` 和 `MIMO_MODEL` 配置。

## 常见提示

| 提示 | 下一步 |
| --- | --- |
| 尚未配置密钥 | 填写 .env.local 并重启开发服务器 |
| 密钥或权限被拒绝 | 检查密钥、所属项目与模型访问权限 |
| 余额不足 | 到服务商 API 平台查看余额 |
| 请求频繁或额度用完 | 稍后重试，并检查 API 额度 |
| 服务地址、模型或参数不匹配 | 核对 API 地址和模型名称 |
| 响应中断或未完整生成 | 缩小问题后重试；不会把半段输出当作完整成功 |

## 使用范围和数据

当前适用于自己的私有 Codespaces 预览。接口尚未包含登录校验或生产环境的限流措施；
若准备公开提供服务，需要先增加这些能力。

请求会向你配置的模型服务发送十二宫、星曜、四化、运限、年龄、性别和对话。
接口不会转发姓名或出生地文本，但命盘仍可能包含个人信息。
返回内容是模型生成的传统术数分析，不是原作者的私有批文，也不承诺预测准确。
没有可靠出处时，提示词要求模型不冒充倪海厦或古籍原话。

## 自动检查（不调用真实模型、不使用密钥）

```bash
npm run typecheck
npm run test:ai
npm test
```

测试使用模拟模型响应，覆盖参数校验、缺少密钥、上游错误、中文分片、流中断和前后端响应格式。
