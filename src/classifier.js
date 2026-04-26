// Generic priority-ordered keyword classifier.
// Segments + exclusion list are loaded from the user's Google Sheet at runtime
// (see sheets.js: loadSegmentsFromSheet, loadExcludedFromSheet).
//
// Segment shape:  { id: string, keywords: string[], priority: number }
// Excluded shape: { names: Set<string>, urls: Set<string>, companies: Set<string> }
//
// Priority is ascending: lower number = checked first. The first segment whose
// keyword set finds a substring match in the headline wins. A segment with an
// empty keywords array acts as the fallback ("Other").

let excluded = { names: new Set(), urls: new Set(), companies: new Set() };
let segments = [];

export function initExcluded(data) {
  excluded = data;
}

export function initSegments(segs) {
  segments = [...segs].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
}

export function getSegmentIds() {
  return segments.map(s => s.id);
}

export function classify(name, headline = '', profileUrl = '') {
  const nameLower = (name || '').toLowerCase().trim();
  const headlineLower = (headline || '').toLowerCase();
  const urlLower = (profileUrl || '').toLowerCase();

  // 1. Excluded list
  const isExcluded =
    excluded.names.has(nameLower) ||
    (excluded.companies.size > 0 && [...excluded.companies].some(c => headlineLower.includes(c))) ||
    (urlLower && excluded.urls.size > 0 && [...excluded.urls].some(u => urlLower.includes(u)));

  if (isExcluded) return { category: 'excluded', isExcluded: true };

  // 2. First matching segment by priority
  for (const seg of segments) {
    if (seg.keywords.length === 0) continue; // skip fallback for now
    if (seg.keywords.some(kw => kw && headlineLower.includes(kw.toLowerCase()))) {
      return { category: seg.id, isExcluded: false };
    }
  }

  // 3. Fallback — first segment with empty keywords (typically "Other")
  const fallback = segments.find(s => s.keywords.length === 0);
  return { category: fallback?.id || 'Other', isExcluded: false };
}

/** Aggregate: returns { counts, classified } */
export function classifyAllDetailed(engagers) {
  const byCategory = {};
  for (const seg of segments) byCategory[seg.id] = 0;

  const counts = {
    total: 0,
    outsideTeam: 0,    // kept name for compat with sheets.js
    teamCount: 0,      // = excludedCount
    byCategory,
  };
  const classified = [];

  for (const e of engagers) {
    counts.total++;
    const { category, isExcluded } = classify(e.name, e.headline, e.profileUrl);

    classified.push({
      name: e.name,
      headline: e.headline || '',
      profileUrl: e.profileUrl || '',
      category: isExcluded ? 'Excluded' : category,
      isTeam: isExcluded,
    });

    if (isExcluded) {
      counts.teamCount++;
      continue;
    }
    counts.outsideTeam++;
    counts.byCategory[category] = (counts.byCategory[category] ?? 0) + 1;
  }

  return { counts, classified };
}

export function classifyAll(engagers) {
  return classifyAllDetailed(engagers).counts;
}
