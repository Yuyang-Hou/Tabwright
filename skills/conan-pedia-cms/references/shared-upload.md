# 公共支撑

| Action | 用途 | 输入 | 安全 |
| --- | --- | --- | --- |
| `asset-upload` | 上传 CMS 页面资产文件 | file: name + text/contentBase64 | 写入确认 |

将筛选和分页字段放在 `params`，将前端 service 对应请求对象放在 `data`。写操作先按主 Skill 的安全流程回读、预览并确认。
