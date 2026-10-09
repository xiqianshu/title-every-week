# 依赖与 GitHub 调研

本项目编写自己的调度、记录、来源校验、内容生成、复盘、中文工作台和 Mac 安装入口，复用以下固定版本包。

| 项目 | 版本 | 许可证 | 用途 |
| --- | --- | --- | --- |
| [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) | 0.0.83 | Apache-2.0 | 默认 Chrome 扩展只读采集 |
| [openai/codex](https://github.com/openai/codex) | 0.161.0 | Apache-2.0 | 非交互执行及结构化报告 |
| [jackwener/opencli](https://github.com/jackwener/opencli) | 1.8.8 | Apache-2.0 | 可选抖音／小红书适配器 |
| [ourongxing/newsnow](https://github.com/ourongxing/newsnow) | 调研提交 `0f95b2c998dffbfd2ddbc51b47b5809887dc6b97` | MIT | 参考并改写公开热榜端点结构及百度／GitHub 解析思路，保留作者许可 |

依赖解析和校验值在 package-lock.json；npm ci 安装时不执行第三方生命周期脚本。分发包只包含本项目文件；依赖由 npm 在用户电脑安装，其自身的许可证和 NOTICE 随包安装。Apache-2.0 文本附在 licenses/Apache-2.0.txt。

另外考察了 xiaohongshu-mcp、MediaCrawler、n8n、social-workflow 类项目。未采用 MediaCrawler 带有限制的学习用途代码，未引入需要额外搭建 n8n 服务的方案，也没有用热榜冒充指定账号分析。

本轮另核查 [imsyy/DailyHotApi](https://github.com/imsyy/DailyHotApi)（提交 `36c77e3bd891c11642d314cfb229bf31646704de`，MIT）的公开热榜思路，未复制其代码。NewsNow 的 MIT 许可证随包附在 `licenses/NewsNow-MIT.txt`。无需安装 NewsNow 服务或新浏览器扩展。公开热榜接口失败时保留其他来源，不能用空列表伪装成功。

开源包存在不等于已完成实际平台验收；能力取决于正常登录、浏览器连接与平台可访问性。
