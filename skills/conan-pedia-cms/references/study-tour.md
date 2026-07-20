# 百科研学

| 操作 | 用途 | 输入 | 安全 |
| --- | --- | --- | --- |
| `study-tour-task-list` | 查询百科研学核销任务 | params 可选 | 只读 |
| `study-tour-task-precheck` | 预校验百科研学核销 | data: JSON 请求体 | 只读 |
| `study-tour-task-create` | 创建百科研学核销任务 | data: JSON 请求体 | 写入确认 |
| `study-tour-task-failures` | 查询百科研学核销失败明细 | params: taskId | 只读 |

将筛选和分页字段放在 `params`，将前端 service 对应请求对象放在 `data`。写操作先按主 Skill 的安全流程回读、预览并确认。
