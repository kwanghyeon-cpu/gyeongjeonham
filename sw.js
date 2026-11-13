/* 경전함 오프라인 캐시: 한 번 열면 인터넷 없이도 읽을 수 있다. 배포할 때 VERSION이 바뀌어 새 캐시를 받는다. */
const VERSION = '20261113135930';
const FILES = ["./","app.css?v=20261113135930","app.js?v=20261113135930","audio/index.json","fonts/OFL.txt","fonts/gowun-batang-bold.woff2","fonts/gowun-batang-regular.woff2","icons/icon-192.png","icons/icon-512.png","index.html","lunar-months.json","manifest.webmanifest","privacy.html","sutras/amitabha-sutra.json","sutras/baekpal-chamhoe.json","sutras/balsim-suhaeng-jang.json","sutras/beopseong-ge.json","sutras/bohyeon-haengwon.json","sutras/bumo-eunjung.json","sutras/cheonsu-gyeong.json","sutras/dhammapada.json","sutras/diamond-sutra.json","sutras/gwaneum-gyeong.json","sutras/gyechosim-hagin-mun.json","sutras/heart-sutra.json","sutras/index.json","sutras/isan-balwon.json","sutras/jagyeong-mun.json","sutras/jeungdo-ga.json","sutras/jijang-gyeong.json","sutras/metta-sutta.json","sutras/musang-gye.json","sutras/sinsim-myeong.json","sutras/suttanipata.json","sutras/uranbun-gyeong.json","sutras/yakchan-ge.json","sutras/yaksa-gyeong.json","sutras/yebul-mun.json","sutras/yeorae-suryang.json"];
const CACHE = 'gyeongjeonham-' + VERSION;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  const isAudio = new URL(e.request.url).pathname.endsWith('.mp3');
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(e.request).then((res) => {
        // 독송 음원은 미리 받지 않고, 한 번 들은 것만 저장해 다음부터 인터넷 없이 듣는다.
        if (isAudio && res.ok && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      });
    }),
  );
});
