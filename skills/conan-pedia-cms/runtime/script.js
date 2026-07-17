const environments = {
  "cn-prod": {
    cms: "https://conan.zhenguanyu.com",
    "im-agent": "https://agent.zhenguanyu.com",
  },
  "cn-test": {
    cms: "https://ytkconan.zhenguanyu.com",
    "im-agent": "https://im-agent-test.zhenguanyu.com",
  },
}
const operations = {
  "explore-task-activity-list": {
    "method": "GET",
    "endpoint": "/conan-pedia-growth/admin/api/explore-task/activity/list",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "explore-task-activity-detail": {
    "method": "GET",
    "endpoint": "/conan-pedia-growth/admin/api/explore-task/activity/{id}",
    "pathParams": [
      "id"
    ],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "explore-task-activity-create": {
    "method": "POST",
    "endpoint": "/conan-pedia-growth/admin/api/explore-task/activity/create",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "explore-task-activity-update": {
    "method": "POST",
    "endpoint": "/conan-pedia-growth/admin/api/explore-task/activity/update",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "explore-task-activity-delete": {
    "method": "DELETE",
    "endpoint": "/conan-pedia-growth/admin/api/explore-task/activity/{id}",
    "pathParams": [
      "id"
    ],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "explore-task-activity-reorder": {
    "method": "POST",
    "endpoint": "/conan-pedia-growth/admin/api/explore-task/activity/reorder",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "explore-task-sub-task-create": {
    "method": "POST",
    "endpoint": "/conan-pedia-growth/admin/api/explore-task/sub-task/create",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "explore-task-sub-task-update": {
    "method": "POST",
    "endpoint": "/conan-pedia-growth/admin/api/explore-task/sub-task/update",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "explore-task-sub-task-delete": {
    "method": "DELETE",
    "endpoint": "/conan-pedia-growth/admin/api/explore-task/sub-task/{id}",
    "pathParams": [
      "id"
    ],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "explore-task-sub-task-reorder": {
    "method": "POST",
    "endpoint": "/conan-pedia-growth/admin/api/explore-task/sub-task/reorder",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "invite-code-list": {
    "method": "GET",
    "endpoint": "/conan-pedia-growth/admin/api/invite-code/list",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "invite-code-change-status": {
    "method": "POST",
    "endpoint": "/conan-pedia-growth/admin/api/invite-code/changeStatus",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "invite-code-quota-config": {
    "method": "POST",
    "endpoint": "/conan-pedia-growth/admin/api/invite-code/quota/config",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "invite-code-quota-cancel": {
    "method": "POST",
    "endpoint": "/conan-pedia-growth/admin/api/invite-code/quota/cancel",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "invite-code-export": {
    "method": "GET",
    "endpoint": "/conan-pedia-growth/admin/api/invite-code/export",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "reach-strategy-list": {
    "method": "GET",
    "endpoint": "/conan-pedia-growth/admin/api/purchase-notify-strategy/list",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "reach-strategy-detail": {
    "method": "GET",
    "endpoint": "/conan-pedia-growth/admin/api/purchase-notify-strategy",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "reach-strategy-create": {
    "method": "POST",
    "endpoint": "/conan-pedia-growth/admin/api/purchase-notify-strategy",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "reach-strategy-update": {
    "method": "PUT",
    "endpoint": "/conan-pedia-growth/admin/api/purchase-notify-strategy",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "reach-strategy-toggle": {
    "method": "PUT",
    "endpoint": "/conan-pedia-growth/admin/api/purchase-notify-strategy/toggle",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "reach-strategy-delete": {
    "method": "DELETE",
    "endpoint": "/conan-pedia-growth/admin/api/purchase-notify-strategy",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "reach-strategy-push-template-list": {
    "method": "GET",
    "endpoint": "/conan-growth-notify-admin/api/push",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "reach-strategy-sms-template-list": {
    "method": "GET",
    "endpoint": "/conan-growth-notify-admin/api/sms-template",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "yearly-vote-activity-list": {
    "method": "GET",
    "endpoint": "/conan-pedia-growth/admin/api/yearly-vote/activity/list",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "yearly-vote-activity-create": {
    "method": "POST",
    "endpoint": "/conan-pedia-growth/admin/api/yearly-vote/activity/create",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "yearly-vote-activity-update": {
    "method": "POST",
    "endpoint": "/conan-pedia-growth/admin/api/yearly-vote/activity/update",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "yearly-vote-activity-delete": {
    "method": "DELETE",
    "endpoint": "/conan-pedia-growth/admin/api/yearly-vote/activity/{id}",
    "pathParams": [
      "id"
    ],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "yearly-vote-topic-list": {
    "method": "GET",
    "endpoint": "/conan-pedia-growth/admin/api/yearly-vote/topic/list",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "yearly-vote-topic-create": {
    "method": "POST",
    "endpoint": "/conan-pedia-growth/admin/api/yearly-vote/topic/create",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "yearly-vote-topic-update": {
    "method": "POST",
    "endpoint": "/conan-pedia-growth/admin/api/yearly-vote/topic/update",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "yearly-vote-topic-delete": {
    "method": "DELETE",
    "endpoint": "/conan-pedia-growth/admin/api/yearly-vote/topic/{id}",
    "pathParams": [
      "id"
    ],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "yearly-vote-candidate-list": {
    "method": "GET",
    "endpoint": "/conan-pedia-growth/admin/api/yearly-vote/candidate/list",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "yearly-vote-candidate-create": {
    "method": "POST",
    "endpoint": "/conan-pedia-growth/admin/api/yearly-vote/candidate/create",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "yearly-vote-candidate-update": {
    "method": "POST",
    "endpoint": "/conan-pedia-growth/admin/api/yearly-vote/candidate/update",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "yearly-vote-candidate-delete": {
    "method": "DELETE",
    "endpoint": "/conan-pedia-growth/admin/api/yearly-vote/candidate/{id}",
    "pathParams": [
      "id"
    ],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "yearly-vote-video-list": {
    "method": "GET",
    "endpoint": "/conan-growth-misc/admin/api/maple-media",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "experiment-tag-list": {
    "method": "GET",
    "endpoint": "/conan-pedia-growth/admin/api/expTag/list",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "experiment-tag-detail": {
    "method": "GET",
    "endpoint": "/conan-pedia-growth/admin/api/expTag/detail",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "experiment-tag-create": {
    "method": "POST",
    "endpoint": "/conan-pedia-growth/admin/api/expTag/create",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "experiment-tag-update-tag": {
    "method": "POST",
    "endpoint": "/conan-pedia-growth/admin/api/expTag/updateTag",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "experiment-tag-assign": {
    "method": "POST",
    "endpoint": "/conan-pedia-growth/admin/api/expTag/assign",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "experiment-tag-update-experiment": {
    "method": "POST",
    "endpoint": "/conan-pedia-growth/admin/api/expTag/update",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "experiment-tag-close": {
    "method": "POST",
    "endpoint": "/conan-pedia-growth/admin/api/expTag/close",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "experiment-tag-cleanup": {
    "method": "POST",
    "endpoint": "/conan-pedia-growth/admin/api/expTag/cleanup",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "coupon-trigger-rule-list": {
    "method": "GET",
    "endpoint": "/conan-pedia-growth/admin/api/behavior-trigger-rule/list",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "coupon-trigger-rule-detail": {
    "method": "GET",
    "endpoint": "/conan-pedia-growth/admin/api/behavior-trigger-rule",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "coupon-trigger-rule-operation-log-list": {
    "method": "GET",
    "endpoint": "/conan-pedia-growth/admin/api/behavior-trigger-rule/operation-log/list",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "coupon-trigger-rule-create": {
    "method": "POST",
    "endpoint": "/conan-pedia-growth/admin/api/behavior-trigger-rule",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "coupon-trigger-rule-update": {
    "method": "PUT",
    "endpoint": "/conan-pedia-growth/admin/api/behavior-trigger-rule",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "coupon-trigger-rule-delete": {
    "method": "DELETE",
    "endpoint": "/conan-pedia-growth/admin/api/behavior-trigger-rule",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "coupon-trigger-rule-toggle": {
    "method": "PUT",
    "endpoint": "/conan-pedia-growth/admin/api/behavior-trigger-rule/toggle",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "coupon-trigger-rule-reorder": {
    "method": "POST",
    "endpoint": "/conan-pedia-growth/admin/api/behavior-trigger-rule/reorder",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "keyfrom-quota-list": {
    "method": "GET",
    "endpoint": "/conan-pedia-growth/admin/api/keyfrom-quota/list",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "keyfrom-quota-create": {
    "method": "POST",
    "endpoint": "/conan-pedia-growth/admin/api/keyfrom-quota/create",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "keyfrom-quota-update": {
    "method": "POST",
    "endpoint": "/conan-pedia-growth/admin/api/keyfrom-quota/update",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "keyfrom-quota-online": {
    "method": "POST",
    "endpoint": "/conan-pedia-growth/admin/api/keyfrom-quota/online",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "keyfrom-quota-offline": {
    "method": "POST",
    "endpoint": "/conan-pedia-growth/admin/api/keyfrom-quota/offline",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "agent-reply-turn-list": {
    "method": "GET",
    "endpoint": "/conan-pedia-ai-consultant/admin/api/agent-reply-turns",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "agent-reply-turn-mark-succeeded": {
    "method": "POST",
    "endpoint": "/conan-pedia-ai-consultant/admin/api/agent-reply-turns/mark-succeeded-by-chat-id",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "agent-reply-turn-im-chat-detail": {
    "method": "GET",
    "endpoint": "/conan-im-agent/api/ops/chats/{chatId}",
    "pathParams": [
      "chatId"
    ],
    "omitQuery": [],
    "multipart": false,
    "binary": false,
    "originKey": "im-agent"
  },
  "agent-reply-turn-im-chat-messages": {
    "method": "GET",
    "endpoint": "/conan-im-agent/api/ops/chats/{chatId}/messages",
    "pathParams": [
      "chatId"
    ],
    "fixedQuery": {
      "limit": 200
    },
    "omitQuery": [],
    "multipart": false,
    "binary": false,
    "originKey": "im-agent"
  },
  "encyclopedia-tv-column-list": {
    "method": "GET",
    "endpoint": "/conan-pedia-course/admin/api/tv-columns/list",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "encyclopedia-tv-column-create": {
    "method": "POST",
    "endpoint": "/conan-pedia-course/admin/api/tv-columns/create",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "encyclopedia-tv-column-update": {
    "method": "PUT",
    "endpoint": "/conan-pedia-course/admin/api/tv-columns/update",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "encyclopedia-tv-column-reorder": {
    "method": "PUT",
    "endpoint": "/conan-pedia-course/admin/api/tv-columns/update/ordinal",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "encyclopedia-tv-column-update-status": {
    "method": "PUT",
    "endpoint": "/conan-pedia-course/admin/api/tv-columns/update/status",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "encyclopedia-tv-column-delete": {
    "method": "PUT",
    "endpoint": "/conan-pedia-course/admin/api/tv-columns/delete",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "encyclopedia-tv-drama-list": {
    "method": "GET",
    "endpoint": "/conan-pedia-course/admin/api/tv-dramas/list",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "encyclopedia-tv-drama-create": {
    "method": "POST",
    "endpoint": "/conan-pedia-course/admin/api/tv-dramas/create",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "encyclopedia-tv-drama-update": {
    "method": "PUT",
    "endpoint": "/conan-pedia-course/admin/api/tv-dramas/update",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "encyclopedia-tv-drama-update-status": {
    "method": "PUT",
    "endpoint": "/conan-pedia-course/admin/api/tv-dramas/update/status",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "encyclopedia-video-list": {
    "method": "GET",
    "endpoint": "/conan-growth-misc/admin/api/maple-media",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "study-tour-task-list": {
    "method": "GET",
    "endpoint": "/conan-pedia-center/admin/api/studytour/tasks",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "study-tour-task-precheck": {
    "method": "POST",
    "endpoint": "/conan-pedia-center/admin/api/studytour/task/precheck",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "study-tour-task-create": {
    "method": "POST",
    "endpoint": "/conan-pedia-center/admin/api/studytour/task",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "study-tour-task-failures": {
    "method": "GET",
    "endpoint": "/conan-pedia-center/admin/api/studytour/task/{taskId}/failures",
    "pathParams": [
      "taskId"
    ],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "medal-config-list": {
    "method": "GET",
    "endpoint": "/conan-pedia-course/admin/api/medal-configs/list",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "medal-config-detail": {
    "method": "GET",
    "endpoint": "/conan-pedia-course/admin/api/medal-configs/{id}",
    "pathParams": [
      "id"
    ],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "medal-config-create": {
    "method": "POST",
    "endpoint": "/conan-pedia-course/admin/api/medal-configs/create",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "medal-config-update": {
    "method": "PUT",
    "endpoint": "/conan-pedia-course/admin/api/medal-configs/update",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "medal-config-delete": {
    "method": "DELETE",
    "endpoint": "/conan-pedia-course/admin/api/medal-configs/{id}",
    "pathParams": [
      "id"
    ],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "books-book-list": {
    "method": "GET",
    "endpoint": "/conan-pedia-course/admin/api/books/list",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "books-book-detail": {
    "method": "GET",
    "endpoint": "/conan-pedia-course/admin/api/books/detail",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "books-book-create": {
    "method": "POST",
    "endpoint": "/conan-pedia-course/admin/api/books/add",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "books-book-update": {
    "method": "PUT",
    "endpoint": "/conan-pedia-course/admin/api/books/update",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "books-book-delete": {
    "method": "POST",
    "endpoint": "/conan-pedia-course/admin/api/books/delete",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "books-chapter-list": {
    "method": "GET",
    "endpoint": "/conan-pedia-course/admin/api/books/chapters/list",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "books-chapter-book-info": {
    "method": "GET",
    "endpoint": "/conan-pedia-course/admin/api/books/chapters/bookInfo",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "books-chapter-detail": {
    "method": "GET",
    "endpoint": "/conan-pedia-course/admin/api/books/chapters/detail",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "books-chapter-create": {
    "method": "POST",
    "endpoint": "/conan-pedia-course/admin/api/books/chapters/add",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "books-chapter-update": {
    "method": "PUT",
    "endpoint": "/conan-pedia-course/admin/api/books/chapters/update",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "books-chapter-reorder": {
    "method": "PUT",
    "endpoint": "/conan-pedia-course/admin/api/books/chapters/updateOrdinal",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "books-chapter-delete": {
    "method": "POST",
    "endpoint": "/conan-pedia-course/admin/api/books/chapters/delete",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "books-resource-list": {
    "method": "GET",
    "endpoint": "/conan-pedia-course/admin/api/books/resources/list",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "books-resource-chapter-info": {
    "method": "GET",
    "endpoint": "/conan-pedia-course/admin/api/books/resources/chapterInfo",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "books-resource-detail": {
    "method": "GET",
    "endpoint": "/conan-pedia-course/admin/api/books/resources/detail",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "books-resource-create": {
    "method": "POST",
    "endpoint": "/conan-pedia-course/admin/api/books/resources/add",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "books-resource-update": {
    "method": "PUT",
    "endpoint": "/conan-pedia-course/admin/api/books/resources/update",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "books-resource-delete": {
    "method": "POST",
    "endpoint": "/conan-pedia-course/admin/api/books/resources/delete",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "prompt-evaluation-task-list": {
    "method": "GET",
    "endpoint": "/conan-pedia-ai/admin/api/pedia/prompt-evaluation/list",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "prompt-evaluation-task-create": {
    "method": "POST",
    "endpoint": "/conan-pedia-ai/admin/api/pedia/prompt-evaluation/create-task",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "prompt-evaluation-task-detail": {
    "method": "GET",
    "endpoint": "/conan-pedia-ai/admin/api/pedia/prompt-evaluation/task/{detailId}/details",
    "pathParams": [
      "detailId"
    ],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "prompt-evaluation-detail-score": {
    "method": "POST",
    "endpoint": "/conan-pedia-ai/admin/api/pedia/prompt-evaluation/detail/{detailId}/score",
    "pathParams": [
      "detailId"
    ],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "prompt-evaluation-detail-score-custom": {
    "method": "POST",
    "endpoint": "/conan-pedia-ai/admin/api/pedia/prompt-evaluation/detail/{detailId}/score/custom",
    "pathParams": [
      "detailId"
    ],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "prompt-evaluation-dataset-list": {
    "method": "GET",
    "endpoint": "/conan-pedia-ai/admin/api/pedia/evaluation-dataset/list",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "prompt-evaluation-dataset-create": {
    "method": "POST",
    "endpoint": "/conan-pedia-ai/admin/api/pedia/evaluation-dataset/create",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "prompt-evaluation-dataset-detail": {
    "method": "GET",
    "endpoint": "/conan-pedia-ai/admin/api/pedia/evaluation-dataset/list",
    "pathParams": [],
    "fixedQuery": {
      "page": 1,
      "pageSize": 1000
    },
    "omitQuery": [
      "datasetId"
    ],
    "multipart": false,
    "binary": false,
    "selectResultBy": {
      "input": "datasetId",
      "field": "id"
    }
  },
  "visual-search-group-list": {
    "method": "GET",
    "endpoint": "/conan-pedia-ai/admin/api/pedia/visual-search/images",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "visual-search-group-detail": {
    "method": "GET",
    "endpoint": "/conan-pedia-ai/admin/api/pedia/visual-search/image-group-detail",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "visual-search-image-add": {
    "method": "POST",
    "endpoint": "/conan-pedia-ai/admin/api/pedia/visual-search/add/images",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "visual-search-image-delete": {
    "method": "DELETE",
    "endpoint": "/conan-pedia-ai/admin/api/pedia/visual-search/image",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "ai-chat-list": {
    "method": "GET",
    "endpoint": "/conan-pedia-ai/admin/api/conversation-record/list",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "ai-chat-export": {
    "method": "GET",
    "endpoint": "/conan-pedia-ai/admin/api/conversation-record/export",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": true
  },
  "ai-chat-analyze-single": {
    "method": "POST",
    "endpoint": "/conan-pedia-ai/admin/api/resource-analysis/single",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "ai-chat-analyze-batch": {
    "method": "POST",
    "endpoint": "/conan-pedia-ai/admin/api/resource-analysis/batch",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "recommend-question-list": {
    "method": "GET",
    "endpoint": "/conan-pedia-ai/admin/api/recommended-questions/list",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "recommend-question-create": {
    "method": "POST",
    "endpoint": "/conan-pedia-ai/admin/api/recommended-questions/create",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "recommend-question-update": {
    "method": "PUT",
    "endpoint": "/conan-pedia-ai/admin/api/recommended-questions/{id}",
    "pathParams": [
      "id"
    ],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "recommend-question-delete": {
    "method": "DELETE",
    "endpoint": "/conan-pedia-ai/admin/api/recommended-questions/{id}",
    "pathParams": [
      "id"
    ],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "recommend-question-reorder": {
    "method": "PUT",
    "endpoint": "/conan-pedia-ai/admin/api/recommended-questions/sort",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "recommend-question-batch-create": {
    "method": "POST",
    "endpoint": "/conan-pedia-ai/admin/api/recommended-questions/batch-create",
    "pathParams": [],
    "omitQuery": [],
    "multipart": true,
    "binary": false
  },
  "photo-merge-quota-get": {
    "method": "GET",
    "endpoint": "/conan-pedia-ai/admin/api/photo-merge-quota/get",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "photo-merge-quota-grant": {
    "method": "POST",
    "endpoint": "/conan-pedia-ai/admin/api/photo-merge-quota/grant",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "aigc-resource-list": {
    "method": "GET",
    "endpoint": "/conan-pedia-ai/admin/api/resource-analysis/production/list",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "aigc-resource-detail": {
    "method": "GET",
    "endpoint": "/conan-pedia-ai/admin/api/resource-analysis/production/detail",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "aigc-resource-modify-result": {
    "method": "GET",
    "endpoint": "/conan-pedia-ai/admin/api/resource-analysis/production/resource/modify/result",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "aigc-resource-modify-list": {
    "method": "GET",
    "endpoint": "/conan-pedia-ai/admin/api/resource-analysis/production/resource/modify/list",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "aigc-resource-modify": {
    "method": "POST",
    "endpoint": "/conan-pedia-ai/admin/api/resource-analysis/production/resource/modify",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "aigc-resource-save": {
    "method": "POST",
    "endpoint": "/conan-pedia-ai/admin/api/resource-analysis/production/resource/save",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "aigc-resource-retry": {
    "method": "POST",
    "endpoint": "/conan-pedia-ai/admin/api/resource-analysis/production/retry",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "aigc-resource-quality-check": {
    "method": "POST",
    "endpoint": "/conan-pedia-ai/admin/api/resource-analysis/production/quality-check",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "aigc-resource-marked-image-upload": {
    "method": "POST",
    "endpoint": "/api/upload/file",
    "pathParams": [],
    "omitQuery": [],
    "multipart": true,
    "binary": false
  },
  "vdb-knowledge-base-list": {
    "method": "GET",
    "endpoint": "/conan-pedia-ai/admin/api/vdb/knowledge-bases/list",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "vdb-knowledge-base-detail": {
    "method": "GET",
    "endpoint": "/conan-pedia-ai/admin/api/vdb/knowledge-bases/{id}",
    "pathParams": [
      "id"
    ],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "vdb-knowledge-base-create": {
    "method": "POST",
    "endpoint": "/conan-pedia-ai/admin/api/vdb/knowledge-bases/create",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "vdb-knowledge-base-update": {
    "method": "PUT",
    "endpoint": "/conan-pedia-ai/admin/api/vdb/knowledge-bases/{id}",
    "pathParams": [
      "id"
    ],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "vdb-knowledge-base-delete": {
    "method": "DELETE",
    "endpoint": "/conan-pedia-ai/admin/api/vdb/knowledge-bases/{id}",
    "pathParams": [
      "id"
    ],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "vdb-document-list": {
    "method": "GET",
    "endpoint": "/conan-pedia-ai/admin/api/vdb/knowledge-bases/{kbId}/documents/list",
    "pathParams": [
      "kbId"
    ],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "vdb-document-detail": {
    "method": "GET",
    "endpoint": "/conan-pedia-ai/admin/api/vdb/knowledge-bases/{kbId}/documents/{docId}",
    "pathParams": [
      "kbId",
      "docId"
    ],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "vdb-document-create-file": {
    "method": "POST",
    "endpoint": "/conan-pedia-ai/admin/api/vdb/knowledge-bases/{kbId}/documents/upload",
    "pathParams": [
      "kbId"
    ],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "vdb-document-create-manual": {
    "method": "POST",
    "endpoint": "/conan-pedia-ai/admin/api/vdb/knowledge-bases/{kbId}/documents/manual",
    "pathParams": [
      "kbId"
    ],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "vdb-document-update-file": {
    "method": "PUT",
    "endpoint": "/conan-pedia-ai/admin/api/vdb/knowledge-bases/{kbId}/documents/{docId}/upload",
    "pathParams": [
      "kbId",
      "docId"
    ],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "vdb-document-update-manual": {
    "method": "PUT",
    "endpoint": "/conan-pedia-ai/admin/api/vdb/knowledge-bases/{kbId}/documents/{docId}/manual",
    "pathParams": [
      "kbId",
      "docId"
    ],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "vdb-document-delete": {
    "method": "DELETE",
    "endpoint": "/conan-pedia-ai/admin/api/vdb/knowledge-bases/{kbId}/documents/{docId}",
    "pathParams": [
      "kbId",
      "docId"
    ],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "vdb-document-reprocess": {
    "method": "POST",
    "endpoint": "/conan-pedia-ai/admin/api/vdb/knowledge-bases/{kbId}/documents/{docId}/reprocess",
    "pathParams": [
      "kbId",
      "docId"
    ],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "vdb-chunk-list": {
    "method": "GET",
    "endpoint": "/conan-pedia-ai/admin/api/vdb/knowledge-bases/{kbId}/documents/{docId}/chunks",
    "pathParams": [
      "kbId",
      "docId"
    ],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "vdb-debug-search": {
    "method": "POST",
    "endpoint": "/conan-pedia-ai/admin/api/vdb/debug/search",
    "pathParams": [],
    "omitQuery": [],
    "multipart": false,
    "binary": false
  },
  "asset-upload": {
    "method": "POST",
    "endpoint": "/api/upload/file",
    "pathParams": [],
    "omitQuery": [],
    "multipart": true,
    "binary": false
  }
}
const action = String(input.action || "")
const operation = operations[action]
if (!operation) {
  throw new Error("Unsupported action: " + (action || "missing"))
}
const environment = String(input.environment || "cn-prod")
const environmentOrigins = environments[environment]
if (!environmentOrigins) {
  throw new Error("Unsupported environment: " + environment + ". Use cn-prod or cn-test.")
}
const origin = environmentOrigins[operation.originKey || "cms"]
const cookieHeader = secrets.cookieHeader
if (!cookieHeader) {
  throw new Error("Missing saved cookie auth. Refresh this Skill runtime with: tabwright capability refresh-auth <runtime-dir> --browser user --json")
}
const params = input.params && typeof input.params === "object" && !Array.isArray(input.params) ? input.params : {}
const pathValues = Object.fromEntries((operation.pathParams || []).map((name) => {
  const value = params[name] ?? (input.data && !Array.isArray(input.data) ? input.data[name] : undefined)
  if (value === undefined || value === null || value === "") {
    throw new Error(action + " requires params." + name)
  }
  return [name, value]
}))
const endpoint = (operation.pathParams || []).reduce((current, name) => {
  return current.replace("{" + name + "}", encodeURIComponent(String(pathValues[name])))
}, operation.endpoint)
const url = new URL(endpoint, origin)
Object.entries({ ...(operation.fixedQuery || {}), ...params }).map(([name, value]) => {
  if ((operation.pathParams || []).includes(name) || (operation.omitQuery || []).includes(name)) return null
  if (value === undefined || value === null || value === "") return null
  if (Array.isArray(value)) {
    value.map((item) => url.searchParams.append(name, String(item)))
    return null
  }
  url.searchParams.set(name, String(value))
  return null
})
const headers = { Cookie: cookieHeader }
let body
if (operation.multipart) {
  const file = input.file || {}
  const bytes = file.contentBase64
    ? Buffer.from(file.contentBase64, "base64")
    : Buffer.from(String(file.text || ""), "utf8")
  const form = new FormData()
  form.append("file", new Blob([bytes], { type: file.contentType || "text/csv" }), file.name)
  body = form
} else if (input.data !== undefined) {
  headers["Content-Type"] = "application/json"
  body = JSON.stringify(input.data)
}
const response = await fetch(url, { method: operation.method, headers, body })
if (response.status === 401 || response.status === 403) {
  throw new Error("Request failed " + response.status + ": login expired. Refresh this Skill runtime with: tabwright capability refresh-auth <runtime-dir> --browser user --json")
}
if (operation.binary) {
  if (!response.ok) throw new Error("Request failed " + response.status)
  const contentDisposition = response.headers.get("content-disposition") || ""
  const filenameMatch = contentDisposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i)
  return {
    action,
    environment,
    method: operation.method,
    url: url.toString(),
    status: response.status,
    contentType: response.headers.get("content-type") || "application/octet-stream",
    filename: filenameMatch ? decodeURIComponent(filenameMatch[1]) : null,
    contentBase64: Buffer.from(await response.arrayBuffer()).toString("base64"),
  }
}
const responseText = await response.text()
const payload = (() => {
  if (!responseText) return null
  try {
    return JSON.parse(responseText)
  } catch (cause) {
    throw new Error("Expected a JSON API response", { cause })
  }
})()
if (!response.ok) {
  throw new Error("Request failed " + response.status + ": " + responseText.slice(0, 500))
}
if (payload && typeof payload === "object" && payload.code !== undefined && payload.code !== 0) {
  throw new Error(payload.message || payload.msg || ("API returned code " + payload.code))
}
const unwrapped = payload && typeof payload === "object" && payload.result !== undefined ? payload.result : payload
const result = (() => {
  if (!operation.selectResultBy) return unwrapped
  const source = Array.isArray(unwrapped?.list) ? unwrapped.list : Array.isArray(unwrapped) ? unwrapped : []
  const expected = params[operation.selectResultBy.input]
  const selected = source.find((item) => String(item?.[operation.selectResultBy.field]) === String(expected))
  if (!selected) throw new Error(action + " target not found: " + expected)
  return selected
})()
return {
  action,
  environment,
  method: operation.method,
  url: url.toString(),
  status: response.status,
  result,
  response: payload,
}
