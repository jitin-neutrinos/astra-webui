/**
 * PORTED VERBATIM (JS→TS, logic untouched) from the comindash dashboard:
 *   .../src/components/graph/graphFilter.js
 *
 * The cross-filter engine behind the graph's kind chips: which values would still
 * leave the graph non-empty given the OTHER selections. Kept because the ported
 * renderer relies on exactly those semantics for its filter affordances.
 *
 * Original self-check: node src/components/graph/graphFilter.test.mjs
 */
/** Graph-level stats reused by filters + infographic sections. */
export function graphStats(graph: any): any {
  const nodes: any[] = graph?.nodes ?? []
  const edges: any[] = graph?.edges ?? []
  const people = nodes.filter((n: any) => n.kind === 'person')
  const products = nodes.filter((n: any) => n.kind === 'product')
  const concepts = nodes.filter((n: any) => n.kind === 'concept')
  const measured = edges.filter((e: any) => e.kind === 'co_mention')
  const asserted = edges.filter((e: any) => e.kind === 'asserted')
  const deg = new Map<any, number>()
  for (const e of edges as any[]) {
    deg.set(e.source, (deg.get(e.source) ?? 0) + 1)
    deg.set(e.target, (deg.get(e.target) ?? 0) + 1)
  }
  const top = (arr: any[]) => [...arr].sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0))
  return {
    total: { nodes: nodes.length, edges: edges.length },
    kinds: { people: people.length, products: products.length, concepts: concepts.length },
    links: { measured: measured.length, asserted: asserted.length },
    degree: deg,
    topPeople: top(people).slice(0, 8),
    topProducts: top(products).slice(0, 8),
    topConcepts: top(concepts).slice(0, 8),
    strongestMeasured: [...measured].sort((a, b) => (b.posts ?? 0) - (a.posts ?? 0)).slice(0, 8),
    strongestAsserted: [...asserted].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0)).slice(0, 8),
  }
}

/**
 * Core filter. `facets` = { people: [id], products: [id], measured: bool,
 * asserted: bool } — arrays empty = all; booleans = include that link kind.
 * Returns the sub-graph (same node/edge shapes) + derived stats.
 */
export function applyFilters(graph: any, facets: any): any {
  const nodesIn = graph?.nodes ?? []
  const edgesIn = graph?.edges ?? []
  const people = new Set(facets?.people ?? [])
  const products = new Set(facets?.products ?? [])
  const keepMeasured = facets?.measured !== false
  const keepAsserted = facets?.asserted !== false

  // Pass 1: node survival by kind facets.
  const nodeOk = new Map<any, boolean>()
  for (const n of nodesIn as any[]) {
    let ok = true
    if (n.kind === 'person' && people.size) ok = people.has(n.id)
    if (n.kind === 'product' && products.size) ok = products.has(n.id)
    nodeOk.set(n.id, ok)
  }

  // Pass 2: edge survival (kind + both endpoints).
  const edges = (edgesIn as any[]).filter((e: any) => {
    if (e.kind === 'asserted' && !keepAsserted) return false
    if (e.kind !== 'asserted' && !keepMeasured) return false
    return nodeOk.get(e.source) && nodeOk.get(e.target)
  })

  // Pass 3: drop orphan nodes (no surviving edge touches them).
  const touched = new Set<any>()
  for (const e of edges as any[]) {
    touched.add(e.source)
    touched.add(e.target)
  }
  const nodes = (nodesIn as any[]).filter((n: any) => nodeOk.get(n.id) && touched.has(n.id))

  return { nodes, edges, stats: graphStats({ nodes, edges }) }
}

/**
 * Availability per facet: values that keep the graph non-empty given the
 * OTHER facets. Implemented as: for candidate value v in facet F, filter
 * with F=[v] and the other facets unchanged; keep v if any edge survives.
 */
export function facetAvailability(graph: any, facets: any): any {
  const base = {
    people: facets?.people ?? [],
    products: facets?.products ?? [],
    measured: facets?.measured !== false,
    asserted: facets?.asserted !== false,
  }
  const canSee = (f: any) => applyFilters(graph, f).edges.length > 0

  const people = new Set()
  for (const n of (graph?.nodes ?? []) as any[]) {
    if (n.kind !== 'person') continue
    if (base.people.includes(n.id) || canSee({ ...base, people: [n.id] })) people.add(n.id)
  }
  const products = new Set()
  for (const n of (graph?.nodes ?? []) as any[]) {
    if (n.kind !== 'product') continue
    if (base.products.includes(n.id) || canSee({ ...base, products: [n.id] })) products.add(n.id)
  }

  // Link-kind availability: independent of each other — a kind is
  // available if at least one edge of that kind survives the NODE facets
  // (enabling it then always shows something).
  const nodeFacets = { people: base.people, products: base.products }
  const kindsUp = (kind: string) =>
    ((graph?.edges ?? []) as any[]).some(
      (e) => e.kind === kind && applyFilters(graph, nodeFacets).edges.some((x: any) => x.id === e.id),
    )
  const measured = kindsUp('co_mention')
  const asserted = kindsUp('asserted')

  return { people, products, measured, asserted }
}

/** Option lists for the dropdowns, ranked by degree, with link hints. */
export function facetOptions(graph: any): any {
  const nodes: any[] = graph?.nodes ?? []
  const edges: any[] = graph?.edges ?? []
  const linksOf = new Map<any, number>()
  for (const e of edges as any[]) {
    linksOf.set(e.source, (linksOf.get(e.source) ?? 0) + 1)
    linksOf.set(e.target, (linksOf.get(e.target) ?? 0) + 1)
  }
  const mk = (kind: string) =>
    nodes
      .filter((n) => n.kind === kind)
      .sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0))
      .map((n) => ({
        value: n.id,
        label: n.label,
        hint: `${linksOf.get(n.id) ?? 0} links`,
      }))
  return { people: mk('person'), products: mk('product') }
}
