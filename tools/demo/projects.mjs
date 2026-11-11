/** Small, self-contained project libraries. These are source fixtures, never run receipts. */
const json = value => JSON.stringify(value, null, 2) + '\n'
const write = (path, content, message) => ({ path, content: content.endsWith('\n') ? content : content + '\n', message })
const markdown = (title, body) => `# ${title}\n\n${body}\n`
const packageFile = name => json({ name: `preset-${name}`, private: true, type: 'module', description: 'Browsable source example; no dependency installation required.' })

const profiles = {
  embeddings: {
    title: 'Field guide search collection', description: 'A tiny document corpus, transparent keyword vectors and a local similarity helper; no model or network is required.', purpose: 'Make document retrieval inspectable from source text through rankings.',
    files: {
      'corpus/water.md': markdown('Carry and refill water', 'Carry a water bottle. Refill at a safe water source. Plan water stops before a long trail.'),
      'corpus/layers.md': markdown('Pack a warm layer', 'Weather changes on a trail. Carry a warm layer and a rain shell in your pack.'),
      'corpus/repair.md': markdown('Repair a loose buckle', 'Inspect the pack buckle before a walk. Replace a damaged buckle rather than replacing the whole pack.'),
      'corpus/navigation.md': markdown('Find the route', 'Carry a map and check trail junctions. A paper map remains useful when a phone battery is empty.'),
      'data/vocabulary.json': json(['water', 'pack', 'trail', 'map', 'repair']),
      'data/documents.json': json([{ id: 'water', path: 'corpus/water.md' }, { id: 'layers', path: 'corpus/layers.md' }, { id: 'repair', path: 'corpus/repair.md' }, { id: 'navigation', path: 'corpus/navigation.md' }]),
      'data/example-vectors.json': json({ illustrative: true, method: 'Hand-authored keyword-presence examples, not model output', dimensions: ['water', 'pack', 'trail', 'map', 'repair'], vectors: { water: [1, 0, 1, 0, 0], layers: [0, 1, 1, 0, 0], repair: [0, 1, 0, 0, 1], navigation: [0, 0, 1, 1, 0] } }),
      'src/vectorize.js': 'export function vectorize(text, vocabulary) { const tokens = new Set(text.toLowerCase().match(/[a-z]+/g) ?? []); return vocabulary.map(word => Number(tokens.has(word))) }\n',
      'src/similarity.js': 'export function cosine(a, b) { if (a.length !== b.length) throw new RangeError("Vector dimensions differ"); const dot = a.reduce((sum, n, i) => sum + n * b[i], 0), lengthA = Math.hypot(...a), lengthB = Math.hypot(...b); return lengthA && lengthB ? dot / (lengthA * lengthB) : 0 }\n',
      'docs/data-card.md': markdown('Data card', 'Four fictional field-guide passages written for this fixture. No personal information, external corpus or model-generated vector is included. Keyword vectors explain mechanics, not semantic search quality.'),
      'docs/retrieval.md': markdown('Retrieval pipeline', 'Tokenize the query with the same vocabulary, compute cosine similarity, then rank documents. The corpus is intentionally small enough to inspect by hand.'),
      'package.json': packageFile('embeddings'),
    },
    features: [
      { name: 'feature-chunk-manifest', title: 'Traceable chunks', commits: [
        ['data/chunks.json', json([{ id: 'water:1', document: 'water', heading: 'Carry and refill water', path: 'corpus/water.md' }]), 'Link the first retrieval chunk to its document'],
        ['docs/chunking.md', markdown('Chunking policy', 'Keep each short passage as one chunk. Preserve its document ID, source path and heading so a result can explain where it came from.'), 'Specify source-preserving chunk metadata'],
        ['data/chunks.json', json([{ id: 'water:1', document: 'water', path: 'corpus/water.md' }, { id: 'layers:1', document: 'layers', path: 'corpus/layers.md' }, { id: 'repair:1', document: 'repair', path: 'corpus/repair.md' }, { id: 'navigation:1', document: 'navigation', path: 'corpus/navigation.md' }]), 'Cover all four source documents in the manifest'],
        ['docs/chunking.md', markdown('Chunking policy', 'Each short passage is one chunk. Keep a stable document ID and source path. A chunk ID changes only when segmentation changes. Do not silently compare scores across different vocabulary or chunking versions.'), 'Document version boundaries for retrieval comparisons'],
      ] },
      { name: 'feature-ranked-results', title: 'Stable ranking', commits: [
        ['src/rank.js', 'import { cosine } from "./similarity.js"\nexport function rank(query, documents) { return documents.map(document => ({ id: document.id, score: cosine(query, document.vector) })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)) }\n', 'Rank vectors with an explicit tie-breaker'],
        ['examples/query.json', json({ illustrative: true, query: 'water trail', vocabulary: ['water', 'pack', 'trail', 'map', 'repair'], expectedQueryVector: [1, 0, 1, 0, 0], expectedFirstDocument: 'water' }), 'Add a hand-worked retrieval query'],
        ['docs/ranking.md', markdown('Ranking', 'Use descending cosine score and ascending document ID for ties. Scores are similarities, not probabilities. The worked query is an expectation, not an executed result.'), 'Explain ranking scores without overstating confidence'],
      ] },
      { name: 'feature-corpus-provenance', title: 'Corpus provenance', commits: [
        ['data/provenance.json', json({ author: 'LayerFS Connect AI-assisted sample content', source: 'Fictional passages stored in this fixture', licenseNote: 'Part of the project fixture', vectorMethod: 'Deterministic keyword presence; no embedding model or remote API' }), 'Record the deliberately local corpus provenance'],
        ['docs/maintenance.md', markdown('Corpus maintenance', 'When a passage changes, rebuild its vector with the same vocabulary version and review linked relevance judgments.'), 'Connect source edits to retrieval maintenance'],
        ['docs/maintenance.md', markdown('Corpus maintenance', 'Edit source passages, regenerate vectors with the declared vocabulary version, then review relevance judgments. Record both corpus and vocabulary versions with real evaluation output. This fixture does not preclaim a completed evaluation.'), 'Define evidence needed for a later real evaluation'],
      ] },
    ],
    maintenance: { name: 'fix-empty-query', title: 'Empty-query handling', commits: [
      ['src/vectorize.js', 'export function vectorize(text, vocabulary) { if (typeof text !== "string") throw new TypeError("Expected text"); const tokens = new Set(text.toLowerCase().match(/[a-z]+/g) ?? []); return vocabulary.map(word => Number(tokens.has(word))) }\nexport function hasSignal(vector) { return vector.some(value => value !== 0) }\n', 'Expose whether a query contains known vocabulary'],
      ['examples/empty-query.json', json({ illustrative: true, cases: [{ text: '', vector: [0, 0, 0, 0, 0], expectedBehavior: 'Ask for a more specific query' }, { text: '???', vector: [0, 0, 0, 0, 0], expectedBehavior: 'Ask for a more specific query' }] }), 'Describe empty and punctuation-only query expectations'],
      ['docs/retrieval.md', markdown('Retrieval pipeline', 'Tokenize query and corpus using the same vocabulary. If the query has no known terms, ask for a more specific query instead of presenting tied zero scores as relevant results. Otherwise compute cosine similarity and rank by score, then stable document ID.'), 'Prevent zero-signal queries from appearing meaningful'],
    ] },
    explorations: [
      { name: 'explore-multilingual', title: 'Multilingual vocabulary', files: [['proposals/multilingual.md', markdown('Multilingual proposal', 'Draft: keep original language metadata and evaluate a language-specific vocabulary before mixing scores.')], ['proposals/languages.json', json({ status: 'proposal', languages: ['en', 'es'], translatedCorpusAvailable: false })]] },
      { name: 'explore-term-frequency', title: 'Term-frequency vectors', files: [['proposals/term-frequency.md', markdown('Term frequency proposal', 'Draft: compare binary keyword presence with normalized term frequency on the same corpus and relevance labels.')], ['proposals/comparison.json', json({ status: 'proposal', baseline: 'binary-keyword-presence', candidate: 'normalized-term-frequency', measured: false })]] },
    ],
  },
  evaluation: {
    title: 'Search quality review book', description: 'Human-readable retrieval cases, relevance judgments, rubrics and metric definitions, without invented run results.', purpose: 'Separate expected behavior and reviewer judgments from measured execution results.',
    files: {
      'data/queries.jsonl': '{"id":"q-water","query":"water refill","relevant":["water"]}\n{"id":"q-map","query":"paper map","relevant":["navigation"]}\n{"id":"q-pack","query":"repair pack buckle","relevant":["repair"]}\n',
      'data/documents.json': json([{ id: 'water', title: 'Carry and refill water' }, { id: 'navigation', title: 'Find the route' }, { id: 'repair', title: 'Repair a loose buckle' }, { id: 'layers', title: 'Pack a warm layer' }]),
      'data/judgments.csv': 'query,document,relevance,reason\nq-water,water,2,Directly explains refills\nq-map,navigation,2,Directly discusses paper maps\nq-pack,repair,2,Directly discusses buckle repairs\nq-pack,layers,0,Pack is mentioned but repair is not\n',
      'rubrics/relevance.md': markdown('Relevance rubric', '2: directly answers the query.\n1: provides useful supporting context.\n0: unrelated or only shares a word.\n\nThese are fixture judgments, not a model assessment.'),
      'rubrics/review.md': markdown('Review process', 'Read query and source document before assigning relevance. Record a short reason. Resolve disagreement without looking at a system’s rank.'),
      'src/metrics.js': 'export function precisionAtK(ranked, relevant, k) { if (!Number.isInteger(k) || k < 1) throw new RangeError("k must be positive"); const truth = new Set(relevant); return ranked.slice(0, k).filter(id => truth.has(id)).length / k }\n',
      'examples/worked-precision.json': json({ illustrative: true, ranked: ['water', 'layers', 'navigation'], relevant: ['water'], k: 3, expectedPrecision: 1 / 3, note: 'Hand-worked arithmetic, not a recorded system run.' }),
      'docs/metrics.md': markdown('Metric definitions', 'Precision@k is relevant retrieved items divided by k. Keep the denominator policy fixed when comparing systems.'),
      'docs/dataset-card.md': markdown('Dataset card', 'Fictional field-guide search queries and authored relevance judgments. Tiny illustrative coverage; unsuitable for claims about general search quality.'),
      'docs/report-template.md': markdown('Future run report template', 'Run ID: pending\nCorpus revision: pending\nQuery revision: pending\nRanking configuration: pending\nMeasured metrics: pending\n\nNo evaluation run has been executed by importing this fixture.'),
      'data/splits.json': json({ development: ['q-water', 'q-map'], review: ['q-pack'], note: 'Illustrative split; no training process is included.' }),
      'package.json': packageFile('evaluation'),
    },
    features: [
      { name: 'feature-query-coverage', title: 'Query coverage', commits: [
        ['data/coverage.json', json({ intents: ['hydration', 'navigation', 'repair'], missing: ['weather', 'empty-query'] }), 'Make gaps in query coverage explicit'],
        ['data/queries.jsonl', '{"id":"q-water","query":"water refill","relevant":["water"]}\n{"id":"q-map","query":"paper map","relevant":["navigation"]}\n{"id":"q-pack","query":"repair pack buckle","relevant":["repair"]}\n{"id":"q-weather","query":"warm layer rain","relevant":["layers"]}\n', 'Add a weather-preparation relevance case'],
        ['data/coverage.json', json({ intents: ['hydration', 'navigation', 'repair', 'weather'], missing: ['empty-query', 'unknown-terms'] }), 'Update the coverage inventory after adding weather'],
        ['docs/coverage.md', markdown('Coverage boundaries', 'Include direct lookup, ambiguous terms and no-signal queries. Adding examples improves inspectability but does not establish statistical representativeness.'), 'Explain the limits of a tiny review collection'],
      ] },
      { name: 'feature-recall-definition', title: 'Recall metric', commits: [
        ['src/recall.js', 'export function recallAtK(ranked, relevant, k) { if (!Number.isInteger(k) || k < 1) throw new RangeError("k must be positive"); const truth = new Set(relevant); if (!truth.size) return null; return new Set(ranked.slice(0, k).filter(id => truth.has(id))).size / truth.size }\n', 'Define recall with an explicit no-judgments result'],
        ['examples/worked-recall.json', json({ illustrative: true, ranked: ['water', 'layers'], relevant: ['water', 'navigation'], k: 2, expectedRecall: 0.5, note: 'Hand-worked metric example; not an executed search result.' }), 'Add a transparent recall calculation'],
        ['docs/metrics.md', markdown('Metric definitions', 'Precision@k divides relevant retrieved items by k. Recall@k divides distinct relevant retrieved items by the number of known relevant items. A query with no relevance labels has undefined recall (null), not zero.'), 'Distinguish recall from precision and missing labels'],
      ] },
      { name: 'feature-review-provenance', title: 'Judgment provenance', commits: [
        ['data/review-policy.json', json({ version: '1', blindToRanking: true, relevanceScale: [0, 1, 2], disputeResolution: 'Discuss source evidence and record rationale' }), 'Record a ranking-blind review policy'],
        ['docs/disagreements.md', markdown('Reviewer disagreement', 'Keep both initial judgments and a final rationale. A disagreement is useful information about an ambiguous query.'), 'Document how reviewers preserve disagreement'],
        ['docs/disagreements.md', markdown('Reviewer disagreement', 'Keep initial judgments, evidence excerpts and a final rationale. Do not overwrite the original annotation silently. Flag ambiguous queries for a revised wording rather than forcing agreement. No inter-reviewer agreement statistic is claimed here.'), 'Separate a review procedure from measured agreement'],
      ] },
    ],
    maintenance: { name: 'fix-duplicate-results', title: 'Duplicate-result scoring', commits: [
      ['src/metrics.js', 'export function precisionAtK(ranked, relevant, k) { if (!Number.isInteger(k) || k < 1) throw new RangeError("k must be positive"); const truth = new Set(relevant); return new Set(ranked.slice(0, k).filter(id => truth.has(id))).size / k }\n', 'Count each relevant document once in precision'],
      ['examples/duplicate-results.json', json({ illustrative: true, ranked: ['water', 'water', 'layers'], relevant: ['water'], k: 3, expectedPrecision: 1 / 3, reason: 'Repeated retrieval does not earn relevance credit twice.' }), 'Capture the duplicate-document scoring boundary'],
      ['rubrics/relevance.md', markdown('Relevance rubric', '2: directly answers the query.\n1: useful context.\n0: unrelated or keyword-only overlap.\n\nJudge document relevance once per query. Duplicate results do not create additional relevant documents. These are authored fixture judgments, not a model assessment.'), 'Align reviewer guidance with distinct-document scoring'],
    ] },
    explorations: [
      { name: 'explore-adversarial-queries', title: 'Hard negatives', files: [['proposals/adversarial.md', markdown('Hard-negative proposal', 'Draft queries that share words with irrelevant documents to reveal keyword shortcuts.')], ['proposals/hard-negatives.jsonl', '{"status":"proposal","query":"pack a repair kit","candidate":"layers","concern":"Word overlap without repair guidance"}\n']] },
      { name: 'explore-graded-ranking', title: 'Graded ranking metrics', files: [['proposals/graded-metrics.md', markdown('Graded metrics proposal', 'Draft an NDCG metric only after deciding gains, discounting and unjudged-document policy.')], ['proposals/gains.json', json({ status: 'proposal', relevanceToGain: { 0: 0, 1: 1, 2: 3 }, discount: 'log2(rank+1)', measured: false })]] },
    ],
  },
  website: {
    title: 'Trail Supply storefront',
    description: 'A small outdoor shop with a static storefront, product data and clear shopping policies.',
    purpose: 'Browse lightweight outdoor equipment and understand delivery before ordering.',
    files: {
      'index.html': '<!doctype html>\n<html lang="en"><meta charset="utf-8"><title>Trail Supply</title><link rel="stylesheet" href="styles.css"><main><h1>Less weight. More trail.</h1><p>Thoughtful equipment for a day outdoors.</p><nav><a href="products.html">Browse equipment</a> · <a href="shipping.html">Delivery</a></nav><section><h2>Start with the essentials</h2><p>A day pack, a bottle and a reliable trail map.</p></section></main></html>\n',
      'products.html': '<!doctype html>\n<html lang="en"><meta charset="utf-8"><title>Equipment · Trail Supply</title><link rel="stylesheet" href="styles.css"><main><a href="index.html">Trail Supply</a><h1>Equipment</h1><article><h2>Ridge day pack</h2><p>18 L · recycled fabric · $48.00</p></article><article><h2>Steel bottle</h2><p>750 ml · replaceable cap · $24.00</p></article></main></html>\n',
      'styles.css': ':root { font-family: system-ui, sans-serif; line-height: 1.6; color-scheme: light dark; } body { margin: 0; } main { max-width: 56rem; margin: auto; padding: 2rem 1.25rem; } article { border-block-end: 1px solid; padding-block: 1rem; } a { text-underline-offset: .2em; }\n',
      'data/products.json': json([{ id: 'pack-ridge', name: 'Ridge day pack', priceCents: 4800, stock: 12 }, { id: 'bottle-steel', name: 'Steel bottle', priceCents: 2400, stock: 30 }]),
      'data/categories.json': json([{ id: 'carry', label: 'Carry', products: ['pack-ridge'] }, { id: 'drink', label: 'Hydration', products: ['bottle-steel'] }]),
      'shipping.html': '<!doctype html>\n<html lang="en"><meta charset="utf-8"><title>Delivery · Trail Supply</title><main><h1>Delivery</h1><p>Dispatch within two business days. Standard delivery is $5.00; orders from $75.00 ship free.</p><p>These are sample shop policies, not an operating checkout.</p></main></html>\n',
      'returns.md': markdown('Returns', 'Unused equipment can be returned within 30 days. Keep the packaging and include the order reference. This fixture contains no real orders.'),
      'src/cart.js': 'export function subtotal(items) { return items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0) }\nexport function formatMoney(cents) { return `$${(cents / 100).toFixed(2)}` }\n',
      'examples/cart.json': json({ currency: 'USD', items: [{ product: 'pack-ridge', priceCents: 4800, quantity: 1 }, { product: 'bottle-steel', priceCents: 2400, quantity: 2 }] }),
      'docs/content-guide.md': markdown('Writing for Trail Supply', 'Lead with practical use. State capacity and material. Keep prices in integer cents in data; format them only for display.'),
      'docs/accessibility.md': markdown('Storefront accessibility checklist', '- Use one page heading.\n- Keep descriptive link labels.\n- Pair product images with useful text alternatives.\n- Check keyboard focus before publishing.\n\nThis is a review checklist, not a completed audit.'),
      'package.json': packageFile('website'),
    },
    features: [
      { name: 'feature-product-guide', title: 'Product guide', commits: [
        ['docs/product-guide.md', markdown('Choose a day pack', 'For a short walk, start with 12–18 L. Carry water, a warm layer and a map.'), 'Explain day-pack capacity'],
        ['data/products.json', json([{ id: 'pack-ridge', name: 'Ridge day pack', priceCents: 4800, stock: 12, capacityLitres: 18 }, { id: 'bottle-steel', name: 'Steel bottle', priceCents: 2400, stock: 30, capacityMl: 750 }]), 'Add useful product capacities'],
        ['docs/product-guide.md', markdown('Choose your essentials', '## Day pack\nFor a short walk, start with 12–18 L.\n\n## Water\nCarry at least 750 ml and plan a refill stop.\n\n## Fit\nKeep the heaviest items close to your back.'), 'Extend the guide with hydration and fit'],
        ['products.html', '<!doctype html>\n<html lang="en"><meta charset="utf-8"><title>Equipment · Trail Supply</title><link rel="stylesheet" href="styles.css"><main><a href="index.html">Trail Supply</a><h1>Equipment</h1><article><h2>Ridge day pack</h2><p>18 L · recycled fabric · $48.00</p></article><article><h2>Steel bottle</h2><p>750 ml · replaceable cap · $24.00</p></article><p>Choose capacity for your route, not for the longest trip you can imagine.</p></main></html>\n', 'Connect the catalog to practical buying advice'],
      ] },
      { name: 'feature-delivery-guide', title: 'Delivery guide', commits: [
        ['data/delivery.json', json({ currency: 'USD', standardCents: 500, freeFromCents: 7500, dispatchBusinessDays: 2 }), 'Describe delivery thresholds as data'],
        ['docs/checkout.md', markdown('Checkout handoff', 'Collect item IDs and quantities. Reprice against catalog data. Show delivery before asking for payment. No payment credentials belong in this fixture.'), 'Document a transparent checkout handoff'],
        ['shipping.html', '<!doctype html>\n<html lang="en"><meta charset="utf-8"><title>Delivery · Trail Supply</title><main><h1>Delivery without surprises</h1><p>Dispatch within two business days. Standard delivery is $5.00. Orders with a merchandise subtotal of $75.00 or more ship free.</p><p>Delivery is shown before payment. This is a sample storefront.</p></main></html>\n', 'Clarify the free-delivery boundary'],
      ] },
      { name: 'feature-care-notes', title: 'Equipment care', commits: [
        ['docs/care.md', markdown('Keep equipment in use', 'Brush dirt from a dry pack. Wash bottles with warm soapy water and leave the cap off to dry.'), 'Add practical care instructions'],
        ['data/care.json', json({ 'pack-ridge': ['Brush when dry', 'Air dry away from direct heat'], 'bottle-steel': ['Hand wash', 'Dry with cap removed'] }), 'Link care guidance to catalog IDs'],
        ['docs/care.md', markdown('Keep equipment in use', '## Pack\nBrush dirt when dry; air dry away from direct heat.\n\n## Bottle\nHand wash; dry with cap removed.\n\n## Repair first\nA worn cap or buckle is a replacement part, not a reason to replace the product.'), 'Add a repair-first recommendation'],
      ] },
    ],
    maintenance: { name: 'fix-money-display', title: 'Consistent price display', commits: [
      ['src/cart.js', 'export function subtotal(items) { return items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0) }\nexport function formatMoney(cents) { if (!Number.isSafeInteger(cents)) throw new TypeError("Expected integer cents"); return `$${(cents / 100).toFixed(2)}` }\n', 'Reject fractional cents at the display boundary'],
      ['examples/cart.json', json({ currency: 'USD', items: [{ product: 'pack-ridge', priceCents: 4800, quantity: 1 }, { product: 'bottle-steel', priceCents: 2400, quantity: 2 }], expectedSubtotalCents: 9600, expectedDisplay: '$96.00' }), 'Document a hand-worked cart example'],
      ['docs/content-guide.md', markdown('Writing for Trail Supply', 'Lead with practical use. State capacity and material. Keep prices in integer cents; reject fractional cents at formatting boundaries. Display two decimal places consistently: $24.00, not $24.'), 'Record the price-formatting rule'],
    ] },
    explorations: [
      { name: 'explore-loyalty', title: 'Loyalty concept', files: [['proposals/loyalty.md', markdown('Loyalty proposal', 'Draft: reward repairs and repeat use before purchase frequency. No points are issued.')], ['proposals/loyalty-rules.json', json({ status: 'proposal', actions: ['repair', 'return-packaging'], openQuestion: 'Can rewards avoid encouraging unnecessary purchases?' })]] },
      { name: 'explore-rental', title: 'Rental concept', files: [['proposals/rental.md', markdown('Rental proposal', 'Draft weekend day-pack rental with a return inspection and transparent damage policy.')], ['proposals/rental-inventory.json', json({ status: 'proposal', products: ['pack-ridge'], minimumDays: 2 })]] },
    ],
  },
  compiler: {
    title: 'Pocket expression language', description: 'A small arithmetic language with a readable grammar, tokenizer, parser, examples and design notes.', purpose: 'Explain a language front end through tiny source files and hand-worked examples.',
    files: {
      'grammar.ebnf': 'expression = term, { ("+" | "-"), term };\nterm = factor, { ("*" | "/"), factor };\nfactor = number | "(", expression, ")";\nnumber = digit, { digit };\n',
      'src/tokenize.js': 'export function tokenize(source) { const tokens = []; let offset = 0; while (offset < source.length) { if (/\\s/.test(source[offset])) { offset++; continue } const number = source.slice(offset).match(/^\\d+/); if (number) { tokens.push({ kind: "number", value: Number(number[0]), offset }); offset += number[0].length; continue } const value = source[offset]; if (!"+-*/()".includes(value)) throw new SyntaxError(`Unexpected character at ${offset}`); tokens.push({ kind: value, value, offset }); offset++ } return tokens }\n',
      'src/parse.js': 'export function parse(tokens) { let i = 0; function factor() { const token = tokens[i++]; if (token?.kind === "number") return { kind: "number", value: token.value }; if (token?.kind === "(") { const node = expression(); if (tokens[i++]?.kind !== ")") throw new SyntaxError("Expected closing parenthesis"); return node } throw new SyntaxError("Expected number or parenthesis") } function term() { let node = factor(); while (["*", "/"].includes(tokens[i]?.kind)) { const op = tokens[i++].kind; node = { kind: "binary", op, left: node, right: factor() } } return node } function expression() { let node = term(); while (["+", "-"].includes(tokens[i]?.kind)) { const op = tokens[i++].kind; node = { kind: "binary", op, left: node, right: term() } } return node } const result = expression(); if (i !== tokens.length) throw new SyntaxError("Unexpected trailing token"); return result }\n',
      'src/evaluate.js': 'export function evaluate(node) { if (node.kind === "number") return node.value; const a = evaluate(node.left), b = evaluate(node.right); if (node.op === "+") return a + b; if (node.op === "-") return a - b; if (node.op === "*") return a * b; if (node.op === "/") return a / b; throw new Error("Unknown operator") }\n',
      'examples/arithmetic.expr': '2 + 3 * 4\n',
      'examples/grouping.expr': '(2 + 3) * 4\n',
      'fixtures/expressions.json': json([{ source: '2 + 3 * 4', expected: 14 }, { source: '(2 + 3) * 4', expected: 20 }, { source: '9 - 3 - 1', expected: 5 }]),
      'docs/ast.md': markdown('Abstract syntax tree', 'Numbers have kind=number and a value. Binary nodes have an operator, left child and right child. Grouping controls tree shape; parentheses are not retained.'),
      'docs/pipeline.md': markdown('Pipeline', 'Source text → tokens with offsets → syntax tree → recursive evaluation. Keep lexical errors separate from syntax errors.'),
      'docs/limits.md': markdown('Deliberate limits', 'Only integer literals and arithmetic are accepted. Results use JavaScript numbers. There are no variables, loops, imports or filesystem access.'),
      'decisions/001-precedence.md': markdown('Decision 001: arithmetic precedence', 'Multiplication and division bind more tightly than addition and subtraction. Operators at the same level associate left.'),
      'package.json': packageFile('compiler'),
    },
    features: [
      { name: 'feature-tree-printer', title: 'Tree inspection', commits: [
        ['src/print.js', 'export function print(node) { return node.kind === "number" ? String(node.value) : `(${print(node.left)} ${node.op} ${print(node.right)})` }\n', 'Add an explicitly parenthesized tree printer'],
        ['fixtures/printed.json', json([{ source: '2 + 3 * 4', expected: '(2 + (3 * 4))' }]), 'Show the printed precedence structure'],
        ['docs/printing.md', markdown('Tree printing', 'The printer emits every binary operation in parentheses. It is an inspection tool, not a source formatter.'), 'Explain why inspection output keeps parentheses'],
        ['fixtures/printed.json', json([{ source: '2 + 3 * 4', expected: '(2 + (3 * 4))' }, { source: '9 - 3 - 1', expected: '((9 - 3) - 1)' }]), 'Document left-associative tree output'],
      ] },
      { name: 'feature-diagnostics-guide', title: 'Diagnostic examples', commits: [
        ['fixtures/errors.json', json([{ source: '2 @ 3', stage: 'tokenize', expectedMessage: 'Unexpected character at 2' }]), 'Capture an invalid-character example'],
        ['docs/diagnostics.md', markdown('Diagnostics', 'Report the stage, a stable summary and an offset where one is known. Offsets refer to JavaScript string indices in this small example.'), 'Define the diagnostic vocabulary'],
        ['fixtures/errors.json', json([{ source: '2 @ 3', stage: 'tokenize', expectedMessage: 'Unexpected character at 2' }, { source: '(2 + 3', stage: 'parse', expectedMessage: 'Expected closing parenthesis' }, { source: '2 3', stage: 'parse', expectedMessage: 'Unexpected trailing token' }]), 'Add missing-delimiter and trailing-token cases'],
      ] },
      { name: 'feature-postfix-format', title: 'Postfix output', commits: [
        ['src/postfix.js', 'export function postfix(node) { return node.kind === "number" ? [String(node.value)] : [...postfix(node.left), ...postfix(node.right), node.op] }\n', 'Emit postfix instructions from the tree'],
        ['fixtures/postfix.json', json([{ source: '2 + 3 * 4', expected: ['2', '3', '4', '*', '+'] }]), 'Add a worked stack-order example'],
        ['docs/postfix.md', markdown('Postfix output', 'Visit left, visit right, emit the operator. For 2 + 3 * 4 the output is 2 3 4 * +. This representation needs no parentheses.'), 'Explain the relation between trees and stack order'],
      ] },
    ],
    maintenance: { name: 'fix-nonfinite-evaluation', title: 'Finite arithmetic', commits: [
      ['src/evaluate.js', 'export function evaluate(node) { if (node.kind === "number") return node.value; const a = evaluate(node.left), b = evaluate(node.right); if (node.op === "/" && b === 0) throw new RangeError("Division by zero"); const result = node.op === "+" ? a + b : node.op === "-" ? a - b : node.op === "*" ? a * b : node.op === "/" ? a / b : NaN; if (!Number.isFinite(result)) throw new RangeError("Non-finite arithmetic result"); return result }\n', 'Refuse division by zero and non-finite results'],
      ['fixtures/arithmetic-errors.json', json([{ source: '4 / 0', expectedMessage: 'Division by zero' }, { source: '0 / 0', expectedMessage: 'Division by zero' }]), 'Document the division boundary examples'],
      ['docs/limits.md', markdown('Deliberate limits', 'Only integer literals and arithmetic are accepted. Results use finite JavaScript numbers; division by zero is refused. Precision is not arbitrary. There are no variables, loops, imports or filesystem access.'), 'State finite-result and precision limitations'],
    ] },
    explorations: [
      { name: 'explore-variables', title: 'Named values', files: [['proposals/variables.md', markdown('Variables proposal', 'Draft: resolve names against an explicitly provided environment; never read process globals.')], ['proposals/environment.json', json({ status: 'proposal', bindings: { width: 12, height: 8 }, example: 'width * height' })]] },
      { name: 'explore-constant-folding', title: 'Constant folding', files: [['proposals/folding.md', markdown('Constant folding proposal', 'Draft: replace a binary subtree with a number only when both children are constants and evaluation succeeds.')], ['proposals/folding-cases.json', json([{ before: '(2 + (3 * 4))', proposedAfter: '14', status: 'proposal' }])]] },
    ],
  },
  sdk: {
    title: 'Collection client cookbook', description: 'A dependency-free JavaScript client and integration recipes for the museum collection contract.', purpose: 'Make HTTP client behavior explicit without requiring an online service.',
    files: {
      'src/client.js': 'export function createClient({ baseUrl, fetch: request = globalThis.fetch }) { const base = new URL(baseUrl); return { async getObject(id) { const response = await request(new URL(`objects/${encodeURIComponent(id)}`, base)); if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json() } } }\n',
      'src/query.js': 'export function queryString(values) { const params = new URLSearchParams(); for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== null) params.set(key, String(value)); return params.toString() }\n',
      'examples/get-object.mjs': 'import { createClient } from "../src/client.js"\nconst fetch = async () => ({ ok: true, json: async () => ({ id: "obj-101", title: "Coastal sketch" }) })\nconst client = createClient({ baseUrl: "https://museum.example.invalid/", fetch })\nconsole.log(await client.getObject("obj-101"))\n',
      'examples/object.json': json({ id: 'obj-101', title: 'Coastal sketch', year: 1912 }),
      'types/index.d.ts': 'export interface CollectionObject { id: string; title: string; year?: number }\nexport interface CollectionClient { getObject(id: string): Promise<CollectionObject> }\n',
      'docs/quickstart.md': markdown('Quick start', 'Import createClient, supply a base URL ending with /, then request an object by stable ID. The included example injects a local fake response; it sends no network request.'),
      'docs/transport.md': markdown('Transport injection', 'Pass a fetch-compatible function to control transport. Keep test doubles local; production callers can use the platform fetch implementation.'),
      'docs/security.md': markdown('Client security', 'Use HTTPS for remote services. Do not put credentials in query parameters. Treat server error messages as data, not executable markup.'),
      'docs/compatibility.md': markdown('Compatibility', 'Source uses JavaScript modules, URL and URLSearchParams. A caller provides a fetch implementation if the runtime lacks one.'),
      'fixtures/responses.json': json({ object: { status: 200, body: { id: 'obj-101', title: 'Coastal sketch' } }, missing: { status: 404, body: { error: { code: 'OBJECT_NOT_FOUND', message: 'Not found', requestId: 'example-001' } } } }),
      'decisions/001-injection.md': markdown('Decision 001: inject transport', 'Keep client logic independent of network availability so examples can remain deterministic and inspectable.'),
      'package.json': packageFile('sdk'),
    },
    features: [
      { name: 'feature-page-iterator', title: 'Pagination helper', commits: [
        ['src/pages.js', 'export async function* pages(load) { let cursor; do { const page = await load(cursor); yield page.items; cursor = page.nextCursor } while (cursor != null) }\n', 'Add an async iterator for collection pages'],
        ['examples/pages.mjs', 'import { pages } from "../src/pages.js"\nconst load = async cursor => cursor == null ? { items: ["obj-101"], nextCursor: "second" } : { items: ["obj-102"], nextCursor: null }\nfor await (const items of pages(load)) console.log(items)\n', 'Demonstrate pagination using local data'],
        ['docs/pagination.md', markdown('Pagination', 'The iterator yields one item array per page. It requests pages lazily and stops when nextCursor is null or absent.'), 'Document lazy page consumption'],
        ['types/pages.d.ts', 'export interface Page<T> { items: T[]; nextCursor: string | null }\nexport declare function pages<T>(load: (cursor?: string) => Promise<Page<T>>): AsyncGenerator<T[]>;\n', 'Describe the page helper contract in types'],
      ] },
      { name: 'feature-error-type', title: 'Structured errors', commits: [
        ['src/errors.js', 'export class ApiError extends Error { constructor(status, { code, message, requestId }) { super(message); this.name = "ApiError"; this.status = status; this.code = code; this.requestId = requestId } }\n', 'Represent API errors without parsing message text'],
        ['docs/errors.md', markdown('Error handling', 'Use status for HTTP behavior, code for application handling and requestId for support. Avoid retrying every error automatically.'), 'Explain the three error identifiers'],
        ['examples/error.mjs', 'import { ApiError } from "../src/errors.js"\nconst error = new ApiError(404, { code: "OBJECT_NOT_FOUND", message: "Not found", requestId: "example-001" })\nconsole.log({ status: error.status, code: error.code, requestId: error.requestId })\n', 'Add an offline structured-error example'],
      ] },
      { name: 'feature-abort-guide', title: 'Cancellation recipe', commits: [
        ['src/signals.js', 'export function timeoutSignal(milliseconds) { if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) throw new RangeError("Expected nonnegative integer milliseconds"); return AbortSignal.timeout(milliseconds) }\n', 'Provide an explicit request deadline signal'],
        ['docs/cancellation.md', markdown('Cancellation', 'Pass a caller-owned AbortSignal to the transport. Cancellation belongs to the request; it should not destroy a shared client.'), 'Explain request-scoped cancellation'],
        ['docs/cancellation.md', markdown('Cancellation', 'Pass a caller-owned AbortSignal to transport. Cancellation belongs to one request. AbortSignal.timeout supplies a deadline on supported runtimes. An abort does not prove a remote mutation was rolled back; reconcile uncertain results before retrying.'), 'Document uncertain outcomes after cancellation'],
      ] },
    ],
    maintenance: { name: 'fix-base-url', title: 'Safe base URL joining', commits: [
      ['src/client.js', 'export function createClient({ baseUrl, fetch: request = globalThis.fetch }) { const base = new URL(baseUrl); if (!["http:", "https:"].includes(base.protocol)) throw new TypeError("Expected HTTP base URL"); if (!base.pathname.endsWith("/")) base.pathname += "/"; return { async getObject(id) { if (!id || id === "." || id === "..") throw new TypeError("Expected object ID"); const response = await request(new URL(`objects/${encodeURIComponent(id)}`, base)); if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json() } } }\n', 'Preserve a base path when the trailing slash is omitted'],
      ['fixtures/url-cases.json', json([{ base: 'https://museum.example.invalid/api', id: 'obj-101', expected: 'https://museum.example.invalid/api/objects/obj-101' }, { base: 'https://museum.example.invalid/api/', id: 'a/b', expected: 'https://museum.example.invalid/api/objects/a%2Fb' }]), 'Record path-preserving URL examples'],
      ['docs/quickstart.md', markdown('Quick start', 'Import createClient and supply an HTTP(S) base URL. The client preserves a base path with or without its final slash. Stable object IDs are encoded as one path segment. The bundled example injects a local response and sends no network request.'), 'Update quick start for normalized base paths'],
    ] },
    explorations: [
      { name: 'explore-python-client', title: 'Python API sketch', files: [['proposals/python.md', markdown('Python client proposal', 'Draft an equivalent synchronous API with injectable transport and matching error fields.')], ['proposals/python-example.py', '# API sketch only; no implementation is shipped.\n# client = CollectionClient(base_url="https://museum.example.invalid/")\n# object = client.get_object("obj-101")\n']] },
      { name: 'explore-retry-policy', title: 'Retry boundaries', files: [['proposals/retries.md', markdown('Retry proposal', 'Draft: retry bounded idempotent reads on transient errors. Never replay an uncertain write without an idempotency contract.')], ['proposals/retries.json', json({ status: 'proposal', maximumAttempts: 3, retryableStatuses: [429, 503], mutations: 'disabled' })]] },
    ],
  },
  design: {
    title: 'Field Notes design kit', description: 'A compact visual language with tokens, SVG assets and browsable component specimens.', purpose: 'Make a consistent, readable interface without a framework dependency.',
    files: {
      'tokens/base.json': json({ spacing: { small: 8, medium: 16, large: 24 }, radius: 6, type: { body: 16, heading: 28 }, colors: { ink: '#17212b', paper: '#ffffff', accent: '#145c38' } }),
      'styles/tokens.css': ':root { --space: 1rem; --radius: .375rem; --ink: #17212b; --paper: #fff; --accent: #145c38; font: 1rem/1.5 system-ui, sans-serif; color: var(--ink); background: var(--paper); }\n',
      'styles/components.css': 'button, input { font: inherit; padding: .5rem .75rem; border: 1px solid currentColor; border-radius: var(--radius); } button { background: var(--accent); color: white; } :focus-visible { outline: 3px solid currentColor; outline-offset: 3px; }\n',
      'gallery.html': '<!doctype html>\n<html lang="en"><meta charset="utf-8"><title>Field Notes components</title><link rel="stylesheet" href="styles/tokens.css"><link rel="stylesheet" href="styles/components.css"><main><h1>Field Notes</h1><p>A small component specimen.</p><button>Save note</button><p><label>Notebook <input placeholder="Trail observations"></label></p></main></html>\n',
      'icons/notebook.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="3" width="15" height="18" rx="2"/><path d="M9 3v18M3 7h4M3 12h4M3 17h4"/></svg>\n',
      'icons/check.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 12 4 4L19 6"/></svg>\n',
      'docs/typography.md': markdown('Typography', 'Use the system font. Body text starts at 16 px with 1.5 line height. Keep prose near 65 characters per line.'),
      'docs/interaction.md': markdown('Interaction states', 'Every control needs default, hover, focus and disabled states. Label the action with a verb and its object.'),
      'docs/accessibility.md': markdown('Accessibility review', 'Review keyboard navigation, visible focus, text contrast and labels. These are review criteria, not audit results.'),
      'docs/iconography.md': markdown('Iconography', 'Use a 24 × 24 viewBox and currentColor. Icons supplement text; label icon-only controls in their containing interface.'),
      'examples/spacing.json': json([{ name: 'control-gap', token: 'small', pixels: 8 }, { name: 'section-gap', token: 'large', pixels: 24 }]),
      'decisions/001-system-font.md': markdown('Decision 001: system font', 'Accepted for this example: use the platform font to avoid downloads and preserve legibility.'),
    },
    features: [
      { name: 'feature-type-scale', title: 'Type scale', commits: [
        ['tokens/type.json', json({ caption: 13, body: 16, subtitle: 20, title: 28 }), 'Define a four-level type scale'],
        ['docs/typography.md', markdown('Typography', 'Use the system font. Caption 13 px, body 16 px, subtitle 20 px, title 28 px. Use size and spacing before font weight to establish hierarchy.'), 'Explain the hierarchy behind the scale'],
        ['tokens/type.json', json({ caption: { size: 13, lineHeight: 1.4 }, body: { size: 16, lineHeight: 1.5 }, subtitle: { size: 20, lineHeight: 1.35 }, title: { size: 28, lineHeight: 1.2 } }), 'Pair type sizes with line heights'],
        ['examples/type.html', '<!doctype html>\n<html lang="en"><meta charset="utf-8"><title>Type specimen</title><h1>Notes from the field</h1><h2>A clear place to begin</h2><p>Record observations while the details are fresh.</p><small>Updated by the notebook owner.</small></html>\n', 'Add a readable type specimen'],
      ] },
      { name: 'feature-form-language', title: 'Form language', commits: [
        ['docs/forms.md', markdown('Forms', 'Place a persistent label above each field. Explain constraints before submission.'), 'Define persistent field labels'],
        ['examples/form.html', '<!doctype html>\n<html lang="en"><meta charset="utf-8"><title>Form specimen</title><form><label for="name">Notebook name</label><p id="hint">Choose a short, recognizable title.</p><input id="name" aria-describedby="hint" required><button>Save notebook</button></form></html>\n', 'Add an accessible notebook form specimen'],
        ['docs/forms.md', markdown('Forms', 'Place persistent labels above fields. Explain constraints before submission. Place errors next to the field and preserve entered values. Disable submission only while work is in progress.'), 'Specify error recovery and pending states'],
      ] },
      { name: 'feature-empty-states', title: 'Empty states', commits: [
        ['docs/empty-states.md', markdown('Empty states', 'Say what belongs here and provide one next action. A new notebook is empty, not broken.'), 'Describe useful empty-state language'],
        ['examples/empty-state.html', '<!doctype html>\n<html lang="en"><meta charset="utf-8"><title>Empty notebook</title><main><h1>No notes yet</h1><p>Keep observations, sketches and small discoveries together.</p><button>Add your first note</button></main></html>\n', 'Add a first-use empty notebook specimen'],
        ['docs/empty-states.md', markdown('Empty states', '## First use\nExplain what belongs here and offer one next action.\n\n## No matches\nShow the current filter and a clear-filters action.\n\n## Failure\nExplain what failed and how to retry; keep saved content visible.'), 'Distinguish empty, filtered and failed views'],
      ] },
    ],
    maintenance: { name: 'fix-focus-guidance', title: 'Focus visibility', commits: [
      ['styles/components.css', 'button, input { font: inherit; padding: .5rem .75rem; border: 1px solid currentColor; border-radius: var(--radius); } button { background: var(--accent); color: white; } :focus-visible { outline: 3px solid #145c38; outline-offset: 3px; } button:focus-visible { outline-color: var(--ink); }\n', 'Keep button focus rings visible on paper'],
      ['docs/accessibility.md', markdown('Accessibility review', 'Review keyboard navigation, labels and contrast. Focus must remain visible outside filled controls. Check the 3 px outline on paper and alternate surfaces. No audit has been executed by this fixture.'), 'Make the focus review criteria concrete'],
      ['decisions/002-focus-ring.md', markdown('Decision 002: external focus ring', 'Use a 3 px outline with 3 px offset so focus does not depend on a filled button’s text color. Validate against each surface during actual review.'), 'Record why focus rings sit outside controls'],
    ] },
    explorations: [
      { name: 'explore-night-mode', title: 'Night palette', files: [['proposals/night-mode.md', markdown('Night mode proposal', 'Draft: use a warm near-black surface, preserve semantic contrast and respect the system preference.')], ['proposals/night-tokens.json', json({ status: 'proposal', paper: '#171b19', ink: '#f4f5f2', accent: '#9bd7b0' })]] },
      { name: 'explore-density', title: 'Compact density', files: [['proposals/density.md', markdown('Compact density proposal', 'Draft: reduce list spacing while preserving control hit areas and readable text.')], ['proposals/density-tokens.json', json({ status: 'proposal', listGap: 4, controlMinHeight: 40 })]] },
    ],
  },
  gateway: {
    title: 'Museum collection API handbook', description: 'An API contract and request cookbook for a small museum collection; no server is required.', purpose: 'Help an integrator browse exhibits, plan visits and understand errors.',
    files: {
      'openapi.yaml': 'openapi: 3.1.0\ninfo:\n  title: Collection API\n  version: 0.1.0\npaths:\n  /objects:\n    get:\n      summary: List collection objects\n      responses:\n        "200":\n          description: A page of collection objects\n',
      'requests/list.http': 'GET https://museum.example.invalid/objects?limit=2\nAccept: application/json\n',
      'examples/objects.json': json({ items: [{ id: 'obj-101', title: 'Coastal sketch', year: 1912 }, { id: 'obj-102', title: 'Clay vessel', year: 1880 }], nextCursor: null }),
      'examples/object.json': json({ id: 'obj-101', title: 'Coastal sketch', artist: 'M. Chen', year: 1912, medium: 'Graphite on paper', gallery: 'East room' }),
      'examples/error.json': json({ error: { code: 'OBJECT_NOT_FOUND', message: 'The requested object does not exist.' } }),
      'routes.json': json([{ method: 'GET', path: '/objects', operation: 'listObjects' }, { method: 'GET', path: '/objects/{id}', operation: 'getObject' }]),
      'docs/authentication.md': markdown('Authentication', 'Collection reads are public in this example. Private annotations would require a scoped token. Never include tokens in a URL.'),
      'docs/errors.md': markdown('Error contract', 'Errors use an error object with code and message. Clients should switch on code, not parse prose.'),
      'docs/versioning.md': markdown('Versioning', 'Add optional fields compatibly. Rename or remove fields only in a documented major version.'),
      'docs/privacy.md': markdown('Privacy', 'Object examples are fictional. Requests use example.invalid and do not point at a live collection.'),
      'schemas/object.json': json({ type: 'object', required: ['id', 'title'], properties: { id: { type: 'string' }, title: { type: 'string' }, year: { type: 'integer' } } }),
      'decisions/001-identifiers.md': markdown('Decision 001: stable object IDs', 'Use opaque stable identifiers. Titles and room assignments can change without breaking links.'),
    },
    features: [
      { name: 'feature-pagination-contract', title: 'Cursor pagination', commits: [
        ['docs/pagination.md', markdown('Cursor pagination', 'Use limit from 1 to 100. Supply nextCursor unchanged to request the next page.'), 'Introduce opaque cursor pagination'],
        ['examples/page.json', json({ items: [{ id: 'obj-101', title: 'Coastal sketch' }], nextCursor: 'page-2-example' }), 'Provide a page with a continuation cursor'],
        ['requests/list.http', 'GET https://museum.example.invalid/objects?limit=1&cursor=page-2-example\nAccept: application/json\n', 'Demonstrate a follow-up collection request'],
        ['docs/pagination.md', markdown('Cursor pagination', 'Use limit from 1 to 100. Pass nextCursor unchanged. Stop when it is null. Cursors are opaque and may expire; restart listing rather than decoding one.'), 'Specify completion and expired-cursor behavior'],
      ] },
      { name: 'feature-visit-contract', title: 'Visit planning', commits: [
        ['examples/visit.json', json({ date: '2026-06-15', open: true, hours: { from: '10:00', to: '17:00', zone: 'Asia/Singapore' } }), 'Model opening hours with an explicit time zone'],
        ['requests/visit.http', 'GET https://museum.example.invalid/visits/2026-06-15\nAccept: application/json\n', 'Add a visit-planning request example'],
        ['docs/visits.md', markdown('Visit planning', 'Treat dates as local museum dates. Hours include an IANA time zone. A closed date has open=false and hours=null. This is a contract example, not a current opening-hours announcement.'), 'Explain closed days and local date boundaries'],
      ] },
      { name: 'feature-conditional-reads', title: 'Conditional reads', commits: [
        ['docs/caching.md', markdown('Conditional reads', 'Collection responses may provide an ETag. Send If-None-Match to avoid downloading unchanged data.'), 'Describe conditional collection requests'],
        ['requests/conditional.http', 'GET https://museum.example.invalid/objects/obj-101\nIf-None-Match: "object-101-rev-2"\n', 'Show an opaque entity-tag request'],
        ['docs/caching.md', markdown('Conditional reads', 'Keep ETags opaque and send them in If-None-Match. A 304 response has no JSON body. Cache public collection data; never share-cache private annotations.'), 'Define the no-body and privacy boundaries'],
      ] },
    ],
    maintenance: { name: 'fix-error-shape', title: 'Consistent errors', commits: [
      ['examples/error.json', json({ error: { code: 'OBJECT_NOT_FOUND', message: 'The requested object does not exist.', requestId: 'example-request-001' } }), 'Include a support-safe request identifier'],
      ['docs/errors.md', markdown('Error contract', 'Every error uses {error:{code,message,requestId}}. Clients switch on code. requestId is safe to share for support; response messages must not echo tokens or database internals.'), 'Specify one error envelope for every endpoint'],
      ['schemas/error.json', json({ type: 'object', required: ['error'], properties: { error: { type: 'object', required: ['code', 'message', 'requestId'], properties: { code: { type: 'string' }, message: { type: 'string' }, requestId: { type: 'string' } } } } }), 'Add a machine-readable error envelope schema'],
    ] },
    explorations: [
      { name: 'explore-bulk-export', title: 'Bulk export', files: [['proposals/export.md', markdown('Bulk export proposal', 'Draft: asynchronous exports with an expiring download link and stable schema version.')], ['proposals/export.json', json({ status: 'proposal', formats: ['jsonl', 'csv'], expiryHours: 24 })]] },
      { name: 'explore-private-notes', title: 'Private annotations', files: [['proposals/annotations.md', markdown('Annotations proposal', 'Draft: collection-owner notes require authentication and are excluded from public caches.')], ['proposals/scopes.json', json({ status: 'proposal', scopes: ['annotations:read', 'annotations:write'] })]] },
    ],
  },
  billing: {
    title: 'Workshop invoice notebook', description: 'A small invoice ledger with explicit integer-cent calculations, sample payments and reconciliation notes.', purpose: 'Explain a maker workshop’s invoices and payment boundaries with inspectable examples.',
    files: {
      'data/invoices.csv': 'invoice,customer,currency,subtotal_cents,tax_cents,total_cents\nINV-101,Sample Studio,USD,12500,1000,13500\nINV-102,Example Workshop,USD,8000,640,8640\n',
      'data/payments.csv': 'payment,invoice,amount_cents,method\nPAY-101,INV-101,13500,bank\nPAY-102,INV-102,4000,bank\n',
      'data/items.json': json([{ sku: 'class-pottery', description: 'Introductory pottery class', unitCents: 12500 }, { sku: 'repair-session', description: 'Guided repair session', unitCents: 8000 }]),
      'src/money.js': 'export function lineTotal(unitCents, quantity) { if (!Number.isSafeInteger(unitCents) || !Number.isSafeInteger(quantity) || unitCents < 0 || quantity < 0) throw new RangeError("Nonnegative integer amounts required"); return unitCents * quantity }\nexport function balance(totalCents, payments) { return totalCents - payments.reduce((sum, cents) => sum + cents, 0) }\n',
      'examples/invoice.json': json({ id: 'INV-101', currency: 'USD', lines: [{ sku: 'class-pottery', unitCents: 12500, quantity: 1 }], subtotalCents: 12500, taxCents: 1000, totalCents: 13500 }),
      'docs/currency.md': markdown('Currency rules', 'This example handles USD with two decimal places. Store amounts in integer cents and do not add amounts from different currencies.'),
      'docs/reconciliation.md': markdown('Reconciliation', 'Match payments by invoice ID. INV-101 is fully matched; INV-102 has 4640 cents outstanding. These are fictional worked examples.'),
      'docs/invoice-lifecycle.md': markdown('Invoice lifecycle', 'Draft → issued → partially paid → paid. A correction references the original invoice; issued records are not silently rewritten.'),
      'policies/refunds.md': markdown('Refund policy example', 'Record refunds as separate negative adjustments linked to a payment. This is a demonstration policy, not legal or tax guidance.'),
      'templates/invoice.md': markdown('Invoice template', 'Invoice: {{id}}\nCustomer: {{customer}}\nCurrency: {{currency}}\nSubtotal: {{subtotal}}\nTax: {{tax}}\nTotal due: {{total}}'),
      'data/customers.json': json([{ id: 'sample-studio', displayName: 'Sample Studio' }, { id: 'example-workshop', displayName: 'Example Workshop' }]),
      'package.json': packageFile('billing'),
    },
    features: [
      { name: 'feature-tax-policy', title: 'Worked tax policy', commits: [
        ['policies/tax.md', markdown('Example tax calculation', 'Use an illustrative 8% rate. This is invented sample data, not a jurisdiction’s tax rule.'), 'Label the illustrative tax rate'],
        ['data/tax.json', json({ illustrative: true, rateBasisPoints: 800, currency: 'USD', rounding: 'nearest-cent-half-up' }), 'Represent the sample rate in basis points'],
        ['src/tax.js', 'export function taxCents(subtotalCents, basisPoints = 800) { if (!Number.isSafeInteger(subtotalCents) || subtotalCents < 0 || !Number.isSafeInteger(basisPoints) || basisPoints < 0) throw new RangeError("Nonnegative integer inputs required"); return Math.floor((subtotalCents * basisPoints + 5000) / 10000) }\n', 'Implement the stated integer rounding example'],
        ['policies/tax.md', markdown('Example tax calculation', 'Illustrative rate: 800 basis points (8%). For a 12,500-cent subtotal, tax is 1,000 cents. Round half up once at invoice subtotal. No claim is made about a real tax jurisdiction.'), 'Document a complete hand-worked tax example'],
      ] },
      { name: 'feature-discounts', title: 'Discount rules', commits: [
        ['data/discounts.json', json([{ code: 'WELCOME10', basisPoints: 1000, maximumCents: 2000 }]), 'Add a capped welcome discount example'],
        ['src/discount.js', 'export function discountCents(subtotalCents, { basisPoints, maximumCents }) { if (![subtotalCents, basisPoints, maximumCents].every(n => Number.isSafeInteger(n) && n >= 0) || basisPoints > 10000) throw new RangeError("Invalid discount inputs"); return Math.min(subtotalCents, maximumCents, Math.floor(subtotalCents * basisPoints / 10000)) }\n', 'Calculate capped discounts without floating-point currency'],
        ['docs/discounts.md', markdown('Discount order', 'Apply at most one coupon to the merchandise subtotal, cap it, then compute sample tax on the discounted subtotal. 12,500 cents with WELCOME10 receives a 1,250-cent discount.'), 'Make discount and tax ordering explicit'],
      ] },
      { name: 'feature-adjustments', title: 'Adjustment ledger', commits: [
        ['data/adjustments.csv', 'adjustment,invoice,amount_cents,reason\nADJ-101,INV-101,-1000,Example goodwill credit\n', 'Add a separate credit adjustment example'],
        ['docs/adjustments.md', markdown('Adjustment records', 'An adjustment references an issued invoice and has a signed integer-cent amount. Preserve the original invoice.'), 'Explain immutable invoice corrections'],
        ['docs/adjustments.md', markdown('Adjustment records', 'An adjustment references an issued invoice, a signed integer-cent amount and a reason. Preserve the original invoice. A credit note changes receivables; a refund records actual returned money. They are different records.'), 'Separate credit notes from cash refunds'],
      ] },
    ],
    maintenance: { name: 'fix-payment-validation', title: 'Payment validation', commits: [
      ['src/money.js', 'const valid = n => Number.isSafeInteger(n) && n >= 0\nexport function lineTotal(unitCents, quantity) { if (!valid(unitCents) || !valid(quantity) || !Number.isSafeInteger(unitCents * quantity)) throw new RangeError("Safe nonnegative integer amounts required"); return unitCents * quantity }\nexport function balance(totalCents, payments) { if (!valid(totalCents) || !payments.every(valid)) throw new RangeError("Safe nonnegative payment amounts required"); return totalCents - payments.reduce((sum, cents) => sum + cents, 0) }\n', 'Validate payment amounts and line-total overflow'],
      ['examples/payment-boundaries.json', json({ illustrative: true, cases: [{ totalCents: 8640, payments: [4000], expectedBalanceCents: 4640 }, { totalCents: 8640, payments: [9000], expectedBalanceCents: -360 }], negativeBalanceMeaning: 'Customer credit; not automatically a refund.' }), 'Record partial payment and overpayment examples'],
      ['docs/reconciliation.md', markdown('Reconciliation', 'Match payments by invoice ID. INV-101 is paid; INV-102 has 4,640 cents outstanding. Reject fractional or negative payment inputs. A negative balance means customer credit and does not itself issue a refund. Figures are fictional worked examples.'), 'Clarify overpayment and invalid payment handling'],
    ] },
    explorations: [
      { name: 'explore-subscriptions', title: 'Recurring invoices', files: [['proposals/subscriptions.md', markdown('Recurring invoices proposal', 'Draft monthly class passes. Generate separate issued invoices; never edit a prior period’s ledger.')], ['proposals/subscription.json', json({ status: 'proposal', cadence: 'monthly', prorating: 'undecided' })]] },
      { name: 'explore-multi-currency', title: 'Currency boundaries', files: [['proposals/currencies.md', markdown('Multi-currency proposal', 'Draft: maintain independent currency ledgers and record explicit conversion transactions.')], ['proposals/currencies.json', json({ status: 'proposal', currencies: ['USD', 'EUR'], exchangeRateSource: null })]] },
    ],
  },
}

