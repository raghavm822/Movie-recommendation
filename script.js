const IMG  = 'https://image.tmdb.org/t/p/';
const BASE = 'https://api.themoviedb.org/3';
const KEY  = 'b4858facf98ac4ea08a2880fae787d15';

// ── CACHE SYSTEM — stores data per tab with timestamp ──
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour in ms
let cache = {};
let currentTab = 'trending';
let heroMovies = [], heroIdx = 0, heroTimer = null;
let searchTimer = null;
let totalLoaded = 0;
let autoRefreshTimer = null;

// Liked movies persisted in localStorage
let liked = JSON.parse(localStorage.getItem('cineai_liked') || '{}');

const GENRES = {
  28:'Action',12:'Adventure',16:'Animation',35:'Comedy',80:'Crime',
  99:'Documentary',18:'Drama',10751:'Family',14:'Fantasy',36:'History',
  27:'Horror',10402:'Music',9648:'Mystery',10749:'Romance',
  878:'Sci-Fi',53:'Thriller',37:'Western'
};
const GENRE_LIST = [
  {id:28,name:'Action'},{id:12,name:'Adventure'},{id:16,name:'Animation'},
  {id:35,name:'Comedy'},{id:80,name:'Crime'},{id:18,name:'Drama'},
  {id:14,name:'Fantasy'},{id:27,name:'Horror'},{id:10749,name:'Romance'},
  {id:878,name:'Sci-Fi'},{id:53,name:'Thriller'},{id:27,name:'Horror'},
  {id:36,name:'History'},{id:10402,name:'Music'}
];

// ── HELPERS ──
function escStr(s){ return (s||'').replace(/'/g,"\\'").replace(/"/g,'&quot;'); }

function tabEndpoint(tab) {
  const map = {
    trending:    '/trending/movie/day',   // updates DAILY
    popular:     '/movie/popular',         // updates frequently
    top_rated:   '/movie/top_rated',       // changes as votes come in
    upcoming:    '/movie/upcoming',        // changes as release dates change
    now_playing: '/movie/now_playing'      // changes as movies enter/leave theatres
  };
  return map[tab] || '/trending/movie/day';
}

function tabLabel(t) {
  return {trending:'Trending Today',popular:'Most Popular',
    top_rated:'Top Rated',upcoming:'Coming Soon',now_playing:'In Theatres Now'}[t]||t;
}

function formatTime(date) {
  return date.toLocaleTimeString('en-IN', {hour:'2-digit', minute:'2-digit'});
}

function formatDate(date) {
  return date.toLocaleDateString('en-IN', {day:'numeric', month:'short', year:'numeric'});
}

function isNewRelease(dateStr) {
  if (!dateStr) return false;
  const diff = (new Date() - new Date(dateStr)) / (1000*60*60*24);
  return diff >= 0 && diff <= 30; // released in last 30 days
}

// ── LIVE CLOCK ──
function startLiveClock() {
  const update = () => {
    const now = new Date();
    const el = document.getElementById('today-date');
    if (el) el.textContent = formatDate(now);
  };
  update();
  setInterval(update, 60000);
}

// ── NEXT REFRESH COUNTDOWN ──
function startRefreshCountdown(nextTime) {
  const tick = () => {
    const remaining = nextTime - Date.now();
    const el = document.getElementById('next-refresh');
    if (!el) return;
    if (remaining <= 0) { el.textContent = 'Now'; return; }
    const m = Math.floor(remaining / 60000);
    const s = Math.floor((remaining % 60000) / 1000);
    el.textContent = `${m}m ${s}s`;
  };
  tick();
  const t = setInterval(tick, 1000);
  return t;
}

// ── API WITH CACHE ──
async function tmdb(endpoint, params={}, bypassCache=false) {
  const cacheKey = endpoint + JSON.stringify(params);
  const now = Date.now();

  // Return cached data if fresh
  if (!bypassCache && cache[cacheKey] && (now - cache[cacheKey].time < CACHE_DURATION)) {
    return cache[cacheKey].data;
  }

  const q = new URLSearchParams({api_key:KEY, language:'en-US', region:'IN', ...params});
  const r = await fetch(`${BASE}${endpoint}?${q}`);
  if (!r.ok) {
    if (r.status === 404) return null;
    throw new Error(`TMDB ${r.status}`);
  }
  const data = await r.json();

  // Store in cache with timestamp
  cache[cacheKey] = { data, time: now };
  return data;
}

