# 品类—篇幅—时代参数校准 — 压力测试结果

- 用例：6
- 通过：6
- 通过率：100%
- 诱饵全通过：是
- 阶段结论：通过
- 评测方式：独立 sub-agent 盲测；评测器看不到 type、expected_behavior 和 notes。

| 用例 | 类型 | 盲测选择 | 判定 | 理由 |
|---|---|---|---|---|
| should-trigger-01 | should_trigger | fanqie-genre-length-calibration | 通过 | 用户要把短剧式通用模板迁移到300章四合院长篇，涉及品类、篇幅和时代参数的系统校准。 |
| should-trigger-02 | should_trigger | fanqie-genre-length-calibration | 通过 | 问题明确询问短故事的场景规则能否直接迁移到百万字小说，属于篇幅错配与规则迁移检查。 |
| should-trigger-03 | should_trigger | fanqie-genre-length-calibration | 通过 | 请求直接要求为长篇历史职场连载而非短篇惊悚校准节奏和质量权重，完整匹配品类与篇幅参数设置。 |
| should-not-trigger-01 | should_not_trigger | fanqie-topic-promise | 通过 | 用户处于开书选题阶段，要比较题材与自身经验及长线续航的匹配度，优先做作者能力轴和读者续航轴取舍。 |
| should-not-trigger-02 | should_not_trigger | fanqie-pace-triad | 通过 | 用户只诊断具体一章的信息过载，属于章节级信息负荷问题，不需要调整全书品类或篇幅基准。 |
| edge-01 | edge_case | fanqie-topic-promise | 通过 | 作品尚未决定男频或女频，当前首先是开书定位与目标读者取舍；品类参数校准应在阅读承诺初步确定后进行。 |

## 失败分析

无失败用例。触发、同包诱饵和边界场景均符合预期。
