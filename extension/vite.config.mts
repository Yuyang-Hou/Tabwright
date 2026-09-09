import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'

const __filename = url.fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Bundle the Tabwright package version into the extension so it can report
// which Tabwright version it was built against. CLI/MCP use this to warn
// when the extension is outdated.
const tabwrightPkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../tabwright/package.json'), 'utf-8'))

const defineEnv: Record<string, string> = {
  'process.env.TABWRIGHT_PORT': JSON.stringify(process.env.TABWRIGHT_PORT || process.env.PLAYWRITER_PORT || '19988'),
  'process.env.PLAYWRITER_PORT': JSON.stringify(process.env.TABWRIGHT_PORT || process.env.PLAYWRITER_PORT || '19988'),
  __PLAYWRITER_VERSION__: JSON.stringify(tabwrightPkg.version),
  __PLAYWRITER_OPEN_WELCOME_PAGE__: JSON.stringify(
    (process.env.TABWRIGHT_OPEN_WELCOME_PAGE || process.env.PLAYWRITER_OPEN_WELCOME_PAGE) !== '0',
  ),
}
if (process.env.TESTING) {
  defineEnv['import.meta.env.TESTING'] = 'true'
}

// Allow tests to build per-port extension outputs to avoid parallel run conflicts.
const outDir = process.env.TABWRIGHT_EXTENSION_DIST || process.env.PLAYWRITER_EXTENSION_DIST || 'dist'

function copyLocales(): Plugin {
  return {
    name: 'copy-extension-locales',
    closeBundle() {
      const source = path.resolve(__dirname, '_locales')
      if (!fs.existsSync(source)) {
        return
      }
      fs.cpSync(source, path.resolve(__dirname, outDir, '_locales'), { recursive: true })
    },
  }
}

export default defineConfig({
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: path.resolve(__dirname, 'icons/*'),
          dest: 'icons',
        },

        {
          src: path.resolve(__dirname, 'manifest.json'),
          dest: '.',
          transform: (content) => {
            const manifest = JSON.parse(content)

            // Only include tabs permission during testing
            if (process.env.TESTING) {
              if (!manifest.permissions.includes('tabs')) {
                manifest.permissions.push('tabs')
              }
            }

            // Inject key for stable extension ID in dev/test builds (not production)
            // This ensures all developers get the same extension ID: pebbngnfojnignonigcnkdilknapkgid
            if (!process.env.PRODUCTION) {
              manifest.key =
                'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwCJoq5UYhOo5x8s50pVBUHjQ8idyUHnZFDj1JspWJPe6kvM7RFIaE/y5WTAH05kuK0R7v/ipcGA4ywA5wKdPKHZzkl5xstlNPj0Ivu4CqLobU7eY5G3k3Gq7wql2pbwb/A8Nat4VLbfBjQLA6TGWd3LQOHS6M0B3AvrtEw7DLDUdGKh4SCLewCbdlDIzpXQwKOzrRPyLFBwj9eEeITy5aNwJ9r9JMNBvACVZiRCHsGI6DufU+OiIO232l/8OoNNt6kdTMyNgiqOogFApXPJwREUwZHGqjXD3s6bXiBIQtwkNyZfemHKkxj6g/fhCV2EMgTY6+ikQEY1gEJMrRVmcYQIDAQAB'
            }

            return JSON.stringify(manifest, null, 2)
          },
        },
      ],
    }),
    copyLocales(),
  ],

  build: {
    outDir,
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      input: {
        background: path.resolve(__dirname, 'src/background.ts'),
        welcome: path.resolve(__dirname, 'src/welcome.html'),
      },
      output: {
        entryFileNames: '[name].js',
        format: 'es',
      },
    },
  },
  define: defineEnv,
})
