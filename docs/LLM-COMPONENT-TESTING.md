# LLM-friendly component testing

`playwright-stubs` is a strong fit for **AI-assisted component development**: one declaration pattern, serializable state, browser-real rendering, and Playwright screenshots for visual validation.

## The problem LLMs face

Component tests need two things that are awkward to combine:

1. **Precise state** — "API returns user Alice", "analytics fired with X"
2. **Observable verification** — DOM assertions and screenshots

Stories handle defaults well but multiply for every edge case. Provider scaffolding is verbose and easy for agents to get wrong.

## The pattern

```ts
import { test, expect } from './fixtures'

const getUser = test.mock('./api', 'getUser')
getUser.mockResolvedValue({ id: '1', name: 'Alice' })

test('renders logged-in user', async ({ mount }) => {
  const component = await mount('demo/UserProfile/Default', { id: '1' })

  // Behavior: did the component call the dependency correctly?
  await expect(getUser).toHaveBeenCalledWith('1')

  // Presentation: does it look right?
  await expect(component.getByText('Alice')).toBeVisible()
  await expect(component).toHaveScreenshot()
})
```

## Why this works for agents

| Property | Benefit |
|---|---|
| **One API** — `test.mock()` at file top only | No fixture variants to confuse code generation |
| **Serializable mocks** — `mockResolvedValue({ ... })` | Safe across Node/browser boundary; no closure errors |
| **Loud failures** — unattached mocks, unknown exports | Agent can self-correct from error messages |
| **Stories stay stable** — one story, many mock scenarios | Reuse `demo/UserProfile/Default` with different `test.mock()` setups |
| **Screenshots** — `toHaveScreenshot()` or `page.screenshot()` | LLM vision loops can validate pixels |

## Agent-friendly rules

1. Always declare mocks at the **top of the test file** with `test.mock()`.
2. Prefer `mockResolvedValue` / `mockReturnValue` over `mockImplementation`.
3. Use `mockImplementation` only for simple, closure-free transforms.
4. Mount with story id strings: `mount('demo/Component/Default', { props })`.
5. Assert **both** call contracts (`toHaveBeenCalledWith`) and visible DOM.

## Stories vs mocks

| Use stories for | Use mocks for |
|---|---|
| Gallery browsing, default happy path | Error states, specific API payloads |
| Provider layout that is part of the UI | "Did it call `track()` with the right event?" |
| Human exploration | Parameterized agent test loops |

## Two validation layers

```text
test.mock()  →  pins dependency data (what imports return)
     +
mount()      →  renders real component in browser
     +
assertions   →  DOM locators + mock call matchers
     +
screenshot   →  visual regression or LLM vision check
```

playwright-stubs owns the **data plane**. Playwright owns the **visual plane**.
