---
name: Bug 报告
about: 报告可复现的问题
title: "[Bug] "
labels: bug
body:
  - type: markdown
    attributes:
      value: |
        感谢报告 Bug！请尽量填写以下信息，帮助我们快速定位。
  - type: textarea
    id: description
    attributes:
      label: Bug 描述
      description: 简述发生了什么问题
    validations:
      required: true
  - type: textarea
    id: reproduce
    attributes:
      label: 复现步骤
      description: 详细步骤，让我们能复现
      placeholder: |
        1. 进入 ...
        2. 点击 ...
        3. 看到 ...
    validations:
      required: true
  - type: textarea
    id: expected
    attributes:
      label: 期望行为
    validations:
      required: true
  - type: textarea
    id: actual
    attributes:
      label: 实际行为
    validations:
      required: true
  - type: textarea
    id: screenshots
    attributes:
      label: 截图 / 录屏
      description: 如有请附上
  - type: input
    id: env
    attributes:
      label: 环境
      description: 操作系统 + 浏览器 + 版本
      placeholder: Windows 11 + Chrome 130
    validations:
      required: true
  - type: input
    id: version
    attributes:
      label: 项目版本 / Commit
      placeholder: main @ <commit-sha>
    validations:
      required: true
  - type: textarea
    id: logs
    attributes:
      label: 相关日志
      description: 浏览器 Console / 服务端 stderr
      render: shell
  - type: textarea
    id: context
    attributes:
      label: 补充信息
