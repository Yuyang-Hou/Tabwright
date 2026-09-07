import './globals.css'
import { app } from '@holocron.so/vite/app'

export { app }

export default {
  fetch(request: Request): Promise<Response> {
    return app.handle(request)
  },
}
