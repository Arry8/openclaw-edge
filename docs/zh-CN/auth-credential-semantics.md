---
title: "认证凭据语义"
summary: "认证配置的凭据资格判定和解析语义规范"
read_when:
  - 处理认证配置解析或凭据路由相关工作时
  - 调试模型认证失败或配置优先级问题时
x-i18n:
  generated_at: "2026-02-03T08:15:00Z"
  model: human
  provider: human
  source_hash: d86d38fafa18bbdc6892fc54a0f32b19ab33df8898206796aaecb9a9967aeaa5
  source_path: auth-credential-semantics.md
  workflow: 15
---

# 认证凭据语义

本文档定义了以下模块中使用的凭据资格判定和解析语义规范：

- `resolveAuthProfileOrder`
- `resolveApiKeyForProfile`
- `models status --probe`
- `doctor-auth`

其目标是保持选择阶段和运行时行为的一致性。

## 稳定的原因码

- `ok`
- `missing_credential`
- `invalid_expires`
- `expired`
- `unresolved_ref`

## Token 凭据

Token 凭据（`type: "token"`）支持内联 `token` 和/或 `tokenRef`。

### 资格判定规则

1. 当 `token` 和 `tokenRef` 均不存在时，该 Token 配置不合格。
2. `expires` 为可选字段。
3. 如果存在 `expires`，其值必须为大于 `0` 的有限数字。
4. 如果 `expires` 无效（`NaN`、`0`、负数、非有限数或类型错误），该配置不合格，原因码为 `invalid_expires`。
5. 如果 `expires` 已过期（值在过去），该配置不合格，原因码为 `expired`。
6. `tokenRef` 不会绕过 `expires` 的验证。

### 解析规则

1. 解析器对 `expires` 的语义与资格判定一致。
2. 对于合格的配置，Token 材料可从内联值或 `tokenRef` 中解析获取。
3. 无法解析的引用将在 `models status --probe` 输出中产生 `unresolved_ref`。

## 向后兼容的消息格式

为保持脚本兼容性，探测错误的第一行保持不变：

`Auth profile credentials are missing or expired.`

人类可读的详细信息和稳定的原因码可以在后续行中添加。
