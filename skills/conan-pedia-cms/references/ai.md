# 百科AI

| 操作 | 用途 | 输入 | 安全 |
| --- | --- | --- | --- |
| `prompt-evaluation-task-list` | 查询 AI 评测任务 | params 可选 | 只读 |
| `prompt-evaluation-task-create` | 创建 AI 评测任务 | data: JSON 请求体 | 写入确认 |
| `prompt-evaluation-task-detail` | 查询 AI 评测任务详情 | params: detailId | 只读 |
| `prompt-evaluation-detail-score` | 人工打分 AI 评测明细 | params: detailId, score | 写入确认 |
| `prompt-evaluation-detail-score-custom` | 按自定义维度打分 AI 评测明细 | params: detailId；data: JSON 请求体 | 写入确认 |
| `prompt-evaluation-dataset-list` | 查询 AI 评测集 | params 可选 | 只读 |
| `prompt-evaluation-dataset-create` | 创建 AI 评测集 | data: JSON 请求体 | 写入确认 |
| `prompt-evaluation-dataset-detail` | 查询 AI 评测集详情 | params: datasetId | 只读 |
| `visual-search-group-list` | 查询视觉搜索图片组 | params 可选 | 只读 |
| `visual-search-group-detail` | 查询视觉搜索图片组详情 | params: productId | 只读 |
| `visual-search-image-add` | 新增视觉搜索图片 | data: JSON 请求体 | 写入确认 |
| `visual-search-image-delete` | 删除视觉搜索图片组 | data: JSON 请求体 | 写入确认 |
| `ai-chat-list` | 查询 AI 答疑记录 | params 可选 | 只读 |
| `ai-chat-export` | 导出 AI 答疑记录 | params 可选 | 只读 |
| `ai-chat-analyze-single` | 分析单条 AI 答疑并推送企微 | data: JSON 请求体 | 写入确认 |
| `ai-chat-analyze-batch` | 批量分析 AI 答疑并生成文件 | data: JSON 请求体 | 写入确认 |
| `recommend-question-list` | 查询首页推荐问题 | params 可选 | 只读 |
| `recommend-question-create` | 创建首页推荐问题 | data: JSON 请求体 | 写入确认 |
| `recommend-question-update` | 更新首页推荐问题 | params: id；data: JSON 请求体 | 写入确认 |
| `recommend-question-delete` | 删除首页推荐问题 | params: id | 写入确认 |
| `recommend-question-reorder` | 调整置顶推荐问题排序 | data: JSON 请求体 | 写入确认 |
| `recommend-question-batch-create` | 批量导入首页推荐问题 | file: name + text/contentBase64 | 写入确认 |
| `photo-merge-quota-get` | 查询春节生图机会 | params: userId | 只读 |
| `photo-merge-quota-grant` | 下发春节生图机会 | data: JSON 请求体 | 写入确认 |
| `aigc-resource-list` | 查询 AIGC 资产 | params 可选 | 只读 |
| `aigc-resource-detail` | 查询 AIGC 资产详情 | params: recordId | 只读 |
| `aigc-resource-modify-result` | 查询 AIGC 资产修改结果 | params: recordId | 只读 |
| `aigc-resource-modify-list` | 查询 AIGC 资产修改记录 | params 可选 | 只读 |
| `aigc-resource-modify` | 发起 AIGC 资产修改 | data: JSON 请求体 | 写入确认 |
| `aigc-resource-save` | 保存 AIGC 资产修改结果 | data: JSON 请求体 | 写入确认 |
| `aigc-resource-retry` | 重试 AIGC 资产生产 | data: JSON 请求体 | 写入确认 |
| `aigc-resource-quality-check` | 更新 AIGC 资产质检状态 | data: JSON 请求体 | 写入确认 |
| `aigc-resource-marked-image-upload` | 上传 AIGC 标记图片 | file: name + text/contentBase64 | 写入确认 |

将筛选和分页字段放在 `params`，将前端 service 对应请求对象放在 `data`。写操作先按主 Skill 的安全流程回读、预览并确认。
