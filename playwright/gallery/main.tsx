import { flushSync } from 'react-dom'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const stories = import.meta.glob('../../src/**/*.story.{tsx,jsx}')

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
  const component = mod?.[name] ?? mod?.default
  return typeof component === 'function' ? component : undefined
}

const rootEl = document.getElementById('root')!
let root: Root | undefined

declare global {
  interface Window {
    mount: (params: { story: string; props?: Record<string, unknown> }) => Promise<void>
    unmount: () => Promise<void>
  }
}

window.mount = async ({ story, props }) => {
  const Story = await resolve(story)
  if (!Story) throw new Error(`Unknown story: ${story}`)
  root ??= createRoot(rootEl)
  flushSync(() => root!.render(createElement(Story, props ?? {})))
}

window.unmount = async () => {
  root?.unmount()
  root = undefined
}
