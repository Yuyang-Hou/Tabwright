const dealOrigin = "https://deal.zhenguanyu.com"
const apiOrigin = "https://conan.zhenguanyu.com"
const action = input.action
const filters = input.filters || {}
const includeRaw = input.includeRaw === true
const limit = Math.max(1, Math.min(Number(input.limit || filters.pageSize || 20), 100))

const supportedActions = [
  "user.query",
  "group.query",
  "group.detail",
  "group.validate",
  "coupon-template.query",
  "coupon.query",
  "legacy-product.query",
  "legacy-product.detail",
  "product.query",
  "product.detail",
  "order.query",
  "order.detail",
  "legacy-price-strategy.query",
  "legacy-price-strategy.detail",
  "price-strategy.query",
  "price-strategy.detail",
]

if (!supportedActions.includes(action)) {
  throw new Error(`Unsupported action: ${action || "missing"}`)
}

if (!page.url().startsWith(`${dealOrigin}/`)) {
  await page.goto(`${dealOrigin}/#/account/search`)
}

const normalizeIds = (values) => {
  const source = Array.isArray(values) ? values : values === undefined || values === null ? [] : [values]
  return [...new Set(source.map((value) => String(value).trim()).filter(Boolean))]
}

const requireIds = (values, label) => {
  const ids = normalizeIds(values)
  if (!ids.length) {
    throw new Error(`${label} must contain at least one ID`)
  }
  if (ids.some((id) => !/^\d+$/.test(id))) {
    throw new Error(`${label} must contain digits only`)
  }
  return ids
}

const pickFilters = (allowedKeys, source = filters) => {
  return Object.fromEntries(allowedKeys.flatMap((key) => {
    const value = source[key]
    if (value === undefined || value === null || value === "") {
      return []
    }
    return [[key, value]]
  }))
}

const requestJson = async ({ path, query, method = "GET", body }) => {
  const url = new URL(path, apiOrigin)
  Object.entries(query || {}).map(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return null
    }
    url.searchParams.set(key, Array.isArray(value) ? value.join(",") : String(value))
    return null
  })

  return page.evaluate(async (request) => {
    const response = await fetch(request.url, {
      method: request.method,
      credentials: "include",
      headers: request.body ? { "Content-Type": "application/json" } : undefined,
      body: request.body ? JSON.stringify(request.body) : undefined,
    })
    const responseText = await response.text()
    const payload = (() => {
      try {
        return JSON.parse(responseText)
      } catch (cause) {
        throw new Error("Expected a JSON API response", { cause })
      }
    })()

    if (!response.ok) {
      throw new Error(`Request failed ${response.status}`)
    }
    if (payload && typeof payload === "object" && payload.code !== undefined && payload.code !== 0) {
      throw new Error(payload.msg || `API returned code ${payload.code}`)
    }
    if (payload && typeof payload === "object" && payload.data !== undefined) {
      return payload.data
    }
    return payload
  }, { url: url.toString(), method, body })
}

