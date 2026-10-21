const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const file = path.join(__dirname, '..', 'bilibili-comment-part-seek.user.js');
const original = fs.readFileSync(file, 'utf8');
const end = original.lastIndexOf('})();');
assert(end > 0);
const source = original.slice(0, end) +
  'globalThis.__test = { parseTime, seekTarget, selectPartFast, navigateToPart };\n' +
  original.slice(end);
const bvid = 'BV1P7j36EEUr';

function makeVideo({ duration, cid, src, readyState = 3, paused = false }) {
  return {
    currentTime: 0, duration, cid, currentSrc: src, readyState, paused, seeking: false,
    pause() { this.paused = true; },
    async play() { this.paused = false; this.playedAt = this.currentTime; },
  };
}

function makeContext({ page = 1, pending, readyState = 'complete' } = {}) {
  const storage = new Map();
  if (pending) storage.set('bili-comment-part-seek-pending', JSON.stringify(pending));
  let currentVideo = makeVideo({ duration: page === 1 ? 587 : 10608, cid: page, src: `blob:${page}` });
  const oldVideo = currentVideo;
  const entries = [
    { classList: { contains: () => false } },
    {
      classList: { contains: () => false },
      querySelector() { return null; },
      click() {
        assert.equal(oldVideo.paused, true, 'old part is paused before switching');
        context.location.href = `https://www.bilibili.com/video/${bvid}/?p=2`;
        currentVideo = makeVideo({ duration: 10608, cid: 2, src: 'blob:2', readyState: 0 });
        setTimeout(() => { currentVideo.readyState = 3; }, 120);
      },
    },
  ];
  const document = {
    readyState,
    addEventListener() {},
    querySelector(selector) {
      if (selector.includes('video')) return currentVideo;
      if (selector.includes('bilibili-player')) return { scrollIntoView() {} };
      return null;
    },
    querySelectorAll() { return entries; },
  };
  const context = {
    URL, setTimeout, document,
    location: {
      pathname: `/video/${bvid}/`,
      href: `https://www.bilibili.com/video/${bvid}/?p=${page}`,
      assign(url) { this.assigned = url; },
    },
    sessionStorage: {
      getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) { storage.set(key, value); },
      removeItem(key) { storage.delete(key); },
    },
    unsafeWindow: { player: { getManifest: () => ({ cid: currentVideo.cid }) } },
    GM_xmlhttpRequest(options) {
      options.onload({ status: 200, responseText: JSON.stringify({
        code: 0, data: { pages: [
          { page: 1, part: 'P1', duration: 587, cid: 1 },
          { page: 2, part: 'P2', duration: 10608, cid: 2 },
        ] },
      }) });
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { context, document, storage, oldVideo, getVideo: () => currentVideo };
}

test('parses timestamps and targets one second earlier', () => {
  const { context } = makeContext();
  assert.equal(context.__test.parseTime('16:15'), 975);
  assert.equal(context.__test.seekTarget(975), 974);
  assert.equal(context.__test.seekTarget(0), 0);
});

test('pauses during the native part switch, seeks after readiness, then resumes', async () => {
  const fixture = makeContext();
  await fixture.context.__test.selectPartFast(bvid, { page: 2, duration: 10608, cid: 2 }, 975);
  const video = fixture.getVideo();
  assert.equal(video.currentTime, 974);
  assert.equal(video.playedAt, 974);
  assert.equal(video.paused, false);
  assert.equal(fixture.storage.has('bili-comment-part-seek-pending'), false);
});

test('keeps the selected part paused when playback was paused before switching', async () => {
  const fixture = makeContext();
  fixture.oldVideo.pause();
  await fixture.context.__test.selectPartFast(bvid, { page: 2, duration: 10608, cid: 2 }, 975);
  const video = fixture.getVideo();
  assert.equal(video.currentTime, 974);
  assert.equal(video.paused, true);
  assert.equal(video.playedAt, undefined);
});

test('full-page fallback stores the seek and URL without an early time parameter', () => {
  const { context, storage } = makeContext();
  context.__test.navigateToPart(bvid, 2, 975, true);
  const pending = JSON.parse(storage.get('bili-comment-part-seek-pending'));
  assert.equal(pending.seconds, 974);
  assert.equal(pending.wasPlaying, true);
  const url = new URL(context.location.assigned);
  assert.equal(url.searchParams.get('p'), '2');
  assert.equal(url.searchParams.has('t'), false);
});

test('URL carries the time when session storage is unavailable', () => {
  const { context } = makeContext();
  context.sessionStorage.setItem = () => { throw new Error('storage blocked'); };
  context.__test.navigateToPart(bvid, 2, 975, true);
  const url = new URL(context.location.assigned);
  assert.equal(url.searchParams.get('p'), '2');
  assert.equal(url.searchParams.get('t'), '974');
});

test('pending seek waits for page readiness before resuming', async () => {
  const fixture = makeContext({
    page: 2,
    readyState: 'loading',
    pending: { bvid, page: 2, seconds: 974, requested: 975, wasPlaying: true, created: Date.now() },
  });
  fixture.getVideo().currentTime = 0;
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(fixture.getVideo().paused, true);
  fixture.document.readyState = 'complete';
  await new Promise(resolve => setTimeout(resolve, 650));
  assert.equal(fixture.getVideo().currentTime, 974);
  assert.equal(fixture.getVideo().playedAt, 974);
});
