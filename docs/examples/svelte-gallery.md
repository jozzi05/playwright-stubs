# Svelte gallery sketch

Minimal Svelte gallery entry for `playwright-stubs`. Adapt paths and story glob to your project.

```ts
// playwright/gallery/main.ts
import { mount as svelteMount, unmount as svelteUnmount } from 'svelte'

const stories = import.meta.glob('../../src/**/*.story.{ts,svelte}')

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

let component: ReturnType<typeof svelteMount> | undefined

window.mount = async ({ story, props }: { story: string; props?: Record<string, unknown> }) => {
  const Story = await resolve(story)
  if (!Story) throw new Error(`Unknown story: ${story}`)
  if (component) svelteUnmount(component)
  component = svelteMount(Story, { target: document.getElementById('root')!, props })
}

window.unmount = async () => {
  if (component) svelteUnmount(component)
  component = undefined
}
```

Vite config: add `@sveltejs/vite-plugin-svelte` and `playwrightStubs()` from `playwright-stubs/vite-plugin`.
