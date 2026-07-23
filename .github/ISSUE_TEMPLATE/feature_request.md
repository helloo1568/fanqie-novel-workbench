---
name: 功能建议
about: 提出新功能或改进建议
title: "[Feature] "
labels: enhancement
body:
  - type: textarea
    id: problem
    attributes:
      label: 解决的问题
      description: 你遇到什么场景下的痛点？
    validations:
      required: true
  - type: textarea
    id: solution
    attributes:
      label: 期望的方案
      description: 你希望产品怎么解决？描述交互流程或 API 设计
    validations:
      required: true
  - type: textarea
    id: alternatives
    attributes:
      label: 考虑过的替代方案
  - type: textarea
    id: scope
    attributes:
      label: 影响范围
      description: 涉及哪些模块（章节编辑 / 候选稿 / 上下文 / 质检 / 规划 / 设置 / 服务端 / 数据库）
  - type: textarea
    id: context
    attributes:
      label: 补充信息
