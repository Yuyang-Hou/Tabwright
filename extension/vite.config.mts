import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import * as esbuild from 'esbuild'
import { defineConfig, type Plugin } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'

const __filename = url.fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Bundle the playwriter package version into the extension so it can report
// which playwriter version it was built against. CLI/MCP use this to warn
// when the extension is outdated.
const playwriterPkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../playwriter/package.json'), 'utf-8'))

const defineEnv: Record<string, string> = {
  'process.env.PLAYWRITER_PORT': JSON.stringify(process.env.PLAYWRITER_PORT || '19988'),
  __PLAYWRITER_VERSION__: JSON.stringify(playwriterPkg.version),
  __PLAYWRITER_OPEN_WELCOME_PAGE__: JSON.stringify(process.env.PLAYWRITER_OPEN_WELCOME_PAGE !== '0'),
}
if (process.env.TESTING) {
  defineEnv['import.meta.env.TESTING'] = 'true'
}

// Allow tests to build per-port extension outputs to avoid parallel run conflicts.
const outDir = process.env.PLAYWRITER_EXTENSION_DIST || 'dist'

function escapeNonAscii(value: string): string {
  return value.replace(/[^\x00-\x7F]/g, (character) => {
    const codePoint = character.codePointAt(0)
    if (codePoint === undefined) {
      return character
    }
    if (codePoint <= 0xffff) {
      return `\\u${codePoint.toString(16).padStart(4, '0')}`
    }
    const shifted = codePoint - 0x10000
    const high = 0xd800 + (shifted >> 10)
    const low = 0xdc00 + (shifted & 0x3ff)
    return `\\u${high.toString(16).padStart(4, '0')}\\u${low.toString(16).padStart(4, '0')}`
  })
}

function buildRrwebRecorderContentScript(): Plugin {
  return {
    name: 'build-rrweb-recorder-content-script',
    async closeBundle() {
      const outfile = path.resolve(__dirname, outDir, 'rrweb-recorder.js')
      const result = await esbuild.build({
        entryPoints: [path.resolve(__dirname, 'src/rrweb-recorder.ts')],
        bundle: true,
        charset: 'ascii',
        format: 'iife',
        globalName: 'PlaywriterRrwebRecorder',
        outfile,
        platform: 'browser',
        target: 'chrome110',
        write: false,
      })
      const outputFile = result.outputFiles[0]
      if (!outputFile) {
        throw new Error('Failed to build rrweb recorder content script')
      }
      // Chrome content scripts cannot depend on ESM chunk imports, so recorder is emitted as one IIFE file.
      fs.mkdirSync(path.dirname(outfile), { recursive: true })
      fs.writeFileSync(outfile, escapeNonAscii(outputFile.text))
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
    buildRrwebRecorderContentScript(),
  ],

  build: {
    outDir,
    emptyOutDir: false,
    minify: false,
    rollupOptions: {
      input: {
        background: path.resolve(__dirname, 'src/background.ts'),
        options: path.resolve(__dirname, 'src/options.html'),
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
