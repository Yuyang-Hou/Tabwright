# 营销增长

| 操作 | 用途 | 输入 | 安全 |
| --- | --- | --- | --- |
| `invite-code-list` | 查询邀请码列表 | params 可选 | 只读 |
| `invite-code-change-status` | 上下线邀请码 | data: JSON 请求体 | 写入确认 |
| `invite-code-quota-config` | 配置邀请码限额 | data: JSON 请求体 | 写入确认 |
| `invite-code-quota-cancel` | 取消邀请码限额 | data: JSON 请求体 | 写入确认 |
| `invite-code-export` | 导出邀请码数据 | params 可选 | 只读 |
| `reach-strategy-list` | 查询触达策略列表 | params 可选 | 只读 |
| `reach-strategy-detail` | 查询触达策略详情 | params: id | 只读 |
| `reach-strategy-create` | 创建触达策略 | data: JSON 请求体 | 写入确认 |
| `reach-strategy-update` | 更新触达策略 | data: JSON 请求体 | 写入确认 |
| `reach-strategy-toggle` | 启用或禁用触达策略 | params: id, enable | 写入确认 |
| `reach-strategy-delete` | 删除触达策略 | params: id | 写入确认 |
| `reach-strategy-push-template-list` | 查询触达 Push 模板 | params: bizId | 只读 |
| `reach-strategy-sms-template-list` | 查询触达短信模板 | params 可选 | 只读 |
| `yearly-vote-activity-list` | 查询年度打榜活动 | params 可选 | 只读 |
| `yearly-vote-activity-create` | 创建年度打榜活动 | data: JSON 请求体 | 写入确认 |
| `yearly-vote-activity-update` | 更新年度打榜活动 | data: JSON 请求体 | 写入确认 |
| `yearly-vote-activity-delete` | 删除年度打榜活动 | params: id | 写入确认 |
| `yearly-vote-topic-list` | 查询年度打榜话题 | params 可选 | 只读 |
| `yearly-vote-topic-create` | 创建年度打榜话题 | data: JSON 请求体 | 写入确认 |
| `yearly-vote-topic-update` | 更新年度打榜话题 | data: JSON 请求体 | 写入确认 |
| `yearly-vote-topic-delete` | 删除年度打榜话题 | params: id | 写入确认 |
| `yearly-vote-candidate-list` | 查询年度打榜候选项 | params 可选 | 只读 |
| `yearly-vote-candidate-create` | 创建年度打榜候选项 | data: JSON 请求体 | 写入确认 |
| `yearly-vote-candidate-update` | 更新年度打榜候选项 | data: JSON 请求体 | 写入确认 |
| `yearly-vote-candidate-delete` | 删除年度打榜候选项 | params: id | 写入确认 |
| `yearly-vote-video-list` | 查询年度打榜可用转码视频 | params 可选 | 只读 |
| `experiment-tag-list` | 查询实验标签列表 | params 可选 | 只读 |
| `experiment-tag-detail` | 查询实验标签详情 | params: tagId | 只读 |
| `experiment-tag-create` | 创建实验标签 | data: JSON 请求体 | 写入确认 |
| `experiment-tag-update-tag` | 更新实验标签 | data: JSON 请求体 | 写入确认 |
| `experiment-tag-assign` | 为标签分配实验 | data: JSON 请求体 | 写入确认 |
| `experiment-tag-update-experiment` | 更新标签实验配置 | data: JSON 请求体 | 写入确认 |
| `experiment-tag-close` | 关闭实验标签 | params: tagId | 写入确认 |
| `experiment-tag-cleanup` | 清理实验标签 | params: tagId | 写入确认 |
| `coupon-trigger-rule-list` | 查询优惠券触发规则 | params 可选 | 只读 |
| `coupon-trigger-rule-detail` | 查询优惠券触发规则详情 | params: id | 只读 |
| `coupon-trigger-rule-operation-log-list` | 查询优惠券触发规则操作日志 | params 可选 | 只读 |
| `coupon-trigger-rule-create` | 创建优惠券触发规则 | data: JSON 请求体 | 写入确认 |
| `coupon-trigger-rule-update` | 更新优惠券触发规则 | data: JSON 请求体 | 写入确认 |
| `coupon-trigger-rule-delete` | 删除优惠券触发规则 | params: id | 写入确认 |
| `coupon-trigger-rule-toggle` | 启用或禁用优惠券触发规则 | params: id, enable | 写入确认 |
| `coupon-trigger-rule-reorder` | 调整优惠券触发规则排序 | data: JSON 请求体 | 写入确认 |
| `keyfrom-quota-list` | 查询 Keyfrom 限额 | params 可选 | 只读 |
| `keyfrom-quota-create` | 创建 Keyfrom 限额 | data: JSON 请求体 | 写入确认 |
| `keyfrom-quota-update` | 更新并清零 Keyfrom 限额 | data: JSON 请求体 | 写入确认 |
| `keyfrom-quota-online` | 上线并清零 Keyfrom 限额 | data: JSON 请求体 | 写入确认 |
| `keyfrom-quota-offline` | 下线 Keyfrom 限额 | data: JSON 请求体 | 写入确认 |
| `agent-reply-turn-list` | 查询 AI 回复状态 | params 可选 | 只读 |
| `agent-reply-turn-mark-succeeded` | 按会话标记 AI 回复成功 | params: imChatId | 写入确认 |
| `agent-reply-turn-im-chat-detail` | 查询企微 Agent 会话详情 | params: chatId | 只读 |
| `agent-reply-turn-im-chat-messages` | 查询企微 Agent 会话消息 | params: chatId | 只读 |

将筛选和分页字段放在 `params`，将前端 service 对应请求对象放在 `data`。写操作先按主 Skill 的安全流程回读、预览并确认。
