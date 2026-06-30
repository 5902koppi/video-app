/* 動画メモ — localStorage に保存するシンプルな動画URL管理PWA */
(() => {
  'use strict';

  const STORE_KEY = 'videos';
  const SETTINGS_KEY = 'settings';

  // ---- state ----
  let videos = load(STORE_KEY, []);
  let settings = load(SETTINGS_KEY, { sort: 'new', favOnly: false });
  let activeTags = new Set();
  let editingId = null;     // 編集中のID（新規追加は null）
  let form = { rating: 0, favorite: false, thumbnail: '' };

  // ---- helpers ----
  function load(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; }
    catch { return fallback; }
  }
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(videos));
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      return true;
    } catch (e) {
      // 容量超過（写真の入れすぎ等）
      alert('保存容量がいっぱいです。サムネ写真を減らすか、不要な動画を削除してください。\n（「書き出し」でバックアップも取れます）');
      return false;
    }
  }
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add('hidden'), 2200);
  }

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); }
    catch { return ''; }
  }

  function parseTags(str) {
    return str.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
  }

  function youtubeId(url) {
    try {
      const u = new URL(url);
      const h = u.hostname.replace(/^www\./, '');
      if (h === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
      if (h.endsWith('youtube.com')) {
        if (u.searchParams.get('v')) return u.searchParams.get('v');
        const m = u.pathname.match(/\/(embed|shorts|live)\/([^/?]+)/);
        if (m) return m[2];
      }
    } catch { /* ignore */ }
    return null;
  }

  // ---- サムネ/タイトル自動取得 ----
  async function fetchMeta(url) {
    const yid = youtubeId(url);
    if (yid) {
      return { title: '', thumbnail: `https://img.youtube.com/vi/${yid}/hqdefault.jpg` };
    }
    // その他サイトは noembed (CORS対応の無料oEmbed) で試みる
    try {
      const res = await fetch('https://noembed.com/embed?url=' + encodeURIComponent(url));
      if (res.ok) {
        const d = await res.json();
        if (!d.error) return { title: d.title || '', thumbnail: d.thumbnail_url || '' };
      }
    } catch { /* ネット不可など */ }
    return { title: '', thumbnail: '' };
  }

  // ============ レンダリング ============
  function allTags() {
    const counts = {};
    videos.forEach(v => v.tags.forEach(t => counts[t] = (counts[t] || 0) + 1));
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  }

  function renderTagBar() {
    const bar = $('#tagBar');
    bar.innerHTML = '';
    allTags().forEach(tag => {
      const b = document.createElement('button');
      b.className = 'chip' + (activeTags.has(tag) ? ' active' : '');
      b.textContent = '#' + tag;
      b.onclick = () => {
        activeTags.has(tag) ? activeTags.delete(tag) : activeTags.add(tag);
        render();
      };
      bar.appendChild(b);
    });
  }

  function visibleVideos() {
    const q = $('#searchInput').value.trim().toLowerCase();
    let arr = videos.filter(v => {
      if (settings.favOnly && !v.favorite) return false;
      for (const t of activeTags) if (!v.tags.includes(t)) return false;
      if (q) {
        const hay = (v.title + ' ' + v.tags.join(' ') + ' ' + v.url).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const s = settings.sort;
    arr.sort((a, b) => {
      if (s === 'new') return b.createdAt - a.createdAt;
      if (s === 'old') return a.createdAt - b.createdAt;
      if (s === 'rating') return (b.rating - a.rating) || (b.createdAt - a.createdAt);
      if (s === 'title') return (a.title || a.url).localeCompare(b.title || b.url, 'ja');
      return 0;
    });
    return arr;
  }

  // 表示用サムネ：保存済みが無くてもYouTubeならURLから導出
  function thumbFor(v) {
    if (v.thumbnail) return v.thumbnail;
    const yid = youtubeId(v.url);
    return yid ? `https://img.youtube.com/vi/${yid}/hqdefault.jpg` : '';
  }

  function starHtml(n) {
    let s = '';
    for (let i = 1; i <= 5; i++) s += `<span class="${i <= n ? '' : 'off'}">★</span>`;
    return s;
  }

  function render() {
    renderTagBar();
    const list = $('#list');
    const arr = visibleVideos();
    list.innerHTML = '';
    $('#emptyMsg').classList.toggle('hidden', videos.length !== 0);

    arr.forEach(v => {
      const card = document.createElement('div');
      card.className = 'card';

      const tsrc = thumbFor(v);
      const thumb = tsrc
        ? `<img class="card-thumb" src="${escapeAttr(tsrc)}" alt="" loading="lazy" data-id="${v.id}">`
        : `<div class="card-thumb" data-id="${v.id}">🎬</div>`;

      card.innerHTML = `
        ${thumb}
        <div class="card-body">
          <div class="card-title" data-id="${v.id}">${escapeHtml(v.title || v.url)}</div>
          <div class="card-host">${escapeHtml(hostOf(v.url))}</div>
          <div class="card-tags">${v.tags.map(t => `<span class="t">#${escapeHtml(t)}</span>`).join('')}</div>
          <div class="card-meta">
            <span class="stars">${starHtml(v.rating)}</span>
            <span class="fav-mark ${v.favorite ? '' : 'off'}">❤</span>
            <button class="card-edit" data-edit="${v.id}" aria-label="編集">✎</button>
          </div>
        </div>`;
      list.appendChild(card);
    });

    // サムネ読み込み失敗時はアイコンに差し替え（data-idは維持）
    list.querySelectorAll('img.card-thumb').forEach(img => {
      img.addEventListener('error', () => {
        const ph = document.createElement('div');
        ph.className = 'card-thumb';
        ph.setAttribute('data-id', img.getAttribute('data-id'));
        ph.textContent = '🎬';
        img.replaceWith(ph);
      }, { once: true });
    });

    $('#count').textContent = `${videos.length}件中 ${arr.length}件`;
  }

  function escapeHtml(s) { return (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function escapeAttr(s) { return escapeHtml(s).replace(/'/g, '&#39;'); }

  // ============ 再生 ============
  function playVideo(id) {
    const v = videos.find(x => x.id === id);
    if (!v) return;
    const yid = youtubeId(v.url);
    if (yid) {
      $('#playerBox').innerHTML =
        `<iframe src="https://www.youtube.com/embed/${yid}?autoplay=1" allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe>`;
      $('#openExternal').href = v.url;
      $('#player').classList.remove('hidden');
    } else {
      window.open(v.url, '_blank', 'noopener');
    }
  }
  function closePlayer() {
    $('#playerBox').innerHTML = '';
    $('#player').classList.add('hidden');
  }

  // ============ 追加 / 編集モーダル ============
  function openModal(id = null) {
    editingId = id;
    const v = id ? videos.find(x => x.id === id) : null;
    form = { rating: v ? v.rating : 0, favorite: v ? v.favorite : false, thumbnail: v ? v.thumbnail : '' };
    $('#modalTitle').textContent = id ? '動画を編集' : '動画を追加';
    $('#fUrl').value = v ? v.url : '';
    $('#fTitle').value = v ? v.title : '';
    $('#fTags').value = v ? v.tags.join(' ') : '';
    $('#fetchStatus').textContent = '';
    $('#deleteBtn').classList.toggle('hidden', !id);
    updateStarsEdit(); updateFavToggle(); updateThumbPreview(); renderTagSuggest();
    $('#modal').classList.remove('hidden');
    if (!id) setTimeout(() => $('#fUrl').focus(), 50);
  }
  function closeModal() { $('#modal').classList.add('hidden'); editingId = null; }

  // フォームのタグ入力欄から現在のタグ配列を取得
  function currentFormTags() { return parseTags($('#fTags').value); }

  // 過去に使ったタグを「タップで選べるチップ」として表示
  function renderTagSuggest() {
    const box = $('#fTagSuggest');
    box.innerHTML = '';
    const selected = currentFormTags();
    allTags().forEach(tag => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (selected.includes(tag) ? ' on' : '');
      b.textContent = '#' + tag;
      b.onclick = () => toggleFormTag(tag);
      box.appendChild(b);
    });
  }

  function toggleFormTag(tag) {
    const tags = currentFormTags();
    const i = tags.indexOf(tag);
    if (i >= 0) tags.splice(i, 1); else tags.push(tag);
    $('#fTags').value = tags.join(' ');
    renderTagSuggest();
  }

  function updateStarsEdit() {
    $$('#fStars span').forEach(s => s.classList.toggle('on', Number(s.dataset.v) <= form.rating));
  }
  function updateFavToggle() { $('#fFav').setAttribute('aria-pressed', String(form.favorite)); }
  function updateThumbPreview() {
    const img = $('#fThumbPreview');
    if (form.thumbnail) { img.src = form.thumbnail; img.classList.remove('hidden'); }
    else img.classList.add('hidden');
    $('#clearThumbBtn').classList.toggle('hidden', !form.thumbnail);
  }

  // アップロード画像を縮小してdataURL化（localStorage節約のため最大480px・JPEG）
  function imageToThumb(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('読み込み失敗'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('画像を開けません'));
        img.onload = () => {
          const max = 480;
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.7));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function onThumbFile(file) {
    if (!file) return;
    try {
      $('#fetchStatus').textContent = '画像を処理中…';
      form.thumbnail = await imageToThumb(file);
      updateThumbPreview();
      $('#fetchStatus').textContent = '写真を設定しました';
    } catch (e) {
      $('#fetchStatus').textContent = '画像の設定に失敗: ' + e.message;
    }
  }

  async function doFetch() {
    const url = $('#fUrl').value.trim();
    if (!url) { toast('先にURLを入力してください'); return; }
    $('#fetchStatus').textContent = '取得中…';
    const meta = await fetchMeta(url);
    if (meta.thumbnail) { form.thumbnail = meta.thumbnail; updateThumbPreview(); }
    if (meta.title && !$('#fTitle').value.trim()) $('#fTitle').value = meta.title;
    $('#fetchStatus').textContent = (meta.thumbnail || meta.title) ? '取得しました' : '自動取得できませんでした（手入力でOK）';
  }

  function saveForm() {
    const url = $('#fUrl').value.trim();
    if (!url) { toast('URLを入力してください'); return; }
    const data = {
      url,
      title: $('#fTitle').value.trim(),
      tags: parseTags($('#fTags').value),
      rating: form.rating,
      favorite: form.favorite,
      thumbnail: form.thumbnail,
    };
    if (editingId) {
      const v = videos.find(x => x.id === editingId);
      Object.assign(v, data);
      toast('更新しました');
    } else {
      videos.push({ id: 'v' + Date.now() + Math.random().toString(36).slice(2, 6), createdAt: Date.now(), ...data });
      toast('保存しました');
    }
    save(); render(); closeModal();
  }

  function deleteCurrent() {
    if (!editingId) return;
    if (!confirm('この動画を削除しますか？')) return;
    videos = videos.filter(x => x.id !== editingId);
    save(); render(); closeModal(); toast('削除しました');
  }

  // ============ バックアップ ============
  function exportData() {
    const blob = new Blob([JSON.stringify(videos, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    const d = new Date().toISOString().slice(0, 10);
    a.href = URL.createObjectURL(blob);
    a.download = `動画メモ_${d}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('書き出しました');
  }
  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data)) throw new Error('形式が違います');
        const mode = confirm('OK＝既存に追加 / キャンセル＝全て置き換え');
        const norm = data.map(v => ({
          id: v.id || ('v' + Date.now() + Math.random().toString(36).slice(2, 6)),
          url: v.url || '', title: v.title || '', thumbnail: v.thumbnail || '',
          tags: Array.isArray(v.tags) ? v.tags : [], rating: Number(v.rating) || 0,
          favorite: !!v.favorite, createdAt: v.createdAt || Date.now(),
        })).filter(v => v.url);
        videos = mode ? videos.concat(norm) : norm;
        save(); render(); toast(`読み込みました（${norm.length}件）`);
      } catch (e) { toast('読み込み失敗: ' + e.message); }
    };
    reader.readAsText(file);
  }

  // ============ 共有受け取り（Web Share Target / クエリ） ============
  function handleShared() {
    const p = new URLSearchParams(location.search);
    const shared = p.get('url') || p.get('text') || p.get('title');
    if (!shared) return;
    // text内のURLを抽出
    const m = shared.match(/https?:\/\/[^\s]+/);
    const url = m ? m[0] : shared;
    history.replaceState(null, '', location.pathname); // クエリを消す
    openModal(null);
    $('#fUrl').value = url;
    doFetch();
  }

  // ============ イベント ============
  function bind() {
    $('#addBtn').onclick = () => openModal(null);
    $('#cancelBtn').onclick = closeModal;
    $('#saveBtn').onclick = saveForm;
    $('#deleteBtn').onclick = deleteCurrent;
    $('#fetchBtn').onclick = doFetch;
    $('#closePlayer').onclick = closePlayer;

    // 一覧はイベント委譲（サムネ再描画後もタップが効く）
    $('#list').addEventListener('click', (e) => {
      const edit = e.target.closest('[data-edit]');
      if (edit) { openModal(edit.getAttribute('data-edit')); return; }
      const card = e.target.closest('[data-id]');
      if (card) playVideo(card.getAttribute('data-id'));
    });

    $('#fStars').onclick = (e) => {
      const v = e.target.dataset.v; if (!v) return;
      form.rating = (form.rating === Number(v)) ? 0 : Number(v); // 同じ星で0に
      updateStarsEdit();
    };
    $('#fFav').onclick = () => { form.favorite = !form.favorite; updateFavToggle(); };

    // タグ入力欄を手で編集したら候補チップの選択状態も更新
    $('#fTags').oninput = renderTagSuggest;

    // 写真アップロード（サムネ手動設定）
    $('#uploadThumbBtn').onclick = () => $('#thumbFile').click();
    $('#thumbFile').onchange = (e) => { onThumbFile(e.target.files[0]); e.target.value = ''; };
    $('#clearThumbBtn').onclick = () => { form.thumbnail = ''; updateThumbPreview(); };

    $('#searchInput').oninput = render;
    $('#sortSelect').value = settings.sort;
    $('#sortSelect').onchange = (e) => { settings.sort = e.target.value; save(); render(); };
    const favBtn = $('#favFilterBtn');
    favBtn.setAttribute('aria-pressed', String(settings.favOnly));
    favBtn.onclick = () => { settings.favOnly = !settings.favOnly; favBtn.setAttribute('aria-pressed', String(settings.favOnly)); save(); render(); };

    $('#exportBtn').onclick = exportData;
    $('#importBtn').onclick = () => $('#importFile').click();
    $('#importFile').onchange = (e) => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ''; };

    // モーダル背景タップで閉じる
    $('#modal').onclick = (e) => { if (e.target.id === 'modal') closeModal(); };
    $('#player').onclick = (e) => { if (e.target.id === 'player') closePlayer(); };
  }

  // ============ 起動 ============
  bind();
  render();
  handleShared();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
