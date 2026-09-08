# Vue gallery sketch

Minimal Vue 3 gallery entry for `playwright-stubs`. Adapt paths and story glob to your project.

```ts
// playwright/gallery/main.ts
import { createApp, h, shallowRef, type App, type Component } from 'vue'

const stories = import.meta.glob('../../src/**/*.story.{ts,tsx,vue}')

function storyPath(file: string): string {
  return file.replace(/^(\.\.\/)+src\//, '').replace(/\.story\.[^.]+$/, '')
}

async function resolve(storyId: string) {
  const sep = storyId.lastIndexOf('/')
  const path = storyId.slice(0, sep)
  const name = storyId.slice(sep + 1)
  const file = Object.keys(stories).find(
    (candidate) => storyPath(candidate) === path || storyPath(candidate).endsWith(`/${path}`),
  )
  const mod = (file && (await stories[file]())) as Record<string, unknown> | undefined
  return mod?.[name] ?? mod?.default
}

const story = shallowRef<Component | null>(null)
const props = shallowRef<Record<string, unknown>>({})
const host = { render: () => (story.value ? h(story.value, props.value) : null) }
let app: App | undefined

window.mount = async ({ story: id, props: next }: { story: string; props?: Record<string, unknown> }) => {
  const resolved = await resolve(id)
  if (!resolved) throw new Error(`Unknown story: ${id}`)
  story.value = resolved
  props.value = next ?? {}
  if (!app) {
    app = createApp(host)
    app.mount('#root')
  }
}

window.unmount = async () => {
  app?.unmount()
  app = undefined
}
```

Vite config: same as React — add `playwrightStubs()` from `playwright-stubs/vite-plugin`.
