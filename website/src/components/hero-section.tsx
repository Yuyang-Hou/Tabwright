export function HeroSection() {
  return (
    <section className='tw-hero' aria-labelledby='tw-title'>
      <div className='tw-hero-copy'>
        <p className='tw-eyebrow'>TABWRIGHT / BROWSER TOOLS FOR AGENTS</p>
        <h1 id='tw-title'>
          不止操作网页。
          <br />
          <span>理解它如何运行。</span>
        </h1>
        <p className='tw-lead'>
          把浏览器的调试能力交给 AI。从页面到请求、源码和运行时，像前端工程师一样理解问题，得到你想要的结果。
        </p>
        <div className='tw-actions'>
          <a className='tw-primary' href='/docs/installation'>
            连接你的浏览器 <span aria-hidden='true'>↗</span>
          </a>
          <a className='tw-secondary' href='/docs/use-cases'>
            看看能做什么 <span aria-hidden='true'>→</span>
          </a>
        </div>
        <p className='tw-caption'>基于 Playwriter · 你的 Chrome · CLI / MCP</p>
      </div>
      <div className='tw-evidence' aria-label='调试思路示例，不是实时浏览器数据'>
        <div className='tw-evidence-bar'>
          <span>一个问题，多种证据</span>
          <span className='tw-example'>示例</span>
        </div>
        <p className='tw-question'>“为什么这个图表没有数据？”</p>
        <ol className='tw-evidence-list'>
          <li>
            <span className='tw-layer'>NETWORK</span>
            <div>
              <strong>请求成功，响应里有数据</strong>
              <code>GET /api/chart → 200</code>
            </div>
          </li>
          <li>
            <span className='tw-layer'>SOURCE</span>
            <div>
              <strong>找到渲染前的数据转换</strong>
              <code>rows.filter(isVisible)</code>
            </div>
          </li>
          <li>
            <span className='tw-layer'>RUNTIME</span>
            <div>
              <strong>断点确认：过滤条件排除了全部行</strong>
              <code>rows.length: 24 → visible.length: 0</code>
            </div>
          </li>
        </ol>
        <p className='tw-evidence-note'>AI 自由选择证据与方法，不是每个任务都要走这三步。</p>
      </div>
    </section>
  )
}
