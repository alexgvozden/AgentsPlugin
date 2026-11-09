// chrome-reddit.js — the Claude in Chrome fallback for fetch-reddit.mjs (when RSS is blocked or gone).
//
// How to use: open a tab on https://www.reddit.com in the user's signed-in Chrome, edit the INPUT
// block below, and paste the whole file into javascript_tool in that tab. It fetches Reddit's
// listing JSON same-origin (the session's cookies make it work where curl gets 403), one request
// at a time with a pause between, and returns a JSON string:
//   {ok, requests, truncated?, feeds:[{label,status,children,kept}], posts:[…], comments:[…]}
// Each post has the posts.jsonl shape of fetch-reddit.mjs (plus score and numComments); save the
// posts one per line in chrome-<n>.jsonl (or save the whole result object as one line) and
// combine with merge-posts.mjs.
//
// It only reads: no voting, posting, commenting, joining or saving. Usernames are never returned
// (no author field; "/u/name" and "u/name" in texts become "a user").
//
// The filter, scrub and kind rules are copied from scripts/lib.mjs (a page script cannot import);
// keep them in step. The project's filters (sources.json) and kind rules (codebook.json) are pasted
// into INPUT; merge-posts.mjs works the hits and kinds out again anyway.

(async () => {
  // ======================= INPUT: edit per call =======================
  const INPUT = {
    // Labels as in fetch-reddit.mjs: "Sub:new", "Sub:search:<q>", "search:<q>" (merge-posts.mjs
    // reads the subreddit's require from "Sub:…", and the sitewide require for "search:…":
    // sources.json's search_require, else every filter).
    feeds: [
      // { label: 'SomeSub:new', path: '/r/SomeSub/new.json?limit=100' },
      // { label: 'SomeSub:search:visa', path: '/r/SomeSub/search.json?q=visa&restrict_sr=on&sort=new&t=year&limit=100', require: ['topic'] },
      // { label: 'search:some phrase', path: '/search.json?q=some%20phrase&t=year&limit=100', require: ['topic', 'place'] },
    ],
    months: 12,
    require: [], // default for a feed without its own `require`: names of filters that must all match
    filters: {
      // paste the "filters" object from sources.json here as it is: { "<name>": [...], … }
    },
    // paste the "kinds" list and "defaultKind" from codebook.json as they are (empty: only the
    // generic question rule, then defaultKind)
    kinds: [],
    defaultKind: 'other',
    comments: [
      // '/r/SomeSub/comments/abc123/some_title/'  (a permalink or the full URL)
    ],
    textMax: 700,
    commentMax: 300,
    maxComments: 8,
    gapMs: 2500,
  };
  // ====================================================================

  const LIMIT = 60000;
  const textMax = INPUT.textMax ?? 700;
  const commentMax = INPUT.commentMax ?? 300;
  const maxComments = INPUT.maxComments ?? 8;
  const gapMs = INPUT.gapMs ?? 2500;
  const months = INPUT.months ?? 12;

  // ---------- rules copied from lib.mjs ----------
  function compileFilter(list = []) {
    return list.map((src) => {
      const cs = src.startsWith('cs:');
      const body = cs ? src.slice(3) : src;
      return { cs, re: new RegExp(`(?<![A-Za-z0-9])(${body})(?![A-Za-z0-9])`, cs ? 'g' : 'gi') };
    });
  }
  const compiled = Object.fromEntries(Object.entries(INPUT.filters ?? {}).map(([k, v]) => [k, compileFilter(v)]));
  function hits(name, text) {
    const found = new Set();
    for (const f of compiled[name] ?? []) {
      for (const m of text.matchAll(f.re)) found.add(f.cs ? m[1] : m[1].toLowerCase());
    }
    return [...found].sort();
  }
  const filterNames = Object.keys(INPUT.filters ?? {});
  const allHits = (both) => Object.fromEntries(filterNames.map((n) => [`${n}Hits`, hits(n, both)]));
  const meetsRequire = (require, both) => require.every((r) => hits(r, both).length > 0);
  function scrubUsers(s) {
    return s
      .replace(/(?:https?:\/\/)?(?:www\.|old\.)?reddit\.com\/(?:u|user)\/[A-Za-z0-9_-]+\/?/gi, 'a user')
      .replace(/(?<![A-Za-z0-9_/])\/?u\/[A-Za-z0-9_-]{2,}/g, 'a user');
  }
  const cap = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
  const GENERIC_QUESTION = '\\?|^\\s*(how|what|which|is|are|should|can|does|do|any|anyone|need advice)\\b';
  const kindRules = ((INPUT.kinds ?? []).length ? INPUT.kinds : [{ kind: 'question', in: 'title', pattern: GENERIC_QUESTION }])
    .map((k) => ({ kind: k.kind, in: k.in === 'title' ? 'title' : 'all', re: new RegExp(k.pattern, 'i') }));
  function kindOf(title, text) {
    const all = `${title} ${text}`;
    for (const r of kindRules) if (r.re.test(r.in === 'title' ? title : all)) return r.kind;
    return INPUT.defaultKind ?? 'other';
  }
  // ------------------------------------------------

  // Reddit's JSON escapes &, < and > in titles and texts.
  const decode = (s = '') => s.replace(/&(lt|gt|amp|quot|#39|#x27|nbsp);/g, (m, k) => ({ lt: '<', gt: '>', amp: '&', quot: '"', '#39': "'", '#x27': "'", nbsp: ' ' })[k]);
  const clean = (s = '') => scrubUsers(decode(decode(s)).replace(/\s+/g, ' ').trim());
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let requests = 0;
  let lastAt = 0;
  async function getJson(path) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const wait = Math.max(0, lastAt + gapMs - Date.now());
      if (wait) await sleep(wait);
      requests++;
      let res;
      try {
        res = await fetch(path, { credentials: 'include', headers: { Accept: 'application/json' } });
      } catch (err) {
        lastAt = Date.now();
        return { status: `error: ${err.message}` };
      }
      lastAt = Date.now();
      if (res.status === 429 && attempt === 1) {
        const reset = parseFloat(res.headers.get('x-ratelimit-reset') ?? '');
        await sleep((Number.isNaN(reset) ? 60 : reset) * 1000);
        continue;
      }
      if (res.status !== 200) return { status: res.status };
      try {
        return { status: 200, json: await res.json() };
      } catch {
        return { status: '200 not JSON' };
      }
    }
    return { status: 429 };
  }

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);

  const feeds = [];
  const posts = new Map();
  for (const feed of INPUT.feeds ?? []) {
    const label = `chrome:${feed.label}`;
    const require = feed.require ?? INPUT.require ?? [];
    const r = await getJson(feed.path);
    const children = (r.json?.data?.children ?? []).filter((c) => c.kind === 't3');
    let kept = 0;
    for (const { data: d } of children) {
      const id = `t3_${d.id}`;
      const published = new Date((d.created_utc ?? 0) * 1000);
      if (Number.isNaN(published.getTime()) || published < cutoff) continue;
      const title = clean(d.title);
      const full = cap(clean(d.selftext), 2000); // what fetch-reddit.mjs filters on
      const both = `${title} ${full}`;
      const ok = meetsRequire(require, both);
      const existing = posts.get(id);
      if (existing) {
        if (ok && !existing.feeds.includes(label)) existing.feeds.push(label);
        continue;
      }
      if (!ok) continue;
      kept++;
      posts.set(id, {
        id,
        sub: d.subreddit,
        url: `https://www.reddit.com${d.permalink}`,
        title,
        text: cap(full, textMax),
        published: published.toISOString(),
        kind: kindOf(title, full),
        ...allHits(both),
        feeds: [label],
        score: d.score,
        numComments: d.num_comments,
      });
    }
    feeds.push({ label: feed.label, status: r.status, children: children.length, kept });
  }

  const comments = [];
  for (const link of INPUT.comments ?? []) {
    const path = String(link).replace(/^https?:\/\/[^/]+/, '').replace(/[?#].*$/, '').replace(/\/?$/, '/');
    const r = await getJson(`${path}.json?limit=100&depth=1`);
    const post = r.json?.[0]?.data?.children?.[0]?.data;
    const fromPath = path.match(/\/comments\/([a-z0-9]+)/i)?.[1];
    const id = post ? `t3_${post.id}` : fromPath ? `t3_${fromPath}` : path;
    const list = [];
    for (const c of r.json?.[1]?.data?.children ?? []) {
      if (c.kind !== 't1') continue;
      const d = c.data;
      if (d.author === 'AutoModerator') continue;
      const body = (d.body ?? '').trim();
      if (!body || /^\[(deleted|removed)\]$/i.test(body)) continue;
      list.push({ text: cap(clean(body), commentMax), date: new Date(d.created_utc * 1000).toISOString().slice(0, 10), score: d.score });
      if (list.length >= maxComments) break;
    }
    comments.push(r.status === 200 ? { id, comments: list } : { id, status: r.status, comments: [] });
  }

  const sorted = [...posts.values()].sort((a, b) => b.published.localeCompare(a.published) || a.id.localeCompare(b.id));
  const result = { ok: feeds.every((f) => f.status === 200) && comments.every((c) => !c.status), requests, feeds, posts: sorted, comments };
  let out = JSON.stringify(result);
  for (const n of [400, 150]) {
    if (out.length <= LIMIT) break;
    for (const p of sorted) p.text = cap(p.text, n);
    for (const c of comments) for (const x of c.comments) x.text = cap(x.text, Math.min(n, commentMax));
    result.truncated = true;
    result.truncatedTo = n;
    out = JSON.stringify(result);
  }
  if (out.length > LIMIT) {
    result.note = 'Still over 60,000 characters: run again with fewer feeds or comments per call.';
    out = JSON.stringify(result);
  }
  return out;
})()