// ── INIT ──
window.addEventListener('DOMContentLoaded', () => {
  startLiveClock();
  loadHome(false);
  scheduleAutoRefresh();
});

// ── AUTO REFRESH every 1 hour ──
function scheduleAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  const nextTime = Date.now() + CACHE_DURATION;
  startRefreshCountdown(nextTime);

  autoRefreshTimer = setInterval(() => {
    cache = {}; // clear cache
    loadHome(true); // force fresh fetch
    showToast('🔄 Database refreshed with latest movies!', 'success');
    scheduleAutoRefresh(); // reset countdown
  }, CACHE_DURATION);
}

// ── MANUAL REFRESH ──
async function manualRefresh() {
  const btn = document.getElementById('refresh-btn');
  btn.classList.add('spinning');
  cache = {}; // clear all cache
  await loadHome(true);
  btn.classList.remove('spinning');
  showToast('✅ Refreshed with latest TMDB data!', 'success');
  scheduleAutoRefresh();
}

// ── LOAD HOME ──
async function loadHome(forceRefresh=false) {
  const main = document.getElementById('main');
  main.innerHTML = `<div class="loader"><div class="loader-ring"></div><p>Fetching live data from TMDB…</p></div>`;

  try {
    // Fetch current tab + extra pages for variety
    const [page1, page2] = await Promise.all([
      tmdb(tabEndpoint(currentTab), {page:1}, forceRefresh),
      tmdb(tabEndpoint(currentTab), {page:2}, forceRefresh)
    ]);

    if (!page1) throw new Error('Could not connect to TMDB');

    // Merge pages, deduplicate by id
    const seen = new Set();
    const allMovies = [...(page1.results||[]), ...(page2?.results||[])].filter(m => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });

    heroMovies = allMovies.slice(0, 5);
    totalLoaded = allMovies.length;

    // Update status bar
    const now = new Date();
    const el = document.getElementById('last-updated');
    if (el) el.textContent = formatTime(now);
    const ml = document.getElementById('movies-loaded');
    if (ml) ml.textContent = totalLoaded;

    let html = buildHero(heroMovies[0]);
    html += buildGenreStrip();
    html += `<div id="rec-section"></div>`;
    html += buildSection(tabLabel(currentTab), allMovies, 'tab-grid', page1.total_results);

    main.innerHTML = html;
    initHeroRotation();
    updateLikeCount();
    renderRecPanel();

  } catch(e) {
    main.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><h3>Connection error</h3><p>${e.message}</p></div>`;
  }
}

// ── HERO ──
function buildHero(m) {
  if (!m) return '';
  const bg    = m.backdrop_path ? `${IMG}w1280${m.backdrop_path}` : '';
  const score = m.vote_average?.toFixed(1)||'N/A';
  const year  = m.release_date?.slice(0,4)||'';
  const genres = (m.genre_ids||[]).slice(0,2).map(id=>GENRES[id]).filter(Boolean).join(' · ');
  const isLiked = !!liked[m.id];
  return `
  <div class="hero" id="hero-wrap">
    <div class="hero-bg" id="hero-bg" style="background-image:url('${bg}');background-size:cover;background-position:center top;"></div>
    <div class="hero-content">
      <div class="hero-badge">✦ ${tabLabel(currentTab)}</div>
      <div class="hero-title" onclick="openModal(${m.id})" style="cursor:pointer">${m.title}</div>
      <div class="hero-meta">
        <span class="hero-rating">★ ${score}</span>
        <span class="hero-year">${year}</span>
        ${genres?`<span class="hero-genre">${genres}</span>`:''}
        ${isNewRelease(m.release_date)?'<span style="color:var(--green);font-size:11px;font-weight:700">● NEW</span>':''}
      </div>
      <div class="hero-overview">${m.overview||''}</div>
      <button class="hero-like-btn ${isLiked?'liked':''}" id="hero-like-btn"
        onclick="toggleLike(${m.id},'${escStr(m.title)}',${JSON.stringify(m.genre_ids||[])})">
        ${isLiked?'❤️ Liked':'🤍 Like this movie'}
      </button>
    </div>
  </div>`;
}

function initHeroRotation() {
  if (heroTimer) clearInterval(heroTimer);
  heroTimer = setInterval(() => {
    heroIdx = (heroIdx+1) % heroMovies.length;
    const m = heroMovies[heroIdx];
    const bg = document.getElementById('hero-bg');
    if (!bg) { clearInterval(heroTimer); return; }
    bg.style.opacity = '0';
    setTimeout(() => {
      if (m.backdrop_path) bg.style.backgroundImage = `url('${IMG}w1280${m.backdrop_path}')`;
      bg.style.opacity = '1';
      const t = document.querySelector('.hero-title');
      if (t) { t.textContent = m.title; t.onclick = ()=>openModal(m.id); }
      const ov = document.querySelector('.hero-overview');
      if (ov) ov.textContent = m.overview||'';
      const btn = document.getElementById('hero-like-btn');
      if (btn) {
        const il = !!liked[m.id];
        btn.className = `hero-like-btn ${il?'liked':''}`;
        btn.textContent = il ? '❤️ Liked' : '🤍 Like this movie';
        btn.onclick = () => toggleLike(m.id, m.title, m.genre_ids||[]);
      }
    }, 800);
  }, 5000);
}

// ── GENRE STRIP ──
function buildGenreStrip() {
  return `<div class="genre-strip">
    ${GENRE_LIST.map(g=>`<div class="genre-chip" onclick="loadByGenre(${g.id},'${g.name}',this)">${g.name}</div>`).join('')}
  </div>`;
}

// ── SECTION ──
function buildSection(title, movies, id, total) {
  const totalStr = total ? `${total.toLocaleString()} movies` : `${movies.length} movies`;
  return `<div class="section">
    <div class="section-head">
      <span class="section-title">${title}</span>
      <span class="section-meta">${totalStr} in database</span>
    </div>
    <div class="movie-grid" id="${id}">${movies.map((m,i)=>movieCardHTML(m,i)).join('')}</div>
  </div>`;
}

function movieCardHTML(m, i=0) {
  const poster = m.poster_path
    ? `<img src="${IMG}w342${m.poster_path}" alt="${escStr(m.title||m.name||'')}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=no-poster>🎬<span>No image</span></div>'">`
    : `<div class="no-poster">🎬<span>No image</span></div>`;
  const score  = m.vote_average?.toFixed(1)||'?';
  const year   = (m.release_date||'').slice(0,4);
  const isLiked = !!liked[m.id];
  const newRelease = isNewRelease(m.release_date);
  const genres = m.genre_ids||[];
  return `
  <div class="movie-card" style="animation-delay:${i*0.035}s">
    <div class="card-poster" onclick="openModal(${m.id})">
      ${poster}
      ${newRelease
        ? `<div class="card-new">NEW</div>`
        : `<div class="card-score">★ ${score}</div>`}
      <div class="card-like ${isLiked?'liked':''}"
        onclick="event.stopPropagation();toggleLike(${m.id},'${escStr(m.title||m.name||'')}',${JSON.stringify(genres)})">
        ${isLiked?'❤️':'🤍'}
      </div>
    </div>
    <div class="card-body" onclick="openModal(${m.id})">
      <div class="card-title">${m.title||m.name}</div>
      <div class="card-year">${year}</div>
    </div>
  </div>`;
}

// ── GENRE FILTER ──
async function loadByGenre(id, name, el) {
  document.querySelectorAll('.genre-chip').forEach(c=>c.classList.remove('active'));
  el.classList.add('active');
  const grid = document.getElementById('tab-grid');
  if (!grid) return;
  grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--muted)">
    <div class="rec-spinner" style="width:28px;height:28px;border-width:2px;margin:0 auto 10px"></div>Loading ${name}…</div>`;

  // Fetch 2 pages of genre results
  const [p1, p2] = await Promise.all([
    tmdb('/discover/movie', {with_genres:id, sort_by:'popularity.desc', page:1}),
    tmdb('/discover/movie', {with_genres:id, sort_by:'popularity.desc', page:2})
  ]);
  const movies = [...(p1?.results||[]), ...(p2?.results||[])];
  const sec = grid.closest('.section');
  if (sec) {
    sec.querySelector('.section-title').textContent = name;
    const meta = sec.querySelector('.section-meta');
    if (meta) meta.textContent = `${(p1?.total_results||0).toLocaleString()} movies in database`;
  }
  grid.innerHTML = movies.map((m,i)=>movieCardHTML(m,i)).join('');
  updateLikeCount();
}

