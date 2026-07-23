# 故事发动机与五要素主线契约 — 压力测试结果

- 用例：6
- 通过：6
- 通过率：100%
- 诱饵全通过：是
- 阶段结论：通过
- 评测方式：独立 sub-agent 盲测；评测器看不到 type、expected_behavior 和 notes。

| 用例 | 类型 | 盲测选择 | 判定 | 理由 |
|---|---|---|---|---|
| should-trigger-01 | should_trigger | fanqie-story-engine-contract | 通过 | 万能维修只是能力设定，二十章后事件变成重复换设备，正是只有能力没有可持续故事发动机的症状。 |
| should-trigger-02 | should_trigger | fanqie-story-engine-contract | 通过 | 设定很多但长期目标、对抗者职责和一句话主线均不清楚，核心缺口是五要素主线契约。 |
| should-trigger-03 | should_trigger | fanqie-story-engine-contract | 通过 | 用户明确要把高概念能力从一次性噱头变成可持续的story engine，直接对应本技能主责。 |
| should-not-trigger-01 | should_not_trigger | 无 | 通过 | 请求仅是缩短并润色已有简介，没有暴露主线或故事发动机问题。 |
| should-not-trigger-02 | should_not_trigger | fanqie-longform-rolling-outline | 通过 | 主线已经确认，需求转为十卷目标和近期30章章纲，是已有契约后的长篇分层规划。 |
| edge-01 | edge_case | 无 | 通过 | 这句话只是说明短故事篇幅和单次反转，并未提出发动机、主线或可持续生长方面的诊断需求；短篇也不天然需要长篇故事发动机。 |

## 失败分析

无失败用例。触发、同包诱饵和边界场景均符合预期。