/** Each recipe write is one file mutation and therefore one meaningful CLI Commit. */
export function projectDefinition(name) {
  const profile = profiles[name]
  if (!profile) throw new Error(`Unknown preset project: ${name}`)
  const readme = markdown(profile.title, `${profile.description}\n\n## Purpose\n${profile.purpose}\n\n## Explore\nBrowse the source, examples and documentation. The branch history records small file changes, merges into new release branches and publications to main. Exploration branches remain proposals.\n\n## Execution\nThis preset imports files and creates history through LayerFS CLI calls. It does not run this project's code, install dependencies or produce benchmark results.`)
  const architecture = markdown('Project map', `${profile.purpose}\n\n- Source and structured data describe the example.\n- Documentation explains contracts and decisions.\n- Examples contain expected behavior or hand-worked values.\n- No file is evidence of an executed check unless a later real operation records it.\n\n## History\nA release publication makes the selected Branch head the next main Layer. Merge creates a separate Branch and keeps both input Branches.`)
  const features = profile.features.map(feature => ({ name: feature.name, title: feature.title, commits: feature.commits.map(([path, content, message]) => write(path, content, message)) }))
  return {
    name, title: profile.title, description: profile.description,
    files: {
      'README.md': readme,
      'docs/architecture.md': architecture,
      'examples/README.md': markdown('Reading examples', 'Examples are fictional inputs, expected behavior or hand-worked calculations. They are not evidence of executed checks. Compare their assumptions with the source and documentation.'),
      'proposals/README.md': markdown('Exploration branches', 'Unfinished ideas live on the project’s explore-* Branches. Browse those Branches to inspect proposal documents and data. A proposal is not part of a published release merely because its Branch exists.'),
      ...profile.files,
    },
    foundation: [
      write('docs/project-map.md', markdown('Where to begin', `${profile.purpose}\n\nStart with README.md, then inspect docs/architecture.md and the example data.`), 'Add an orientation map for the project'),
      write('docs/decisions.md', markdown('Working decisions', `Keep ${profile.title} self-contained and inspectable. Prefer explicit contracts, fictional data and small readable examples. State assumptions beside the relevant artifact.`), 'Record the scope and assumptions of the example'),
      write('CHANGELOG.md', markdown('Changes', `## 0.1\nInitial ${profile.title} content, source examples and project documentation. No execution results are claimed.`), 'Describe the first browsable release'),
    ],
    features,
    maintenance: { name: profile.maintenance.name, title: profile.maintenance.title, commits: profile.maintenance.commits.map(([path, content, message]) => write(path, content, message)) },
    releases: [
      write('CHANGELOG.md', markdown('Changes', `## 0.2\nCombine ${features[0].title.toLowerCase()} and ${features[1].title.toLowerCase()} in a new release Branch.\n\n## 0.1\nInitial browsable project content.`), `Document the ${features[0].title.toLowerCase()} and ${features[1].title.toLowerCase()} release`),
      write('CHANGELOG.md', markdown('Changes', `## 0.3\nAdd ${features[2].title.toLowerCase()} and incorporate ${profile.maintenance.title.toLowerCase()} from current main.\n\n## 0.2\nCombine ${features[0].title.toLowerCase()} and ${features[1].title.toLowerCase()}.\n\n## 0.1\nInitial browsable project content.\n\nThese entries describe committed file changes, not executed application checks.`), `Document the ${features[2].title.toLowerCase()} release and maintenance integration`),
    ],
    explorations: profile.explorations.map(exploration => ({ name: exploration.name, title: exploration.title, commits: exploration.files.map(([path, content], index) => write(path, content, `${index ? 'Sketch' : 'Propose'} ${exploration.title.toLowerCase()}${index ? ' data and examples' : ''}`)) })),
  }
}
