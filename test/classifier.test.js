import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  classify,
  classifyAllDetailed,
  initSegments,
  initExcluded,
} from '../src/classifier.js';

before(() => {
  initSegments([
    { id: 'VC',       keywords: ['investor', 'partner at', 'venture'], priority: 1 },
    { id: 'Founder',  keywords: ['founder', 'ceo', 'co-founder'],     priority: 2 },
    { id: 'Engineer', keywords: ['engineer', 'developer', 'cto'],     priority: 3 },
    { id: 'Other',    keywords: [],                                    priority: 99 },
  ]);
  initExcluded({
    names: new Set(['my cofounder']),
    urls: new Set(['/in/my-cofounder']),
    companies: new Set(['my-company']),
  });
});

describe('classify — priority + matching', () => {
  it('matches VC by keyword in headline', () => {
    const r = classify('Alice', 'Investor at Acme Capital');
    assert.equal(r.category, 'VC');
    assert.equal(r.isExcluded, false);
  });

  it('matches Founder over later segments', () => {
    const r = classify('Bob', 'Founder, ex-engineer');
    assert.equal(r.category, 'Founder');
  });

  it('matches Engineer when no higher priority hits', () => {
    const r = classify('Carol', 'Senior Software Engineer at Big Co');
    assert.equal(r.category, 'Engineer');
  });

  it('falls back to Other when no segment matches', () => {
    const r = classify('Dave', 'Marketing manager at SaaS');
    assert.equal(r.category, 'Other');
  });

  it('excluded by name (case-insensitive)', () => {
    const r = classify('My Cofounder', 'Founder at My Company');
    assert.equal(r.isExcluded, true);
    assert.equal(r.category, 'excluded');
  });

  it('excluded by company in headline', () => {
    const r = classify('Random Name', 'Engineer at My-Company');
    assert.equal(r.isExcluded, true);
  });

  it('excluded by linkedin URL match', () => {
    const r = classify('Random Name', 'Founder', '/in/my-cofounder');
    assert.equal(r.isExcluded, true);
  });
});

describe('classifyAllDetailed — counts', () => {
  it('aggregates counts and excludes', () => {
    const engagers = [
      { name: 'Alice', headline: 'Investor at Foo Capital' },           // VC
      { name: 'Bob', headline: 'Founder of Bar' },                       // Founder
      { name: 'Carol', headline: 'Senior Software Engineer at Co' },     // Engineer
      { name: 'Dave', headline: 'Marketing manager' },                   // Other
      { name: 'My Cofounder', headline: 'CEO' },                         // excluded
    ];
    const { counts } = classifyAllDetailed(engagers);
    assert.equal(counts.total, 5);
    assert.equal(counts.teamCount, 1);
    assert.equal(counts.outsideTeam, 4);
    assert.equal(counts.byCategory.VC, 1);
    assert.equal(counts.byCategory.Founder, 1);
    assert.equal(counts.byCategory.Engineer, 1);
    assert.equal(counts.byCategory.Other, 1);
  });

  it('sums per-category equal to outsideTeam', () => {
    const engagers = [
      { name: 'A', headline: 'investor at fund' },
      { name: 'B', headline: 'founder' },
      { name: 'C', headline: 'engineer' },
    ];
    const { counts } = classifyAllDetailed(engagers);
    const sum = Object.values(counts.byCategory).reduce((s, n) => s + n, 0);
    assert.equal(sum, counts.outsideTeam);
  });
});