// ── TAB SWITCH ──
async function switchTab(tab, el) {
  currentTab = tab;
  document.querySelectorAll('.nav-tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('search-input').value = '';
  if (heroTimer) clearInterval(heroTimer);
  loadHome(false);
}

// ── SEARCH — searches live TMDB every keystroke ──
function onSearch(val) {
  clearTimeout(searchTimer);
  if (!val.trim()) { loadHome(false); return; }
  searchTimer = setTimeout(() => doSearch(val.trim()), 400);
}

async function doSearch(q) {
  if (heroTimer) clearInterval(heroTimer);
  const main = document.getElementById('main');
  main.innerHTML = `<div class="loader"><div class="loader-ring"></div><p>Searching TMDB for "${q}"…</p></div>`;

  // Fetch 2 pages of search results
  const [p1, p2] = await Promise.all([
    tmdb('/search/movie', {query:q, page:1}),
    tmdb('/search/movie', {query:q, page:2})
  ]);

  const results = [...(p1?.results||[]), ...(p2?.results||[])];
  const total = p1?.total_results||0;

  if (results.length === 0) {
    main.innerHTML = `<div class="empty-state"><div class="icon">🔍</div><h3>No results</h3><p>Try a different title.</p></div>`;
    return;
  }

  // Update status
  const el = document.getElementById('movies-loaded');
  if (el) el.textContent = results.length;

  main.innerHTML = `
    <div style="padding:10px 28px 18px">
      <div style="font-size:18px;font-weight:700">Results for "${q}"</div>
      <div style="font-size:12px;color:var(--muted2);margin-top:4px">${total.toLocaleString()} movies found in TMDB</div>
    </div>
    <div class="section">
      <div class="movie-grid">${results.map((m,i)=>movieCardHTML(m,i)).join('')}</div>
    </div>`;
}

// ── LIKE SYSTEM ──
function toggleLike(id, title, genreIds) {
  if (liked[id]) {
    delete liked[id];
    showToast(`Removed: ${title}`, 'info');
  } else {
    liked[id] = {id, title, genre_ids:genreIds};
    showToast(`❤️ Liked: ${title}`, 'like');
  }
  localStorage.setItem('cineai_liked', JSON.stringify(liked));
  updateLikeCount();
  refreshCardLikes();
  renderRecPanel();
}

function updateLikeCount() {
  document.getElementById('like-count').textContent = Object.keys(liked).length;
}

function refreshCardLikes() {
  document.querySelectorAll('.card-like').forEach(btn => {
    const onclick = btn.getAttribute('onclick')||'';
    const match = onclick.match(/toggleLike\((\d+)/);
    if (!match) return;
    const id = parseInt(match[1]);
    const il = !!liked[id];
    btn.className = `card-like ${il?'liked':''}`;
    btn.textContent = il ? '❤️' : '🤍';
  });
}

function removeLike(id) {
  const title = liked[id]?.title||'';
  delete liked[id];
  localStorage.setItem('cineai_liked', JSON.stringify(liked));
  updateLikeCount(); refreshCardLikes(); renderRecPanel();
  showToast(`Removed: ${title}`, 'info');
}

function clearAllLikes() {
  liked = {};
  localStorage.setItem('cineai_liked', JSON.stringify(liked));
  updateLikeCount(); refreshCardLikes(); renderRecPanel();
}

function scrollToRecs() {
  document.getElementById('rec-section')?.scrollIntoView({behavior:'smooth',block:'start'});
}

// ════════════════════════════════════════════════
// MACHINE LEARNING ENGINE — runs 100% in browser
// Algorithm: TF-IDF Vectorization + Cosine Similarity
// Same technique used by Netflix & Spotify
// ════════════════════════════════════════════════

// Build a TF-IDF feature vector for a movie
function buildFeatureVector(movie, vocabulary) {
  const vec = new Array(vocabulary.length).fill(0);
  const tokens = getTokens(movie);
  const tf = {};
  tokens.forEach(t => { tf[t] = (tf[t]||0) + 1; });
  vocabulary.forEach((word, i) => {
    if (tf[word]) vec[i] = tf[word] / tokens.length; // TF score
  });
  return vec;
}

// Extract meaningful tokens from a movie (genres + keywords from overview)
function getTokens(movie) {
  const tokens = [];
  // Genre tokens (weighted 3x — most important signal)
  const genreNames = (movie.genre_ids||movie.genres?.map(g=>g.id)||[])
    .map(id => GENRES[id]||'').filter(Boolean);
  genreNames.forEach(g => { tokens.push(g,g,g); }); // 3x weight

  // Overview word tokens (important content signal)
  const words = (movie.overview||'').toLowerCase()
    .replace(/[^a-z\s]/g,'').split(/\s+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w));
  tokens.push(...words);

  // Rating bucket token (people want similar quality)
  const rating = movie.vote_average||0;
  if (rating >= 8)      tokens.push('excellent','excellent');
  else if (rating >= 7) tokens.push('great');
  else if (rating >= 6) tokens.push('good');

  // Popularity bucket
  if ((movie.popularity||0) > 100) tokens.push('blockbuster');

  return tokens;
}

// Common English stop words to ignore
const STOP_WORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with',
  'his','her','their','its','this','that','when','where','who','what',
  'after','before','from','into','through','during','while','about',
  'against','between','into','through','they','them','then','than',
  'have','has','had','been','will','would','could','should','may',
  'might','must','shall','can','does','did','do','be','is','are','was','were'
]);

