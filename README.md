# Codex 重置雷达

一个适合部署到 GitHub Pages 的中文小项目：观察未来 48 小时是否存在 **Codex 临时全局重置** 的公开信号。页面展示排期、最近确认的重置、相关服务事件，以及每项判断的来源。

> 独立项目，与 OpenAI 无关联。页面的「线索指数」是透明的规则分数，**不是统计概率**，也不能读取或预测任何个人账号的真实剩余额度。

## 运行

不需要安装前端依赖：

```bash
python -m http.server 8000 --directory site
```

打开 <http://localhost:8000>。仓库内的 `site/data/snapshot.json` 是 2026-09-29 的初始快照；若未自动更新，页面会在 6 小时后标记数据过期。

有网络时，可手动刷新快照：

```bash
python scripts/update_snapshot.py
```

运行核心逻辑与数据处理测试：

```bash
node tests/forecast.test.mjs
python -m unittest discover -s tests
```

## 数据从哪里来

- [Did Codex Reset 开放 API](https://didcodexreset.com/zh/api.html)：公开排期及已确认重置。每次刷新调用两个只读接口；该 API 限流为每小时 20 次。
- [OpenAI Status](https://status.openai.com/)：服务状态与事件，只作为弱背景信号。

脚本不读取 Codex 登录态，也不需要 OpenAI API Key。浏览器只读取本站同源的 `snapshot.json`，不会让每个访客分别调用第三方 API。抓取失败时部署停止，现有站点保留上次快照并显示过期提示。

## 线索指数

| 规则 | 分数 |
| --- | ---: |
| 没有覆盖未来 48 小时的公开排期 | 10 分起 |
| 明确公开排期 | 80 分起 |
| 从公开内容推断出的排期 | 65 分起 |
| 排期精确到时刻 | +8 |
| 排期跨度超过 72 小时 | −5 |
| 无排期且最近 48 小时已确认重置 | −6 |
| 无排期且 Codex / Work 服务事件未解决 | +5 |

最后两条只在没有公开排期时计入；所有分数限制在 0–95。分数表达证据强弱，并没有用历史结果做概率校准。服务故障不意味着 OpenAI 会发放重置；安静的日子也不意味着重置“到期”。排期可能变化，完成记录也可能晚于实际到账。

个人账号的 5 小时及每周用量窗口是另一回事。实际剩余额度和重置时间以 [OpenAI 用量页面](https://chatgpt.com/codex/settings/usage) 或 Codex CLI 的 `/status` 为准；[官方用量说明](https://learn.chatgpt.com/docs/pricing)说明了不同任务和模型的耗额差异。

## 发布到 GitHub Pages

1. 将仓库推送到 GitHub 的 `main` 分支。
2. 在仓库 **Settings → Pages → Build and deployment** 中选择 **GitHub Actions**。
3. 工作流会在推送、手动触发及约每两小时的计划任务时抓取数据并部署。GitHub 的计划任务可能延迟；页面会显示快照时间与过期状态。

工作流位于 [`.github/workflows/pages.yml`](.github/workflows/pages.yml)。Pages 部署使用 GitHub 官方的 [自定义工作流方式](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。

## 项目结构

```text
site/                     静态网页和部署产物
  assets/forecast.mjs      纯函数预测规则
  assets/app.mjs           页面渲染
  data/snapshot.json       初始快照；部署时刷新
scripts/update_snapshot.py 公开数据抓取与格式校验
tests/                    预测规则与快照处理测试
```

界面方向参考 [Did Codex Reset](https://didcodexreset.com/zh.html) 和 [Will Codex Reset?](https://www.willcodexquotareset.com/)，但本项目独立实现页面与规则，并对公开数据来源保留链接。
