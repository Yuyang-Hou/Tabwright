# 硬件管理

| Action | 用途 | 输入 | 安全 |
| --- | --- | --- | --- |
| `explore-task-activity-list` | 查询探索活动列表 | params 可选 | 只读 |
| `explore-task-activity-detail` | 查询探索活动详情 | params: id | 只读 |
| `explore-task-activity-create` | 创建探索活动 | data: JSON 请求体 | 写入确认 |
| `explore-task-activity-update` | 更新探索活动 | data: JSON 请求体 | 写入确认 |
| `explore-task-activity-delete` | 删除探索活动 | params: id | 写入确认 |
| `explore-task-activity-reorder` | 调整探索活动排序 | data: JSON 请求体 | 写入确认 |
| `explore-task-sub-task-create` | 创建探索子任务 | data: JSON 请求体 | 写入确认 |
| `explore-task-sub-task-update` | 更新探索子任务 | data: JSON 请求体 | 写入确认 |
| `explore-task-sub-task-delete` | 删除探索子任务 | params: id | 写入确认 |
| `explore-task-sub-task-reorder` | 调整探索子任务排序 | data: JSON 请求体 | 写入确认 |

将筛选和分页字段放在 `params`，将前端 service 对应请求对象放在 `data`。写操作先按主 Skill 的安全流程回读、预览并确认。