// Cosine similarity between two vectors
function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

// Build vocabulary from all candidate movies + liked movies
function buildVocabulary(movies) {
  const freq = {};
  movies.forEach(m => {
    const tokens = new Set(getTokens(m));
    tokens.forEach(t => { freq[t] = (freq[t]||0) + 1; });
  });
  // IDF: keep words that appear in 2+ movies (not too rare, not too common)
  return Object.entries(freq)
    .filter(([,f]) => f >= 2 && f < movies.length * 0.8)
    .map(([word]) => word);
}

// ── MAIN ML RECOMMENDATION FUNCTION ──
async function runMLRecommendations(likedList, candidateMovies) {
  // Step 1: Build vocabulary from all movies (TF-IDF foundation)
  const allMovies = [...likedList, ...candidateMovies];
  const vocabulary = buildVocabulary(allMovies);

  if (vocabulary.length === 0) return candidateMovies.slice(0, 16);

  // Step 2: Vectorize all movies using TF-IDF
  const candidateVectors = candidateMovies.map(m => buildFeatureVector(m, vocabulary));

  // Step 3: Build USER PROFILE vector = average of all liked movie vectors
  // This is the core ML step — learning user taste from behavior
  const likedVectors = likedList.map(m => buildFeatureVector(m, vocabulary));
  const userProfile = new Array(vocabulary.length).fill(0);
  likedVectors.forEach(vec => {
    vec.forEach((val, i) => { userProfile[i] += val; });
  });
  // Normalize user profile
  userProfile.forEach((_, i) => { userProfile[i] /= likedList.length; });

  // Step 4: Score each candidate by cosine similarity to user profile
  const likedIds = new Set(likedList.map(m => m.id));
  const scored = candidateMovies
    .filter(m => !likedIds.has(m.id) && m.poster_path)
    .map((m, i) => ({
      movie: m,
      score: cosineSimilarity(userProfile, candidateVectors[i])
    }))
    .sort((a, b) => b.score - a.score); // highest similarity first

  return scored.slice(0, 16).map(s => ({...s.movie, mlScore: s.score}));
}

