# 内容体验

| 操作 | 用途 | 输入 | 安全 |
| --- | --- | --- | --- |
| `encyclopedia-tv-column-list` | 查询探索内容栏目 | params 可选 | 只读 |
| `encyclopedia-tv-column-create` | 创建探索内容栏目 | data: JSON 请求体 | 写入确认 |
| `encyclopedia-tv-column-update` | 更新探索内容栏目 | data: JSON 请求体 | 写入确认 |
| `encyclopedia-tv-column-reorder` | 调整探索内容栏目排序 | data: JSON 请求体 | 写入确认 |
| `encyclopedia-tv-column-update-status` | 更新探索内容栏目状态 | data: JSON 请求体 | 写入确认 |
| `encyclopedia-tv-column-delete` | 删除探索内容栏目 | data: JSON 请求体 | 写入确认 |
| `encyclopedia-tv-drama-list` | 查询探索内容剧集 | params 可选 | 只读 |
| `encyclopedia-tv-drama-create` | 创建探索内容剧集 | data: JSON 请求体 | 写入确认 |
| `encyclopedia-tv-drama-update` | 更新探索内容剧集 | data: JSON 请求体 | 写入确认 |
| `encyclopedia-tv-drama-update-status` | 更新探索内容剧集状态 | data: JSON 请求体 | 写入确认 |
| `encyclopedia-video-list` | 查询探索内容可用转码视频 | params 可选 | 只读 |

将筛选和分页字段放在 `params`，将前端 service 对应请求对象放在 `data`。写操作先按主 Skill 的安全流程回读、预览并确认。
