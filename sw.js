importScripts('/scram/scramjet.all.js');

const { ScramjetServiceWorker } = window.$scramjetLoadWorker();

const sw = new ScramjetServiceWorker();

async function handleFetch(event) {
  await sw.loadConfig();
  if (sw.route(event)) {
    return sw.fetch(event);
  }
  return fetch(event.request);
}

self.addEventListener('fetch', (event) => {
  event.respondWith(handleFetch(event));
});