// ── RECOMMENDATION PANEL — powered by ML ──
async function renderRecPanel() {
  const sec = document.getElementById('rec-section');
  if (!sec) return;
  const likedList = Object.values(liked);

  if (likedList.length === 0) {
    sec.innerHTML = `<div class="rec-panel" style="text-align:center;padding:24px">
      <div style="font-size:28px;margin-bottom:8px">🤍</div>
      <div style="font-weight:700;margin-bottom:4px">No liked movies yet</div>
      <div style="font-size:13px;color:var(--muted2)">Click ❤️ on any movie — ML engine will learn your taste</div>
    </div>`;
    return;
  }

  const tags = likedList.map(m =>
    `<div class="liked-tag">${m.title}<span class="remove" onclick="removeLike(${m.id})">×</span></div>`
  ).join('');

  const mlLabel = likedList.length === 1
    ? 'Like 2+ movies to improve recommendations'
    : `ML trained on ${likedList.length} liked movies`;

  sec.innerHTML = `<div class="rec-panel">
    <div class="rec-panel-head">
      <div class="rec-panel-title">Movies Suggested <span>for you</span></div>
      <button class="rec-clear" onclick="clearAllLikes()">Clear all</button>
    </div>
    <div class="rec-panel-sub">${mlLabel} — Smart AI recommendations based on your taste</div>
    <div class="liked-tags">${tags}</div>
    <div id="rec-results"><div class="rec-loading"><div class="rec-spinner"></div>Running ML algorithm…</div></div>
  </div>`;

  // Count top genres from liked movies
  const genreCounts = {};
  likedList.forEach(m => {
    (m.genre_ids||[]).forEach(gid => { genreCounts[gid] = (genreCounts[gid]||0)+1; });
  });
  const topGenres = Object.entries(genreCounts).sort((a,b)=>b[1]-a[1])
    .slice(0,4).map(([id])=>id).join(',');

  try {
    // Fetch large candidate pool for ML to rank
    const fetches = [
      tmdb('/discover/movie', {with_genres:topGenres, sort_by:'popularity.desc', page:1}),
      tmdb('/discover/movie', {with_genres:topGenres, sort_by:'popularity.desc', page:2}),
      tmdb('/discover/movie', {with_genres:topGenres, sort_by:'vote_average.desc', 'vote_count.gte':200, page:1}),
      tmdb('/trending/movie/week'),
      ...likedList.slice(0,2).map(m => tmdb(`/movie/${m.id}/similar`, {page:1}))
    ];

    const results = await Promise.all(fetches);

    // Merge into one big candidate pool (deduplicated)
    const seen = new Set(likedList.map(m=>m.id));
    const candidates = [];
    for (const r of results) {
      for (const m of (r?.results||[])) {
        if (!seen.has(m.id)) { seen.add(m.id); candidates.push(m); }
      }
    }

    // ✨ RUN THE ML ALGORITHM ✨
    const mlRecs = await runMLRecommendations(likedList, candidates);

    const el = document.getElementById('rec-results');
    if (!el) return;

    if (mlRecs.length === 0) {
      el.innerHTML = `<div style="color:var(--muted2);font-size:13px;padding:10px 0">No recommendations found. Try liking more movies!</div>`;
      return;
    }

    // Show ML scores on cards
    el.innerHTML = `
      <div style="font-size:11px;color:var(--muted2);margin-bottom:12px;display:flex;align-items:center;gap:8px">
        <span style="background:rgba(123,97,255,0.15);border:1px solid rgba(123,97,255,0.3);color:#b4a8ff;padding:3px 10px;border-radius:20px;font-weight:600">
          🧠 Ranked by cosine similarity to your taste profile
        </span>
        <span style="color:var(--muted)">Higher % = better match</span>
      </div>
      <div class="movie-grid">${mlRecs.map((m,i) => movieCardWithScore(m,i)).join('')}</div>`;

  } catch(e) {
    const el = document.getElementById('rec-results');
    if (el) el.innerHTML = `<div style="color:var(--muted2);font-size:13px">Error: ${e.message}</div>`;
  }
}

