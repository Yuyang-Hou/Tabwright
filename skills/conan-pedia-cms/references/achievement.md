# 成就体系

| Action | 用途 | 输入 | 安全 |
| --- | --- | --- | --- |
| `medal-config-list` | 查询勋章配置 | params 可选 | 只读 |
| `medal-config-detail` | 查询勋章配置详情 | params: id | 只读 |
| `medal-config-create` | 创建勋章配置 | data: JSON 请求体 | 写入确认 |
| `medal-config-update` | 更新勋章配置 | data: JSON 请求体 | 写入确认 |
| `medal-config-delete` | 删除勋章配置 | params: id | 写入确认 |

将筛选和分页字段放在 `params`，将前端 service 对应请求对象放在 `data`。写操作先按主 Skill 的安全流程回读、预览并确认。
