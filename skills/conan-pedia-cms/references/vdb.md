# 向量知识库

| Action | 用途 | 输入 | 安全 |
| --- | --- | --- | --- |
| `vdb-knowledge-base-list` | 查询向量知识库 | params 可选 | 只读 |
| `vdb-knowledge-base-detail` | 查询向量知识库详情 | params: id | 只读 |
| `vdb-knowledge-base-create` | 创建向量知识库 | data: JSON 请求体 | 写入确认 |
| `vdb-knowledge-base-update` | 更新向量知识库 | params: id；data: JSON 请求体 | 写入确认 |
| `vdb-knowledge-base-delete` | 删除向量知识库 | params: id | 写入确认 |
| `vdb-document-list` | 查询知识库文档 | params: kbId | 只读 |
| `vdb-document-detail` | 查询知识库文档详情 | params: kbId, docId | 只读 |
| `vdb-document-create-file` | 上传文件创建知识库文档 | params: kbId；data: JSON 请求体 | 写入确认 |
| `vdb-document-create-manual` | 手动创建知识库文档 | params: kbId；data: JSON 请求体 | 写入确认 |
| `vdb-document-update-file` | 更新文件型知识库文档 | params: kbId, docId；data: JSON 请求体 | 写入确认 |
| `vdb-document-update-manual` | 更新手动录入知识库文档 | params: kbId, docId；data: JSON 请求体 | 写入确认 |
| `vdb-document-delete` | 删除知识库文档 | params: kbId, docId | 写入确认 |
| `vdb-document-reprocess` | 重新处理知识库文档 | params: kbId, docId | 写入确认 |
| `vdb-chunk-list` | 查询知识库文档切片 | params: kbId, docId | 只读 |
| `vdb-debug-search` | 调试向量检索 | data: JSON 请求体 | 只读 |

将筛选和分页字段放在 `params`，将前端 service 对应请求对象放在 `data`。写操作先按主 Skill 的安全流程回读、预览并确认。
