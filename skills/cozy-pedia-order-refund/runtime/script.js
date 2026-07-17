const API_ORIGIN = "https://ytkconan.zhenguanyu.com";
const COZY_REFERER = "https://cozy-test.zhenguanyu.com/";
const REFUND_REASON = "性价比低";
const REFUND_TYPE_RETURN_AND_REFUND = 1;
const REFUND_DETAIL_STATUS_REFUNDED = 2;

const SCENE_ENCYCLOPEDIA = 1;
const SCENE_MEMBER_DAY = 2;
const SCENE_MEMBER_VOUCHER = 3;
const SCENE_MEMBER_ALL = 7;
const SCENE_DEFAULT_COMMODITY = 8;

const UI_QUERIES = [
  {
    uiQuery: 2,
    label: "百科会员订单",
    packType: 1,
    sourceType: 2,
  },
  {
    uiQuery: 1,
    label: "百科正价课订单",
    packType: 1,
    sourceType: 1,
  },
  {
    uiQuery: 3,
    label: "mini百科订单",
    packType: 2,
    sourceType: 1,
  },
];

const PAID_ORDER_STATUSES = new Set(["2", "paid", "Paid", "PAID", "已支付"]);

// Workflow evidence: replay 2026-07-07T06-15-50-521Z-038840f0 refunded a
// paid encyclopedia member order from Cozy with reason "性价比低". The Cozy UI
// uses /conan-kefu-admin/api/encyclopediaOrder to list orders, then calls
// pre-refund-info, encyclopedia-member-refund-preview, and
// encyclopedia-member-refund-real for member refund scenes.
function normalizeInput(rawInput) {
  const uid = String(rawInput?.uid || "").trim();
  if (!/^\d+$/.test(uid)) {
    throw new Error("uid must be a non-empty numeric string");
  }
  return { uid };
}

function requireCookieHeader() {
  const cookieHeader = String(secrets?.cookieHeader || "").trim();
  if (!cookieHeader) {
    throw new Error("Missing saved cookie auth. Refresh capability auth before running.");
  }
  return cookieHeader;
}

function getMessage(payload) {
  if (!payload || typeof payload !== "object") {
    return String(payload || "unknown error");
  }
  return String(
    payload.message ||
      payload.msg ||
      payload.errorMessage ||
      payload.retMsg ||
      payload.error ||
      JSON.stringify(payload),
  );
}

function unwrapApiPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  if (payload.success === false) {
    throw new Error(getMessage(payload));
  }

  const code = payload.code ?? payload.errCode;
  if (code !== undefined && code !== 0 && code !== "0" && code !== "SUCCESS") {
    throw new Error(getMessage(payload));
  }

  if (typeof payload.result === "number" && payload.result !== 0) {
    throw new Error(getMessage(payload));
  }

  if (
    payload.data !== undefined &&
    (payload.code !== undefined || payload.errCode !== undefined || payload.result !== undefined || payload.success !== undefined)
  ) {
    return payload.data;
  }

  return payload;
}

function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (Array.isArray(value?.list)) {
    return value.list;
  }
  if (Array.isArray(value?.records)) {
    return value.records;
  }
  if (Array.isArray(value?.items)) {
    return value.items;
  }
  return [];
}

function orderIdOf(order) {
  return order?.orderId ?? order?.id ?? order?.orderNo ?? "";
}

function orderStatusOf(order) {
  return String(order?.orderStatus ?? order?.status ?? order?.payStatus ?? "");
}

function isUnrefundedOrder(order) {
  return PAID_ORDER_STATUSES.has(orderStatusOf(order));
}

function purchaseTimeMs(order) {
  const rawValue = order?.purchaseTime || order?.createdAt || order?.createTime || "";
  const timestamp = Date.parse(String(rawValue).replace(/-/g, "/"));
  if (Number.isNaN(timestamp)) {
    return 0;
  }
  return timestamp;
}

function summarizeOrder(order) {
  return {
    orderId: String(orderIdOf(order)),
    skuName: String(order?.skuName || order?.goodsName || ""),
    orderStatus: order?.orderStatus ?? order?.status ?? order?.payStatus ?? null,
    orderPaidAmount: order?.orderPaidAmount ?? order?.paidAmount ?? null,
    purchaseTime: String(order?.purchaseTime || order?.createdAt || order?.createTime || ""),
    queryLabel: String(order?.queryLabel || ""),
  };
}

