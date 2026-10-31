import assert from 'node:assert/strict'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test, { after, before } from 'node:test'
import { build } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let directory
let render

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'connect-markdown-test-'))
  await symlink(join(root, 'node_modules'), join(directory, 'node_modules'), 'dir')
  const entry = join(directory, 'entry.mjs')
  await writeFile(entry, `
    import { createElement } from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { Markdown } from '@/components/chat/markdown'
    export const render = (text, cursor = false) => renderToStaticMarkup(createElement(Markdown, {
      text, tail: cursor ? createElement('span', { 'data-test-cursor': true }, 'cursor') : undefined,
    }))
  `)
  // Compile the actual renderer; only the browser-backed language store is replaced.
  const result = await build({
    configFile: false,
    root,
    logLevel: 'silent',
    resolve: { alias: [
      { find: '@/i18n', replacement: 'virtual:markdown-test-i18n' },
      { find: '@', replacement: join(root, 'src/renderer/src') },
    ] },
    plugins: [{
      name: 'markdown-test-i18n',
      resolveId(id) { if (id === 'virtual:markdown-test-i18n') return `\0${id}` },
      load(id) { if (id === '\0virtual:markdown-test-i18n') return 'export const useI18n = () => ({ t: text => text })' },
    }],
    build: {
      ssr: entry,
      write: false,
      minify: false,
      rolldownOptions: { output: { format: 'es', codeSplitting: false } },
    },
  })
  const module = result.output.find((file) => file.type === 'chunk' && file.isEntry)
  const compiled = join(directory, 'render.mjs')
  await writeFile(compiled, module.code)
  ;({ render } = await import(pathToFileURL(compiled).href))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('GFM tables retain cells, alignment and inline formatting', () => {
  const html = render('| 名称 | 数量 | 备注 |\n| :--- | ---: | :---: |\n| **模型** | 12 | `a\\|b` |')
  assert.match(html, /<table[\s>]/)
  assert.match(html, /<thead[\s>]/)
  assert.match(html, /<tbody[\s>]/)
  assert.equal((html.match(/<th[\s>]/g) ?? []).length, 3)
  assert.equal((html.match(/<td[\s>]/g) ?? []).length, 3)
  assert.match(html, /text-align:left/)
  assert.match(html, /text-align:right/)
  assert.match(html, /text-align:center/)
  assert.match(html, /<strong[^>]*>模型<\/strong>/)
  assert.match(html, /<code[^>]*>a\|b<\/code>/)
})

test('all heading levels, setext headings, quotes and rules render as blocks', () => {
  const html = render('# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six\n\nSetext\n======\n\n> 引用 **重点**\n>\n> - 嵌套列表\n\n---')
  for (let depth = 1; depth <= 6; depth++) assert.match(html, new RegExp(`<h${depth}[\\s>]`))
  assert.match(html, /<h1[^>]*>Setext<\/h1>/)
  assert.match(html, /<blockquote[\s>]/)
  assert.match(html, /<blockquote[\s\S]*<ul[\s>][\s\S]*嵌套列表/)
  assert.match(html, /<hr[\s/>]/)
})

test('nested lists preserve ordered starts and task checkbox state', () => {
  const html = render('3. 第三步\n   - 子项\n     - 深层子项\n4. 第四步\n\n- [x] 已完成\n- [ ] 待处理')
  assert.match(html, /<ol[^>]*start="3"/)
  assert.match(html, /<li[^>]*>[\s\S]*第三步[\s\S]*<ul[^>]*>[\s\S]*<li[^>]*>[\s\S]*子项[\s\S]*<ul[\s>]/)
  const inputs = html.match(/<input\b[^>]*>/g) ?? []
  assert.equal(inputs.length, 2)
  assert.ok(inputs.every((input) => input.includes('type="checkbox"') && input.includes('disabled=""')))
  assert.match(inputs[0], /checked=""/)
  assert.doesNotMatch(inputs[1], /checked=/)
})

test('Chinese inline nesting, references, escapes and entities follow Markdown', () => {
  const html = render('中文**加粗**继续，**粗体里的*斜体***，~~删除~~。\n\n[**文档**][docs] &amp; &#x4e2d; &copy; `&amp;` \\*原样\\*\n\n[docs]: https://example.com/docs "说明"')
  assert.match(html, /中文<strong[^>]*>加粗<\/strong>继续/)
  assert.match(html, /<strong[^>]*>粗体里的<em[^>]*>斜体<\/em><\/strong>/)
  assert.match(html, /<del[^>]*>删除<\/del>/)
  assert.match(html, /<a[^>]*href="https:\/\/example.com\/docs"[^>]*>[\s\S]*<strong[^>]*>文档<\/strong>/)
  assert.match(html, /&amp; 中 ©/)
  assert.match(html, /<code[^>]*>&amp;amp;<\/code>/)
  assert.match(html, /\*原样\*/)
})

test('fenced code remains literal and exposes a copy action', () => {
  const html = render('~~~ts title="example"\nconst literal = "&amp; <tag>";\n~~~')
  assert.match(html, /<pre[\s>]/)
  assert.match(html, /<code[\s>]/)
  assert.match(html, /&amp;amp; &lt;tag&gt;/)
  assert.match(html, /<button[^>]*(?:aria-label|title)="Copy code"/)
  assert.doesNotMatch(html, /<tag>/)
})

test('streaming partial fences and markup keep their content and cursor', () => {
  for (const text of ['```ts\nconst ready =', '[unfinished](https://', '**未结束', '| A | B |\n| --- | --- |\n| one |', '', '\n\n', '---', '[docs]: https://example.com']) {
    const html = render(text, true)
    assert.match(html, /data-test-cursor="true"/)
  }
  const code = render('```ts\nconst ready =')
  assert.match(code, /<pre[\s>]/)
  assert.match(code, /ready/)
})

test('raw HTML and unsupported links stay text; ordinary links remain usable', () => {
  const html = render('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[unsafe](javascript:alert(1)) [local](./README.md) [mail](mailto:dev@example.com) [web](https://example.com)')
  assert.doesNotMatch(html, /<script[\s>]|<img[\s>]|href="javascript:|href="\.\//)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
  assert.match(html, /unsafe/)
  assert.match(html, /local/)
  assert.match(html, /href="mailto:dev@example.com"/)
  assert.match(html, /href="https:\/\/example.com"/)
})

test('images use supported sources and preserve alternative text', () => {
  const pixel = 'data:image/png;base64,iVBORw0KGgo='
  const html = render(`![示意图](https://example.com/diagram.png)\n\n![pixel](${pixel})\n\n![不支持](file:///tmp/local.png)`)
  const images = html.match(/<img\b[^>]*>/g) ?? []
  assert.equal(images.length, 2)
  assert.ok(images.every((image) => /referrerPolicy="no-referrer"/i.test(image)))
  assert.match(html, /alt="示意图"/)
  assert.match(html, /src="data:image\/png;base64,iVBORw0KGgo="/)
  assert.match(html, /不支持/)
  assert.doesNotMatch(html, /src="file:/)
})
