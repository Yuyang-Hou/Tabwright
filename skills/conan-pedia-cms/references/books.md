# 图书

| Action | 用途 | 输入 | 安全 |
| --- | --- | --- | --- |
| `books-book-list` | 查询图书列表 | params 可选 | 只读 |
| `books-book-detail` | 查询图书详情 | params: id | 只读 |
| `books-book-create` | 创建图书 | data: JSON 请求体 | 写入确认 |
| `books-book-update` | 更新图书 | data: JSON 请求体 | 写入确认 |
| `books-book-delete` | 删除图书及其章节资源 | data: JSON 请求体 | 写入确认 |
| `books-chapter-list` | 查询图书章节 | params: bookId | 只读 |
| `books-chapter-book-info` | 查询章节页图书信息 | params: bookId | 只读 |
| `books-chapter-detail` | 查询章节详情 | params: id | 只读 |
| `books-chapter-create` | 批量创建图书章节 | data: JSON 请求体 | 写入确认 |
| `books-chapter-update` | 更新图书章节 | data: JSON 请求体 | 写入确认 |
| `books-chapter-reorder` | 调整图书章节排序 | data: JSON 请求体 | 写入确认 |
| `books-chapter-delete` | 删除图书章节 | data: JSON 请求体 | 写入确认 |
| `books-resource-list` | 查询章节资源 | params: chapterId | 只读 |
| `books-resource-chapter-info` | 查询资源页章节信息 | params: chapterId | 只读 |
| `books-resource-detail` | 查询图书资源详情 | params: id | 只读 |
| `books-resource-create` | 创建图书资源 | data: JSON 请求体 | 写入确认 |
| `books-resource-update` | 更新图书资源 | data: JSON 请求体 | 写入确认 |
| `books-resource-delete` | 删除图书资源 | data: JSON 请求体 | 写入确认 |

将筛选和分页字段放在 `params`，将前端 service 对应请求对象放在 `data`。写操作先按主 Skill 的安全流程回读、预览并确认。