function uniqueRecentPaidOrders(orders) {
  const byOrderId = new Map(
    orders
      .filter((order) => {
        return orderIdOf(order);
      })
      .filter((order) => {
        return isUnrefundedOrder(order);
      })
      .map((order) => {
        return [String(orderIdOf(order)), order];
      }),
  );

  return Array.from(byOrderId.values()).sort((left, right) => {
    return purchaseTimeMs(right) - purchaseTimeMs(left);
  });
}

function selectMemberRefundScene(refundScenes) {
  if (refundScenes.includes(SCENE_MEMBER_ALL)) {
    return SCENE_MEMBER_ALL;
  }
  if (refundScenes.length === 1 && refundScenes.includes(SCENE_MEMBER_VOUCHER)) {
    return SCENE_MEMBER_VOUCHER;
  }
  if (refundScenes.length === 1 && refundScenes.includes(SCENE_MEMBER_DAY)) {
    return SCENE_MEMBER_DAY;
  }
  if (refundScenes.includes(SCENE_MEMBER_DAY)) {
    return SCENE_MEMBER_DAY;
  }
  if (refundScenes.includes(SCENE_MEMBER_VOUCHER)) {
    return SCENE_MEMBER_VOUCHER;
  }
  return undefined;
}

function chooseRefundEndpoints(refundScenes) {
  if (refundScenes.includes(SCENE_ENCYCLOPEDIA)) {
    return {
      previewPath: "/conan-fulfill-center/admin/api/encyclopedia-refund-preview",
      realPath: "/conan-fulfill-center/admin/api/encyclopedia-refund-real",
      refundScene: undefined,
    };
  }

  return {
    previewPath: "/conan-fulfill-center/admin/api/encyclopedia-member-refund-preview",
    realPath: "/conan-fulfill-center/admin/api/encyclopedia-member-refund-real",
    refundScene: selectMemberRefundScene(refundScenes),
  };
}

function selectAllRefundableItems(refundItems) {
  return asArray(refundItems).map((item) => {
    return {
      ...item,
      willRefund: item?.refundStatus !== REFUND_DETAIL_STATUS_REFUNDED,
    };
  });
}

function hasSelectedRefundItem(refundItems) {
  return asArray(refundItems).some((item) => {
    return item?.willRefund === true;
  });
}

function getErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function apiRequest({ path, method = "GET", query, body }) {
  const url = new URL(path, API_ORIGIN);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }
    url.searchParams.set(key, String(value));
  });

  const response = await fetch(url.toString(), {
    method,
    headers: {
      accept: "application/json, text/plain, */*",
      cookie: requireCookieHeader(),
      origin: COZY_REFERER.replace(/\/$/, ""),
      referer: COZY_REFERER,
      "x-requested-with": "XMLHttpRequest",
      ...(body === undefined ? {} : { "content-type": "application/json;charset=UTF-8" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  const payload = (() => {
    if (!text.trim()) {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(`Response is not JSON: ${text.slice(0, 200)}`, { cause: error });
    }
  })();

  if (!response.ok) {
    throw new Error(`Request failed ${response.status}: ${getMessage(payload)}`);
  }

  return unwrapApiPayload(payload);
}

async function getCurrentOperator() {
  const currentUser = await apiRequest({
    path: "/conan-kefu-admin/api/users/current",
  });

  const candidates = [
    currentUser?.ldapId,
    currentUser?.ldap,
    currentUser?.username,
    currentUser?.userName,
    currentUser?.name,
    currentUser?.staff?.ldapId,
    currentUser?.staff?.ldap,
    currentUser?.user?.ldapId,
    currentUser?.user?.ldap,
  ]
    .map((value) => {
      return String(value || "").trim();
    })
    .filter((value) => {
      return Boolean(value);
    });

  const ldap = candidates[0] || "";
  if (!ldap) {
    throw new Error("Cannot resolve current operator ldap from /conan-kefu-admin/api/users/current");
  }
  return ldap;
}

async function getOrdersForQuery({ uid, queryConfig }) {
  const data = await apiRequest({
    path: "/conan-kefu-admin/api/encyclopediaOrder",
    query: {
      userId: uid,
      uiQuery: queryConfig.uiQuery,
      packType: queryConfig.packType,
      sourceType: queryConfig.sourceType,
    },
  });

  return asArray(data).map((order) => {
    return {
      ...order,
      queryLabel: queryConfig.label,
    };
  });
}

async function getRefundScenes(orderId) {
  const data = await apiRequest({
    path: "/conan-fulfill-center/admin/api/pre-refund-info",
    query: { orderId },
  });

  return asArray(data?.refundScenes || data)
    .map((value) => {
      return Number(value);
    })
    .filter((value) => {
      return Number.isFinite(value);
    });
}

async function previewRefund({ uid, operator, orderId, refundScenes }) {
  const endpoints = chooseRefundEndpoints(refundScenes);
  if (!refundScenes.includes(SCENE_ENCYCLOPEDIA) && !endpoints.refundScene) {
    return {
      skipped: true,
      reason: "Cannot select supported member refund scene",
    };
  }

  const baseRefundData = {
    orderId,
    userId: uid,
    refundType: REFUND_TYPE_RETURN_AND_REFUND,
    ldap: operator,
    ...(endpoints.refundScene ? { refundScene: endpoints.refundScene } : {}),
  };

  const initialPreview = await apiRequest({
    path: endpoints.previewPath,
    method: "POST",
    body: baseRefundData,
  });

  const selectedRefundItems = selectAllRefundableItems(initialPreview?.refundItems);
  const preview = await apiRequest({
    path: endpoints.previewPath,
    method: "POST",
    body: {
      ...initialPreview,
      ...baseRefundData,
      refundItems: selectedRefundItems,
    },
  });
  const refundItems = selectAllRefundableItems(preview?.refundItems || selectedRefundItems);

  if (preview?.requireReturnExpressNo) {
    return {
      skipped: true,
      reason: "Refund requires manual return express information",
    };
  }

  if (!hasSelectedRefundItem(refundItems)) {
    return {
      skipped: true,
      reason: "No refundable item was selected after preview",
    };
  }

  const refundData = {
    ...preview,
    ...baseRefundData,
    refundItems,
    reason: REFUND_REASON,
  };
  delete refundData.customerReturnVO;

  return {
    skipped: false,
    endpoints,
    refundData,
    refundScene: endpoints.refundScene,
    isLastPediaSubscriptionOrder: Boolean(preview?.isLastPediaSubscriptionOrder),
  };
}

async function refundOne({ uid, operator, order }) {
  const orderId = orderIdOf(order);
  const summary = summarizeOrder(order);

  try {
    const refundScenes = await getRefundScenes(orderId);
    if (refundScenes.includes(SCENE_DEFAULT_COMMODITY)) {
      return {
        status: "skipped",
        order: summary,
        refundScenes,
        reason: "Encyclopedia default commodity refund scene is not handled by this capability",
      };
    }

    const preview = await previewRefund({
      uid,
      operator,
      orderId,
      refundScenes,
    });

    if (preview.skipped) {
      return {
        status: "skipped",
        order: summary,
        refundScenes,
        reason: preview.reason,
      };
    }

    const response = await apiRequest({
      path: preview.endpoints.realPath,
      method: "POST",
      body: preview.refundData,
    });

    return {
      status: "refunded",
      order: summary,
      refundScenes,
      refundScene: preview.refundScene ?? null,
      isLastPediaSubscriptionOrder: preview.isLastPediaSubscriptionOrder,
      response,
    };
  } catch (error) {
    return {
      status: "failed",
      order: summary,
      error: getErrorMessage(error),
    };
  }
}

const { uid } = normalizeInput(input);
const operator = await getCurrentOperator();
const orderGroups = await Promise.all(
  UI_QUERIES.map((queryConfig) => {
    return getOrdersForQuery({ uid, queryConfig });
  }),
);
const orders = orderGroups.flat();
const candidates = uniqueRecentPaidOrders(orders);
const results = await candidates.reduce(async (resultPromise, order) => {
  const previousResults = await resultPromise;
  const nextResult = await refundOne({ uid, operator, order });
  return [...previousResults, nextResult];
}, Promise.resolve([]));

const output = {
  uid,
  operator,
  queriedOrderTypes: UI_QUERIES.map((queryConfig) => {
    return queryConfig.label;
  }),
  candidateCount: candidates.length,
  refundedCount: results.filter((result) => {
    return result.status === "refunded";
  }).length,
  skippedCount: results.filter((result) => {
    return result.status === "skipped";
  }).length,
  failedCount: results.filter((result) => {
    return result.status === "failed";
  }).length,
  results,
};

if (typeof artifacts?.writeJson === "function") {
  output.artifactPath = artifacts.writeJson({
    filename: "latest.json",
    value: output,
  });
}

return output;