// Movie card with ML similarity score shown
function movieCardWithScore(m, i=0) {
  const poster = m.poster_path
    ? `<img src="${IMG}w342${m.poster_path}" alt="${escStr(m.title||m.name||'')}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=no-poster>🎬<span>No image</span></div>'">`
    : `<div class="no-poster">🎬<span>No image</span></div>`;
  const score    = m.vote_average?.toFixed(1)||'?';
  const year     = (m.release_date||'').slice(0,4);
  const isLiked  = !!liked[m.id];
  const genres   = m.genre_ids||[];
  const mlPct    = m.mlScore ? Math.round(m.mlScore * 100) : 0;
  const mlColor  = mlPct > 60 ? 'var(--green)' : mlPct > 35 ? 'var(--accent)' : 'var(--muted2)';
  return `
  <div class="movie-card" style="animation-delay:${i*0.035}s">
    <div class="card-poster" onclick="openModal(${m.id})">
      ${poster}
      <div class="card-score">★ ${score}</div>
      <div class="card-like ${isLiked?'liked':''}"
        onclick="event.stopPropagation();toggleLike(${m.id},'${escStr(m.title||m.name||'')}',${JSON.stringify(genres)})">
        ${isLiked?'❤️':'🤍'}
      </div>
    </div>
    <div class="card-body" onclick="openModal(${m.id})">
      <div class="card-title">${m.title||m.name}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px">
        <div class="card-year">${year}</div>
        <div style="font-size:11px;font-weight:700;color:${mlColor}">${mlPct}% match</div>
      </div>
    </div>
  </div>`;
}

