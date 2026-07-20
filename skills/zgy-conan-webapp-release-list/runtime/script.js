const projectName = input.projectName || input.project || "conan-pedia-web"
const requestedKey = input.key || input.webAppKey || null
const pageIndex = Number.isInteger(input.page) ? input.page : 0
const pageSize = Number.isInteger(input.pageSize) ? input.pageSize : 10

if (pageIndex < 0) throw new Error("page must be >= 0")
if (pageSize < 1 || pageSize > 100) throw new Error("pageSize must be between 1 and 100")

await page.goto(
  `https://conan-webapp.zhenguanyu.com/#/publish?name=${encodeURIComponent(projectName)}`,
  { waitUntil: "domcontentloaded" },
)
await page.waitForTimeout(1000)

const result = await page.evaluate(
  async ({ projectName, requestedKey, pageIndex, pageSize }) => {
    async function getJson(url) {
      const response = await fetch(url, {
        credentials: "include",
        headers: { accept: "application/json" },
      })
      const text = await response.text()
      let body
      try {
        body = text ? JSON.parse(text) : null
      } catch {
        body = text
      }
      if (!response.ok) {
        throw new Error(`GET ${url} failed: ${response.status} ${String(text).slice(0, 200)}`)
      }
      return body
    }

    const apiBase = "https://ytkconan.zhenguanyu.com/conan-web-app/admin/api/web-app"
    const keys = await getJson(`${apiBase}/keys?name=${encodeURIComponent(projectName)}`)
    const key = requestedKey || (Array.isArray(keys) ? keys[0] : null)
    if (!key) throw new Error(`No WebAppKey found for project ${projectName}`)

    const [searchResult, releaseResult, fullVersion] = await Promise.all([
      getJson(`${apiBase}/key/search?key=${encodeURIComponent(key)}`),
      getJson(`${apiBase}/list?key=${encodeURIComponent(key)}&page=${pageIndex}&pageSize=${pageSize}`),
      getJson(`${apiBase}/full-version?key=${encodeURIComponent(key)}`).catch(() => null),
    ])

    const statusLabel = {
      0: "待发布",
      1: "已发布",
      2: "发布中",
      3: "发布失败",
    }

    const releases = (releaseResult.list || []).map((item) => {
      const commitLines = String(item.commitInfo || "").split(/\r?\n/)
      return {
        key: item.key,
        version: item.version,
        deployStatus: item.deployStatus,
        deployStatusLabel: statusLabel[item.deployStatus] || String(item.deployStatus),
        latestFullVersion: Boolean(item.latestFullVersion),
        latestGrayscaleVersion: Boolean(item.latestGrayscaleVersion),
        commitAuthor: commitLines[0] || "",
        commitMessage: commitLines.slice(1).join("\n"),
        commitInfo: item.commitInfo || "",
        commitId: item.commitId || "",
        creatorLdap: item.creatorLdap || "",
        createTime: item.createTime || null,
        deployLdap: item.deployLdap || null,
        deployTime: item.deployTime || null,
        buildId: item.buildId,
        locked: Boolean(item.locked),
        previewUrl: item.previewUrl || "",
        entry: item.entry || "",
        grayscaleData: item.grayscaleData || null,
      }
    })

    return {
      projectName,
      key,
      availableKeys: Array.isArray(keys) ? keys : [],
      pageInfo: releaseResult.pageInfo || null,
      latestFullVersion: fullVersion,
      keySummary: Array.isArray(searchResult.list) ? searchResult.list[0] || null : null,
      releases,
    }
  },
  { projectName, requestedKey, pageIndex, pageSize },
)

return result