const formatTimestamp = (value, dateOnly = false) => {
  if (!value) {
    return null
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: dateOnly ? undefined : "2-digit",
    minute: dateOnly ? undefined : "2-digit",
    second: dateOnly ? undefined : "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value))
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  if (dateOnly) {
    return `${values.year}-${values.month}-${values.day}`
  }
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`
}

const withRaw = (normalized, raw) => {
  if (!includeRaw) {
    return normalized
  }
  return { ...normalized, raw }
}

const pageOutput = ({ items, pageInfo }) => {
  return {
    action,
    total: pageInfo?.totalItem ?? items.length,
    page: pageInfo?.currentPage ?? Number(filters.page || 0),
    pageSize: pageInfo?.pageSize ?? limit,
    items: items.slice(0, limit),
  }
}

const isPhone = (value) => {
  return /^(1[0-9]{10})|(\+(9[976]\d|8[987530]\d|6[987]\d|5[90]\d|42\d|3[875]\d|2[98654321]\d|9[8543210]|8[6421]|6[6543210]|5[87654321]|4[987654310]|3[9643210]|2[70]|7|1)\d{1,14})$/.test(value)
}

const ensureNotMultiChildPhone = async (phones) => {
  if (!phones) {
    return
  }
  const phoneValue = Array.isArray(phones) ? phones.join(",") : phones
  const containsChildAccount = await requestJson({
    path: "/conan-commerce-admin/api/users/contains-son-sub",
    query: { phones: phoneValue },
  })
  if (containsChildAccount) {
    throw new Error("检测到多孩账号手机号，请先使用 user.query 查询并改用 User ID")
  }
}

const getActionIds = (label = "ids") => {
  return requireIds(input.ids || input.groupIds || input.userIds || input.id, label)
}

const queryUser = async () => {
  const query = String(input.query || filters.userIdOrPhone || filters.userId || filters.phone || "").trim()
  if (!query) {
    throw new Error("user.query requires query or filters.userIdOrPhone")
  }
  const result = await requestJson({
    path: "/conan-commerce-admin/api/users/base-info-son-sub",
    query: isPhone(query) ? { phone: query } : { userId: query },
  })
  return {
    action,
    query,
    items: (result || []).map((account) => {
      return withRaw({
        userId: String(account.userId),
        maskedPhone: account.phone || null,
        name: account.name || null,
        registeredAt: formatTimestamp(account.createdTime, true),
        primary: Boolean(account.primary),
        subUserIds: (account.subUserIds || []).map((id) => String(id)),
      }, account)
    }),
  }
}

const realtimeText = (group) => {
  if (group.realTimeDesc?.realTime === 1) {
    return "实时群组"
  }
  if (group.realTimeDesc?.realTime === 0) {
    return "非实时群组"
  }
  return null
}

const findGroup = async (queryId) => {
  const result = await requestJson({
    path: "/conan-growth-persona/admin/api/group-info",
    query: { id: queryId, idOrName: queryId, page: 0, pageSize: 20 },
  })
  return (result.list || []).find((group) => String(group.id) === queryId) || null
}

const normalizeGroupCondition = ({ businessName, themeName, tag }) => {
  const operatorText = tag.optionListMap?.find((option) => option.value === tag.selectedOpValue)?.label || tag.selectedOp?.[0]?.label || tag.selectedOpValue || null
  const rawValues = String(tag.inputValue ?? "").split(",").filter(Boolean)
  const valueText = rawValues.map((rawValue) => {
    return tag.canSelectOp?.find((option) => String(option.value) === rawValue)?.label || rawValue
  }).join("、")
  const subject = `${tag.parentTagName ? `${tag.parentTagName}-` : ""}${tag.tagName || tag.tagKey}`
  return {
    businessName,
    themeName,
    tagKey: tag.tagKey || null,
    tagName: tag.tagName || null,
    operator: tag.selectedOpValue || null,
    operatorText,
    value: tag.inputValue ?? null,
    valueText: valueText || null,
    display: `${subject}${operatorText || ""}${valueText ? `「${valueText}」` : ""}`,
  }
}

const normalizeGroupTags = (detail) => {
  if (detail.tagBizVOList?.length) {
    return detail.tagBizVOList.flatMap((business) => {
      return (business.themes || []).map((theme) => {
        return {
          businessName: business.bizName || null,
          themeName: theme.tagTheme || null,
          conditions: (theme.tagMetaDataVOList || []).map((tag) => {
            return normalizeGroupCondition({ businessName: business.bizName || null, themeName: theme.tagTheme || null, tag })
          }),
        }
      })
    })
  }
  return (detail.tagThemeVOList || []).map((theme) => {
    return {
      businessName: null,
      themeName: theme.tagTheme || null,
      conditions: (theme.tagMetaDataVOList || []).map((tag) => {
        return normalizeGroupCondition({ businessName: null, themeName: theme.tagTheme || null, tag })
      }),
    }
  })
}

const queryGroups = async () => {
  const ids = getActionIds("group IDs")
  const items = await Promise.all(ids.map(async (queryId) => {
    const group = await findGroup(queryId)
    if (!group) {
      return { queryId, found: false }
    }
    return withRaw({
      queryId,
      found: true,
      id: String(group.id),
      name: group.groupName || null,
      description: group.groupDesc || null,
      businessType: group.channelName || null,
      realtimeType: realtimeText(group),
      operator: group.ldap || null,
      operatedAt: formatTimestamp(group.createdTime),
    }, group)
  }))
  return { action, items }
}

const getGroupDetails = async () => {
  const ids = getActionIds("group IDs")
  const items = await Promise.all(ids.map(async (queryId) => {
    const listedGroup = await findGroup(queryId)
    if (!listedGroup) {
      return { queryId, found: false }
    }
    const [detail, groupSize, logs] = await Promise.all([
      requestJson({ path: `/conan-growth-persona/admin/api/group-info/${encodeURIComponent(queryId)}` }),
      requestJson({ path: "/conan-growth-persona/admin/api/group-info/solrCount", query: { groupId: queryId } }),
      requestJson({ path: "/conan-admin/api/logs", query: { resourceType: "crm_tag_user_group", resourceId: queryId, page: 0, pageSize: 20 } }),
    ])
    return withRaw({
      queryId,
      found: true,
      id: String(detail.id),
      name: detail.groupName || null,
      description: detail.groupDesc || null,
      channelId: detail.channelId ?? null,
      businessType: detail.channelName || null,
      rule: detail.rule || null,
      groupSize: typeof groupSize === "number" && groupSize !== -1 ? groupSize : null,
      mode: detail.advanced === 1 ? "高级模式" : detail.advanced === 0 ? "简易模式" : null,
      realtimeType: realtimeText(detail),
      nonRealtimeTagNames: detail.realTimeDesc?.nonRealTimeTagKeys || [],
      operator: detail.ldap || null,
      createdAt: formatTimestamp(detail.createdTime),
      tagGroups: normalizeGroupTags(detail),
      logs: (logs.list || []).map((log) => {
        return { action: log.action || null, operator: log.operator || log.ldapId || null, operatedAt: formatTimestamp(log.createdTime) }
      }),
    }, detail)
  }))
  return { action, items }
}

const validateGroupUsers = async () => {
  const groupIds = requireIds(input.groupIds || input.ids || input.id, "group IDs")
  const userIds = requireIds(input.userIds, "user IDs")
  const items = await Promise.all(groupIds.map(async (queryId) => {
    const group = await findGroup(queryId)
    if (!group) {
      return { queryId, found: false, validUsers: [], invalidUsers: [] }
    }
    const result = await requestJson({
      path: "/conan-growth-persona/admin/api/group-info/validate",
      method: "POST",
      body: { groupId: Number(queryId), userIdStr: userIds.join(",") },
    })
    return {
      queryId,
      found: true,
      id: String(group.id),
      name: group.groupName || null,
      validUsers: (result.validUsers || []).map((id) => String(id)),
      invalidUsers: (result.invalidUsers || []).map((id) => String(id)),
    }
  }))
  return { action, userIds, items }
}

const queryCouponTemplates = async () => {
  const query = pickFilters(["ids", "name", "status", "type", "couponType", "test", "courseTag", "validityType", "courseIds", "page", "pageSize"])
  query.page = Number(query.page || 0)
  query.pageSize = Math.min(Number(query.pageSize || limit), 100)
  const idPage = await requestJson({ path: "/conan-commerce-coupon/admin/api/coupons", query })
  const coupons = idPage.list?.length ? await requestJson({ path: "/conan-commerce-coupon/admin/api/coupons/by-ids", query: { couponIds: idPage.list } }) : []
  const items = coupons.map((coupon) => {
    return withRaw({
      id: String(coupon.id),
      name: coupon.name || null,
      description: coupon.desc || null,
      type: coupon.type ?? null,
      couponType: coupon.couponType ?? null,
      amount: coupon.amount ?? null,
      minimumCharge: coupon.minimumCharge ?? null,
      status: coupon.status ?? null,
      test: Boolean(coupon.test),
      courseIds: (coupon.courseIds || []).map((id) => String(id)),
      validFrom: formatTimestamp(coupon.startValidTime),
      validUntil: formatTimestamp(coupon.endValidTime),
    }, coupon)
  })
  return pageOutput({ items, pageInfo: idPage.pageInfo })
}

const queryCoupons = async () => {
  const query = pickFilters(["ids", "userIds", "phones", "names", "comeFrom", "status", "obtainStartTime", "obtainEndTime", "couponId", "type", "test", "courseTag", "courseIds", "page", "pageSize"])
  const keyword = String(input.query || filters.keyword || "").trim()
  if (keyword) {
    if (isPhone(keyword)) {
      query.phones = [keyword]
    } else if (/^\d+$/.test(keyword)) {
      query.userIds = [keyword]
    } else {
      query.names = keyword
    }
  }
  await ensureNotMultiChildPhone(query.phones)
  query.page = Number(query.page || 0)
  query.pageSize = Math.min(Number(query.pageSize || limit), 100)
  const idPage = await requestJson({ path: "/conan-commerce-coupon/admin/api/user-coupons", query })
  const coupons = idPage.list?.length ? await requestJson({ path: "/conan-commerce-coupon/admin/api/user-coupons/by-ids", query: { userCouponIds: idPage.list } }) : []
  const items = coupons.map((coupon) => {
    return withRaw({
      id: String(coupon.id),
      templateId: String(coupon.couponId),
      userId: coupon.userId === undefined ? null : String(coupon.userId),
      name: coupon.name || null,
      amount: coupon.amount ?? null,
      minimumCharge: coupon.minimumCharge ?? null,
      status: coupon.status ?? null,
      obtainedAt: formatTimestamp(coupon.obtainTime),
      usedAt: formatTimestamp(coupon.useTime),
      orderId: coupon.orderId === undefined ? null : String(coupon.orderId),
      issuer: coupon.comeFrom || null,
    }, coupon)
  })
  return pageOutput({ items, pageInfo: idPage.pageInfo })
}

const legacyProductStatus = { 1: "新增", 2: "已上架", 3: "未上架", 4: "废弃" }
const productStatus = { 2: "已上架", 3: "未上架" }

const queryLegacyProducts = async () => {
  const query = pickFilters(["categoryId", "id", "skuIds", "name", "note", "status", "startSaleTime", "endSaleTime", "pediaCourseType", "saleMethod", "bizType", "test", "type", "lessonId", "tag", "courseId", "page", "pageSize"])
  if (input.ids?.length) {
    query.id = input.ids
  }
  query.page = Number(query.page || 0)
  query.pageSize = Math.min(Number(query.pageSize || limit), 100)
  const result = await requestJson({ path: "/conan-commerce-product/admin/api/wares/by-condition", query })
  const items = (result.list || []).map((product) => {
    return withRaw({
      id: String(product.id),
      name: product.name || null,
      note: product.note || null,
      categoryId: product.categoryId || null,
      bizType: product.bizType ?? null,
      status: product.status ?? null,
      statusText: legacyProductStatus[product.status] || null,
      startSaleTime: formatTimestamp(product.startSaleTime),
      endSaleTime: formatTimestamp(product.endSaleTime),
      inventoryTotal: product.inventory?.totalCount ?? null,
      inventoryLeft: product.inventory?.leftCount ?? null,
    }, product)
  })
  return pageOutput({ items, pageInfo: result.pageInfo })
}

const getLegacyProductDetail = async () => {
  const id = getActionIds("product ID")[0]
  const [detail, specifications] = await Promise.all([
    requestJson({ path: `/conan-commerce-product/admin/api/wares/${id}` }),
    requestJson({ path: `/conan-commerce-product/admin/api/wares/${id}/specifications` }),
  ])
  return {
    action,
    item: withRaw({
      id,
      name: detail.waresProductBase?.name || null,
      status: detail.waresProductBase?.status ?? null,
      statusText: legacyProductStatus[detail.waresProductBase?.status] || null,
      test: Boolean(detail.test),
      categoryId: detail.waresProductBase?.categoryId || null,
      limitCount: detail.limitCount ?? null,
      limitDay: detail.limitDay ?? null,
      classifications: detail.classifications || [],
      specifications: specifications || [],
      serviceNotes: detail.serviceNotes || [],
      productTaxInfo: detail.productTaxInfo || null,
      productTags: detail.productTags || [],
    }, detail),
  }
}

const queryProducts = async () => {
  const query = pickFilters(["id", "skuId", "bizTypes", "categoryId", "fulfillResourceIds", "promotionConfigId", "landingPageId", "name", "status", "test", "note", "productCategoryIds", "startSaleTimeFrom", "startSaleTimeTo", "page", "pageSize"])
  if (input.ids?.length) {
    query.id = input.ids[0]
  }
  query.page = Number(query.page || 0)
  query.pageSize = Math.min(Number(query.pageSize || limit), 100)
  const result = await requestJson({ path: "/conan-commerce-product/admin/api/new-product/by-condition", query })
  const items = (result.list || []).map((product) => {
    return withRaw({
      id: String(product.id),
      name: product.spuName || null,
      description: product.spuDesc || null,
      note: product.note || null,
      bizType: product.bizType ?? null,
      bizTypeName: product.bizTypeName || null,
      categoryId: product.categoryId ?? null,
      categoryName: product.categoryName || null,
      status: product.status ?? null,
      statusText: productStatus[product.status] || null,
      test: Boolean(product.test),
      gift: Boolean(product.isGift),
      startSaleTime: formatTimestamp(product.startSaleTime),
      endSaleTime: formatTimestamp(product.endSaleTime),
      inventoryTotal: product.inventory?.totalCount ?? null,
      inventoryLeft: product.inventory?.leftCount ?? null,
    }, product)
  })
  return pageOutput({ items, pageInfo: result.pageInfo })
}

const getProductDetail = async () => {
  const id = getActionIds("product ID")[0]
  const detail = await requestJson({ path: `/conan-commerce-product/admin/api/new-product/${id}` })
  return {
    action,
    item: withRaw({
      id: String(detail.id),
      name: detail.spuName || null,
      description: detail.spuDesc || null,
      note: detail.note || null,
      bizType: detail.bizType ?? null,
      bizTypeName: detail.bizTypeName || null,
      categoryId: detail.categoryId ?? null,
      categoryName: detail.categoryName || null,
      productCategories: detail.productCategories || [],
      status: detail.status ?? null,
      statusText: productStatus[detail.status] || null,
      test: Boolean(detail.test),
      gift: Boolean(detail.isGift),
      limitCount: detail.limitCount ?? null,
      limitDay: detail.limitDay ?? null,
      startSaleTime: formatTimestamp(detail.startSaleTime),
      endSaleTime: formatTimestamp(detail.endSaleTime),
      inventory: detail.inventory || null,
      skuList: detail.skuList || [],
      serviceNotes: detail.serviceNotes || [],
      courseIds: (detail.courseIds || []).map((courseId) => String(courseId)),
    }, detail),
  }
}

const queryOrders = async () => {
  const query = pickFilters(["sourceTypes", "orderIds", "userIds", "phones", "waresIds", "startPaidTime", "endPaidTime", "paymentIds", "transactionIds", "status", "paidType", "couponTemplateIds", "keyfrom", "page", "pageSize"])
  await ensureNotMultiChildPhone(query.phones)
  const hasPreciseFilter = ["orderIds", "userIds", "phones", "paymentIds", "transactionIds"].some((key) => Boolean(query[key]))
  if (!hasPreciseFilter && !query.startPaidTime) {
    query.startPaidTime = Date.now() - 365 * 24 * 60 * 60 * 1000
    query.endPaidTime = Date.now()
  }
  query.page = Number(query.page || 0)
  query.pageSize = Math.min(Number(query.pageSize || limit), 100)
  const result = await requestJson({ path: "/conan-commerce-order/admin/api/orders", query })
  const items = (result.list || []).map((order) => {
    return withRaw({
      id: String(order.id),
      sourceType: order.sourceType ?? null,
      name: order.name || null,
      userId: order.userId === undefined ? null : String(order.userId),
      price: order.price ?? null,
      paidFee: order.paidFee ?? null,
      couponFee: order.couponFee ?? null,
      status: order.status ?? null,
      paidType: order.paidType ?? null,
      paymentId: order.paymentId || null,
      transactionId: order.transactionId || null,
      paidAt: formatTimestamp(order.paidTime),
      couponTemplateIds: (order.couponTemplateIds || []).map((id) => String(id)),
    }, order)
  })
  return pageOutput({ items, pageInfo: result.pageInfo })
}

const getOrderDetail = async () => {
  const id = getActionIds("order ID")[0]
  const [detail, snapshot] = await Promise.all([
    requestJson({ path: `/conan-commerce-order/admin/api/orders/${id}/detail` }),
    requestJson({ path: `/conan-commerce-order/admin/api/orders/${id}/snapshot` }),
  ])
  const order = detail.order || {}
  const payment = detail.commercePayment || {}
  return {
    action,
    item: withRaw({
      id: String(order.id || id),
      sourceType: order.sourceType ?? null,
      userId: order.userId === undefined ? null : String(order.userId),
      status: order.status ?? null,
      price: order.price ?? null,
      paidFee: order.paidFee ?? null,
      paidType: order.paidType ?? null,
      paymentId: payment.id === undefined ? null : String(payment.id),
      transactionId: payment.transactionId || null,
      payChannel: payment.payChannel || null,
      payChannelName: payment.payChannelName || null,
      paidAt: formatTimestamp(order.paidTime),
      items: order.items || [],
      refunds: detail.commerceRefundments || [],
      shipments: detail.shipments || (detail.shipment ? [detail.shipment] : []),
      promotions: {
        coupon: snapshot.snapshotCoupon || null,
        giftCourse: snapshot.snapshotGiftCourse || null,
        promotion: snapshot.snapshotPromotion || null,
      },
    }, { detail, snapshot }),
  }
}

const legacyPriceStatus = { 0: "已停用", 1: "启用中" }

const queryLegacyPriceStrategies = async () => {
  const query = pickFilters(["ids", "name", "note", "channelId", "spuIds", "page", "pageSize"])
  query.page = Number(query.page || 0)
  query.pageSize = Math.min(Number(query.pageSize || limit), 100)
  const result = await requestJson({ path: "/conan-hermes-marketing/admin/api/wares-promotion-configs/v2", query })
  const items = (result.list || []).map((strategy) => {
    return withRaw({
      id: String(strategy.id),
      name: strategy.name || null,
      note: strategy.note || null,
      channelId: strategy.channelId ?? null,
      type: strategy.type ?? null,
      status: strategy.status ?? null,
      statusText: legacyPriceStatus[strategy.status] || null,
      ruleCount: strategy.ruleCount ?? null,
      products: (strategy.skus || []).map((sku) => ({ spuId: String(sku.spuId), skuId: String(sku.skuId), skuName: sku.skuName || null })),
      createdAt: formatTimestamp(strategy.createdTime),
      updatedAt: formatTimestamp(strategy.updatedTime),
    }, strategy)
  })
  return pageOutput({ items, pageInfo: result.pageInfo })
}

const getLegacyPriceStrategyDetail = async () => {
  const id = getActionIds("price strategy ID")[0]
  const detail = await requestJson({ path: `/conan-hermes-marketing/admin/api/wares-promotion-configs/v2/${id}` })
  return {
    action,
    item: withRaw({
      id: String(detail.id || id),
      name: detail.name || null,
      note: detail.note || null,
      channelId: detail.channelId ?? null,
      type: detail.type ?? null,
      status: detail.status ?? null,
      statusText: legacyPriceStatus[detail.status] || null,
      promotionType: detail.promotionType || null,
      couponAvailable: Boolean(detail.couponAvailable),
      products: detail.skus || [],
      activityRules: detail.activityRules || [],
      saleConfig: detail.saleConfig || null,
      createdAt: formatTimestamp(detail.createdTime),
      updatedAt: formatTimestamp(detail.updatedTime),
    }, detail),
  }
}

const queryPriceStrategies = async () => {
  const query = pickFilters(["ids", "name", "bizType", "bizId", "spuIds", "note", "type", "scenarioType", "skuIds", "promotionType", "active", "page", "pageSize"])
  query.page = Number(query.page || 0)
  query.pageSize = Math.min(Number(query.pageSize || limit), 100)
  const result = await requestJson({ path: "/conan-hermes-marketing/admin/api/new-promotion-configs", query })
  const items = (result.list || []).map((strategy) => {
    return withRaw({
      id: String(strategy.id),
      name: strategy.name || null,
      note: strategy.note || null,
      bizType: strategy.bizType ?? null,
      bizId: strategy.bizId ?? null,
      promotionType: strategy.promotionType ?? null,
      scenarioType: strategy.scenarioType ?? null,
      type: strategy.type ?? null,
      active: Boolean(strategy.active),
      products: (strategy.skus || strategy.productSkuVOList || []).map((sku) => ({ spuId: String(sku.spuId), skuId: String(sku.skuId), skuName: sku.skuName || null })),
      createdAt: formatTimestamp(strategy.createdTime),
      updatedAt: formatTimestamp(strategy.updatedTime),
    }, strategy)
  })
  return pageOutput({ items, pageInfo: result.pageInfo })
}

const getPriceStrategyDetail = async () => {
  const id = getActionIds("price strategy ID")[0]
  const detail = await requestJson({ path: `/conan-hermes-marketing/admin/api/new-promotion-configs/${id}` })
  return {
    action,
    item: withRaw({
      id: String(detail.id || id),
      name: detail.name || null,
      note: detail.note || null,
      bizType: detail.bizType ?? null,
      bizId: detail.bizId ?? null,
      promotionType: detail.promotionType ?? null,
      scenarioType: detail.scenarioType ?? null,
      type: detail.type ?? null,
      active: Boolean(detail.active),
      couponLimitType: detail.userCouponLimitType ?? null,
      priceDimension: detail.priceDimension ?? null,
      products: detail.productSkuVOList || [],
      activityRules: detail.activityRules || [],
      bulkConfig: detail.bulkConfig || null,
      saleConfig: detail.saleConfig || null,
    }, detail),
  }
}

const handlers = {
  "user.query": queryUser,
  "group.query": queryGroups,
  "group.detail": getGroupDetails,
  "group.validate": validateGroupUsers,
  "coupon-template.query": queryCouponTemplates,
  "coupon.query": queryCoupons,
  "legacy-product.query": queryLegacyProducts,
  "legacy-product.detail": getLegacyProductDetail,
  "product.query": queryProducts,
  "product.detail": getProductDetail,
  "order.query": queryOrders,
  "order.detail": getOrderDetail,
  "legacy-price-strategy.query": queryLegacyPriceStrategies,
  "legacy-price-strategy.detail": getLegacyPriceStrategyDetail,
  "price-strategy.query": queryPriceStrategies,
  "price-strategy.detail": getPriceStrategyDetail,
}

return handlers[action]()