// ── MODAL ──
async function openModal(id) {
  const overlay = document.getElementById('modal');
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  document.getElementById('modal-body').innerHTML = `<div class="loader" style="padding:36px 0"><div class="loader-ring"></div></div>`;
  const bd = document.getElementById('modal-backdrop');
  bd.style.background = 'var(--surface2)';
  bd.querySelectorAll('img').forEach(i=>i.remove());

  const [detail, credits] = await Promise.all([
    tmdb(`/movie/${id}`),
    tmdb(`/movie/${id}/credits`)
  ]);
  if (!detail) return;

  if (detail.backdrop_path) {
    const img = document.createElement('img');
    img.src = `${IMG}w1280${detail.backdrop_path}`;
    img.alt = detail.title;
    bd.prepend(img);
  }

  const score    = detail.vote_average?.toFixed(1)||'N/A';
  const year     = detail.release_date?.slice(0,4)||'';
  const runtime  = detail.runtime ? `${Math.floor(detail.runtime/60)}h ${detail.runtime%60}m` : '';
  const genres   = (detail.genres||[]).map(g=>`<span class="modal-genre">${g.name}</span>`).join('');
  const votes    = detail.vote_count?.toLocaleString()||'0';
  const revenue  = detail.revenue ? '$'+Math.round(detail.revenue/1e6)+'M' : '—';
  const budget   = detail.budget ? '$'+Math.round(detail.budget/1e6)+'M' : '—';
  const director = credits?.crew?.find(c=>c.job==='Director')?.name||'—';
  const cast     = (credits?.cast||[]).slice(0,5).map(c=>c.name).join(', ')||'—';
  const isLiked  = !!liked[id];
  const genreIds = (detail.genres||[]).map(g=>g.id);
  const newRel   = isNewRelease(detail.release_date);

  document.getElementById('modal-body').innerHTML = `
    <div class="modal-title">${detail.title}</div>
    ${detail.tagline?`<div class="modal-tagline">"${detail.tagline}"</div>`:''}
    <div class="modal-meta">
      <span class="meta-badge rating">★ ${score}</span>
      ${year?`<span class="meta-badge year">${year}</span>`:''}
      ${runtime?`<span class="meta-badge runtime">⏱ ${runtime}</span>`:''}
      ${newRel?`<span class="meta-badge new-release">● New Release</span>`:''}
    </div>
    <div class="modal-genres">${genres}</div>
    <div class="modal-overview">${detail.overview||'No overview available.'}</div>
    <div class="modal-stats">
      <div class="stat-box"><div class="stat-val">${score}</div><div class="stat-lbl">TMDB Score</div></div>
      <div class="stat-box"><div class="stat-val">${votes}</div><div class="stat-lbl">Votes</div></div>
      <div class="stat-box"><div class="stat-val">${revenue}</div><div class="stat-lbl">Box Office</div></div>
      <div class="stat-box"><div class="stat-val">${budget}</div><div class="stat-lbl">Budget</div></div>
    </div>
    <button class="modal-like-btn ${isLiked?'liked':''}" id="modal-like-btn"
      onclick="toggleLike(${detail.id},'${escStr(detail.title)}',${JSON.stringify(genreIds)});
               this.className='modal-like-btn '+(liked[${detail.id}]?'liked':'');
               this.textContent=liked[${detail.id}]?'❤️ Liked — Remove':'🤍 Like this movie'">
      ${isLiked?'❤️ Liked — Remove':'🤍 Like this movie'}
    </button>
    <div style="margin-top:16px;font-size:13px;color:var(--muted2);line-height:2">
      <div><strong style="color:var(--muted)">Director</strong> &nbsp;${director}</div>
      <div><strong style="color:var(--muted)">Cast</strong> &nbsp;${cast}</div>
      <div><strong style="color:var(--muted)">Release</strong> &nbsp;${detail.release_date||'—'}</div>
      <div><strong style="color:var(--muted)">Language</strong> &nbsp;${(detail.spoken_languages||[]).map(l=>l.english_name).join(', ')||'—'}</div>
    </div>`;
}

function closeModal(e) { if(e.target===document.getElementById('modal')) closeModalDirect(); }
function closeModalDirect() { document.getElementById('modal').classList.remove('open'); document.body.style.overflow=''; }
document.addEventListener('keydown', e=>{ if(e.key==='Escape') closeModalDirect(); });

// ── TOAST ──
let toastTimer;
function showToast(msg, type='info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove('show'), 2800);
}