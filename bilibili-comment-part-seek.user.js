// ==UserScript==
// @name         B站评论时间坐标选择分P
// @namespace    https://github.com/jackold701-lang/bilibili-comment-part-seek
// @version      1.3.0
// @description  点击评论时间坐标后选择分P，待目标视频可播放再跳到目标时间前1秒。
// @license      MIT
// @homepageURL  https://github.com/jackold701-lang/bilibili-comment-part-seek
// @supportURL   https://github.com/jackold701-lang/bilibili-comment-part-seek/issues
// @updateURL    https://raw.githubusercontent.com/jackold701-lang/bilibili-comment-part-seek/main/bilibili-comment-part-seek.user.js
// @downloadURL  https://raw.githubusercontent.com/jackold701-lang/bilibili-comment-part-seek/main/bilibili-comment-part-seek.user.js
// @match        https://www.bilibili.com/video/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      api.bilibili.com
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const PANEL_ID = 'bili-comment-part-seek-panel';
  const PENDING_KEY = 'bili-comment-part-seek-pending';
  const TIME_RE = /^\d{1,3}[:：][0-5]\d(?:[:：][0-5]\d)?$/;
  const pageCache = new Map();
  const singlePageBvids = new Set();
  let activePanel = null;
  let switching = false;

  function getBvid() {
    return location.pathname.match(/^\/video\/(BV[\w]+)(?:\/|$)/i)?.[1] || null;
  }

  function parseTime(text) {
    const value = text.trim();
    if (!TIME_RE.test(value)) return null;
    const fields = value.replaceAll('：', ':').split(':').map(Number);
    return fields.reduce((total, field) => total * 60 + field, 0);
  }

  function formatTime(seconds) {
    const value = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    const remainder = String(value % 60).padStart(2, '0');
    return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${remainder}` : `${minutes}:${remainder}`;
  }

  function seekTarget(seconds) {
    return Math.max(0, Math.floor(seconds) - 1);
  }

  function getPages(bvid) {
    if (pageCache.has(bvid)) return pageCache.get(bvid);
    const request = new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
        timeout: 12000,
        onload(response) {
          try {
            if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
            const result = JSON.parse(response.responseText);
            if (result.code !== 0 || !Array.isArray(result.data?.pages)) {
              throw new Error(result.message || '分P数据不可用');
            }
            const pages = result.data.pages
              .map(item => ({
                page: Number(item.page),
                title: String(item.part || ''),
                duration: Number(item.duration) || 0,
                cid: Number(item.cid) || 0,
              }))
              .filter(item => Number.isInteger(item.page) && item.page > 0);
            if (!pages.length) throw new Error('没有找到分P');
            resolve(pages);
          } catch (error) {
            reject(error);
          }
        },
        onerror: () => reject(new Error('网络请求失败')),
        ontimeout: () => reject(new Error('网络请求超时')),
      });
    });
    pageCache.set(bvid, request);
    request.catch(() => pageCache.delete(bvid));
    return request;
  }

  function findClickedTime(event) {
    if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
    const path = event.composedPath();
    const inComments = path.some(node => node instanceof Element &&
      (node.localName === 'bili-comments' || node.id === 'commentapp'));
    if (!inComments) return null;

    // 新版评论位于多层开放的 Shadow DOM 中；composedPath 能取得实际点击的链接。
    const richTextIndex = path.findIndex(node => node instanceof Element && node.localName === 'bili-rich-text');
    const searchEnd = richTextIndex >= 0 ? richTextIndex : path.length;
    for (let index = 0; index < searchEnd; index++) {
      const node = path[index];
      if (!(node instanceof Element)) continue;
      if (!node.matches('a, button, [role="link"], [data-type="time"], span, em')) continue;
      const label = node.textContent?.trim() || '';
      const seconds = parseTime(label);
      if (seconds !== null) return { label, seconds };
    }
    // 有些评论用全角冒号，网站没有把它做成链接；单一时间的评论正文也可点击。
    if (richTextIndex >= 0 && !path.slice(0, richTextIndex).some(node =>
      node instanceof Element && node.matches('a, button, [role="link"]'))) {
      const richText = path[richTextIndex];
      const content = richText.shadowRoot?.querySelector('#contents') || richText;
      const matches = [...(content.textContent || '').matchAll(/(?<!\d)\d{1,3}[:：][0-5]\d(?:[:：][0-5]\d)?(?!\d)/g)];
      if (matches.length === 1) {
        return { label: matches[0][0], seconds: parseTime(matches[0][0]) };
      }
    }
    return null;
  }

  function closePanel() {
    if (!activePanel) return;
    activePanel.remove();
    activePanel = null;
  }

  function navigateToPart(bvid, page, seconds, wasPlaying = !getPlayerVideo()?.paused) {
    let saved = false;
    try {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify({
        bvid, page, seconds: seekTarget(seconds), requested: seconds, wasPlaying, created: Date.now(),
      }));
      saved = true;
    } catch { /* Use B站's time parameter if session storage is unavailable. */ }
    const url = new URL(`https://www.bilibili.com/video/${bvid}/`);
    url.searchParams.set('p', String(page));
    if (!saved) url.searchParams.set('t', String(seekTarget(seconds)));
    location.assign(url.href);
  }

  function getPlayerVideo() {
    return document.querySelector('.bpx-player-video-wrap video, #bilibili-player video, video');
  }

  function getCurrentPage(bvid) {
    const fromUrl = Number(new URL(location.href).searchParams.get('p'));
    if (Number.isInteger(fromUrl) && fromUrl > 0) return fromUrl;
    const entries = document.querySelectorAll(`.video-pod__item[data-key="${bvid}"] .page-list .page-item`);
    const active = [...entries].findIndex(entry => entry.classList.contains('active'));
    return active >= 0 ? active + 1 : 1;
  }

  function getManifestCid() {
    try {
      return Number(typeof unsafeWindow !== 'undefined' && unsafeWindow.player?.getManifest?.()?.cid) || 0;
    } catch { return 0; }
  }

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  function pauseVideo(video) {
    if (!video || video.paused) return;
    try { video.pause(); } catch { /* Continue waiting for the player. */ }
  }

  async function seekAfterReady(video, seconds) {
    const started = Date.now();
    let stableSince = 0;
    let lastAttempt = 0;
    while (Date.now() - started < 15000) {
      if (getPlayerVideo() !== video) return false;
      pauseVideo(video);
      if (video.readyState < 3) {
        await wait(80);
        continue;
      }
      if (!video.seeking && Math.abs(video.currentTime - seconds) <= 0.75) {
        if (!stableSince) stableSince = Date.now();
        if (Date.now() - stableSince >= 350) return true;
      } else {
        stableSince = 0;
        if (Date.now() - lastAttempt >= 500) {
          lastAttempt = Date.now();
          try { video.currentTime = seconds; } catch { /* Try the player API below. */ }
          if (Math.abs(video.currentTime - seconds) > 0.75) {
            try { unsafeWindow.player?.seek?.(seconds); } catch { /* Retry the video element. */ }
          }
        }
      }
      await wait(80);
    }
    return false;
  }

  async function finishJump(video, wasPlaying) {
    try { sessionStorage.removeItem(PENDING_KEY); } catch { /* Ignore storage failure. */ }
    closePanel();
    document.querySelector('#bilibili-player, .bpx-player-container')?.scrollIntoView({ behavior: 'smooth' });

    if (wasPlaying) {
      try { await video.play(); } catch {
        try { unsafeWindow.player?.play?.(); } catch { /* The user can resume manually. */ }
      }
    }
  }

  async function selectPartFast(bvid, part, seconds) {
    if (switching) return;
    switching = true;
    const page = part.page;
    const started = Date.now();
    const beforeVideo = getPlayerVideo();
    const wasPlaying = Boolean(beforeVideo && !beforeVideo.paused);

    const sub = activePanel?.shadowRoot?.querySelector('.sub');
    if (sub) sub.textContent = `正在切换到 P${page}，等待视频就绪…`;
    activePanel?.shadowRoot?.querySelectorAll('.item').forEach(button => { button.disabled = true; });
    try {
      pauseVideo(beforeVideo);
      if (getCurrentPage(bvid) === page) {
        if (beforeVideo && await seekAfterReady(beforeVideo, seekTarget(seconds))) {
          await finishJump(beforeVideo, wasPlaying);
          return;
        }

        navigateToPart(bvid, page, seconds, wasPlaying);
        return;
      }

      const entries = document.querySelectorAll(`.video-pod__item[data-key="${bvid}"] .page-list .page-item`);
      const target = entries[page - 1];
      if (!target) {
        navigateToPart(bvid, page, seconds, wasPlaying);
        return;
      }
      const previousSource = beforeVideo?.currentSrc || '';
      const previousDuration = Number(beforeVideo?.duration) || 0;
      let pendingSaved = false;
      try {
        sessionStorage.setItem(PENDING_KEY, JSON.stringify({
          bvid, page, seconds: seekTarget(seconds), requested: seconds, wasPlaying, created: Date.now(),
        }));
        pendingSaved = true;
      } catch { /* Fall back to a URL that carries the time. */ }
      if (!pendingSaved) {
        navigateToPart(bvid, page, seconds, wasPlaying);
        return;
      }
      (target.querySelector('.title-txt') || target).click();

      let pageObserved = false;
      let readyVideo = null;
      let readySince = 0;
      while (Date.now() - started < 20000) {
        await wait(70);
        if (getBvid() !== bvid) return;
        const elapsed = Date.now() - started;
        const video = getPlayerVideo();
        pauseVideo(video);
        if (getCurrentPage(bvid) === page || target.classList.contains('active')) pageObserved = true;
        if (!pageObserved && elapsed > 3000) break;
        if (!pageObserved || !video || video.readyState < 3) continue;
        const currentSource = video.currentSrc || '';
        const sourceChanged = video !== beforeVideo || Boolean(currentSource && currentSource !== previousSource);
        const durationMatch = part.duration > 0 && Number.isFinite(video.duration) && Math.abs(video.duration - part.duration) <= 3;
        const previousDurationMatch = part.duration > 0 && Math.abs(previousDuration - part.duration) <= 3;
        const cidMatch = part.cid > 0 && getManifestCid() === part.cid;
        const mediaReady = (durationMatch && (!previousDurationMatch || sourceChanged)) ||
          (sourceChanged && (cidMatch || durationMatch)) ||
          (cidMatch && elapsed > 600 && (sourceChanged || durationMatch));
        if (!mediaReady) continue;
        if (readyVideo !== video) { readyVideo = video; readySince = Date.now(); }
        if (Date.now() - readySince < 200) continue;
        if (!await seekAfterReady(video, seekTarget(seconds))) {
          if (getPlayerVideo() !== video) { readyVideo = null; continue; }
          break;
        }
        await finishJump(video, wasPlaying);
        return;
      }
      navigateToPart(bvid, page, seconds, wasPlaying);
    } catch {
      navigateToPart(bvid, page, seconds, wasPlaying);
    } finally {
      switching = false;
    }
  }

  function seekSinglePart(seconds) {
    void selectPartFast(getBvid(), { page: 1 }, seconds);
  }

  function showPanel(bvid, label, seconds) {
    closePanel();
    const host = document.createElement('div');
    host.id = PANEL_ID;
    host.style.cssText = 'position:fixed;right:12px;top:72px;width:min(340px,calc(100vw - 24px));z-index:2147483647;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        * { box-sizing: border-box; }
        .panel { width: 100%; max-height: min(70vh, 620px); display: flex; flex-direction: column;
          overflow: hidden; background: #fff; color: #18191c; border: 1px solid #d8dadd;
          border-radius: 12px; box-shadow: 0 8px 28px #0003; font: 14px/1.45 Arial, sans-serif; }
        .head { padding: 13px 14px 10px; display: flex; align-items: start; gap: 8px; border-bottom: 1px solid #eee; }
        .title { flex: 1; min-width: 0; font-weight: 700; }
        .sub { margin-top: 2px; color: #61666d; font-size: 12px; font-weight: 400; }
        button { font: inherit; }
        .close { border: 0; background: transparent; color: #61666d; cursor: pointer; font-size: 20px; line-height: 1; }
        .close:hover { color: #18191c; }
        .search { margin: 10px 12px 8px; width: calc(100% - 24px); padding: 8px 10px;
          border: 1px solid #d8dadd; border-radius: 7px; font: inherit; outline-color: #00aeec; }
        .search[hidden] { display: none; }
        .list { overflow: auto; padding: 0 8px 8px; }
        .item { width: 100%; display: flex; align-items: center; gap: 9px; text-align: left;
          border: 0; border-radius: 8px; padding: 9px 7px; color: inherit; background: transparent; cursor: pointer; }
        .item:hover:not(:disabled), .item:focus-visible { background: #e7f7fd; outline: none; }
        .item:disabled { opacity: .48; cursor: not-allowed; }
        .badge { flex: none; min-width: 36px; padding: 3px 5px; border-radius: 5px;
          background: #e7f7fd; color: #0086b3; font-weight: 700; text-align: center; font-size: 12px; }
        .details { flex: 1; min-width: 0; }
        .name { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .duration { display: block; font-size: 12px; color: #9499a0; }
        .status { padding: 14px 12px; color: #61666d; }
        .foot { padding: 9px 12px; border-top: 1px solid #eee; color: #9499a0; font-size: 12px; }
      </style>
      <section class="panel" role="dialog" aria-label="选择跳转分P">
        <div class="head"><div class="title">跳转到 <span class="target"></span>
          <div class="sub">选择分P，在该分P内跳到这个时间</div></div>
          <button class="close" type="button" aria-label="关闭">×</button></div>
        <input class="search" type="search" placeholder="搜索分P编号或标题" aria-label="搜索分P">
        <div class="list"><div class="status">正在读取分P…</div></div>
        <div class="foot">新分P可播放后跳转到目标前 1 秒；超出时长的分P不可选</div>
      </section>`;
    root.querySelector('.target').textContent = label.replaceAll('：', ':');
    root.querySelector('.close').addEventListener('click', closePanel);
    document.documentElement.appendChild(host);
    activePanel = host;

    const list = root.querySelector('.list');
    const search = root.querySelector('.search');
    let pages = [];
    function render() {
      list.replaceChildren();
      const query = search.value.trim().toLowerCase();
      const matches = pages.filter(item => `p${item.page} ${item.page} ${item.title}`.toLowerCase().includes(query));
      if (!matches.length) {
        const empty = document.createElement('div');
        empty.className = 'status';
        empty.textContent = '没有匹配的分P';
        list.appendChild(empty);
        return;
      }
      for (const item of matches) {
        const button = document.createElement('button');
        button.className = 'item';
        button.type = 'button';
        button.disabled = item.duration > 0 && seconds >= item.duration;
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = `P${item.page}`;
        const details = document.createElement('span');
        details.className = 'details';
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = item.title || `第 ${item.page} P`;
        const duration = document.createElement('span');
        duration.className = 'duration';
        duration.textContent = `时长 ${formatTime(item.duration)}${button.disabled ? ' · 时间超出范围' : ''}`;
        details.append(name, duration);
        button.append(badge, details);
        button.addEventListener('click', () => selectPartFast(bvid, item, seconds));
        list.appendChild(button);
      }
    }
    search.addEventListener('input', render);
    getPages(bvid).then(result => {
      if (activePanel !== host) return;
      if (result.length === 1) {
        closePanel();
        seekSinglePart(seconds);
        return;
      }
      pages = result;
      search.hidden = pages.length <= 8;
      render();
    }).catch(error => {
      if (activePanel !== host) return;
      list.replaceChildren();
      const message = document.createElement('div');
      message.className = 'status';
      message.textContent = `读取失败：${error.message}。请稍后再点一次时间。`;
      list.appendChild(message);
    });
  }

  document.addEventListener('click', event => {
    const bvid = getBvid();
    if (!bvid) return;
    const clicked = findClickedTime(event);
    if (!clicked) return;
    // 单P视频保留B站原有的时间跳转行为。
    if (singlePageBvids.has(bvid)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showPanel(bvid, clicked.label, clicked.seconds);
  }, true);

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closePanel();
  }, true);

  async function applyPendingSeek() {
    let pending;
    try { pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null'); } catch { return; }
    if (!pending || Date.now() - pending.created > 45000 || !Number.isFinite(pending.seconds)) {
      try { sessionStorage.removeItem(PENDING_KEY); } catch { /* Ignore storage failure. */ }
      return;
    }
    if (pending.bvid !== getBvid() || Number(new URL(location.href).searchParams.get('p') || 1) !== pending.page) {
      try { sessionStorage.removeItem(PENDING_KEY); } catch { /* Ignore storage failure. */ }
      return;
    }
    const started = Date.now();
    while (Date.now() - started < 30000) {
      const video = getPlayerVideo();
      pauseVideo(video);
      const pageLoaded = document.readyState === 'complete' || Date.now() - started >= 5000;
      if (pageLoaded && video?.readyState >= 3) {
        if (await seekAfterReady(video, pending.seconds)) {
          await finishJump(video, Boolean(pending.wasPlaying));
          return;
        }
      }
      await wait(80);
    }
    try { sessionStorage.removeItem(PENDING_KEY); } catch { /* Ignore storage failure. */ }
  }

  const bvid = getBvid();
  if (bvid) {
    getPages(bvid).then(pages => {
      if (pages.length === 1) singlePageBvids.add(bvid);
    }).catch(() => {});
    applyPendingSeek();
  }
})();
