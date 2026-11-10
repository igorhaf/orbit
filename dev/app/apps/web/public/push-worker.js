/* Minimal Web Push worker shared by Orbit products. Keep notification targets same-origin. */
self.addEventListener("push", (event) => {
  let message = {};
  try { message = event.data ? event.data.json() : {}; }
  catch { message = { body: event.data ? event.data.text() : "Você tem uma nova notificação." }; }
  const title = typeof message.title === "string" && message.title.trim() ? message.title.slice(0, 120) : "Orbit";
  const body = typeof message.body === "string" ? message.body.slice(0, 500) : "Você tem uma nova notificação.";
  const target = typeof message.target_url === "string" ? message.target_url : typeof message.url === "string" ? message.url : "/";
  let url = "/";
  try {
    const parsed = new URL(target, self.location.origin);
    if (parsed.origin === self.location.origin) url = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch { /* Use the application home page for malformed targets. */ }
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: "/brand-orbit.svg",
    data: { url },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data && typeof event.notification.data.url === "string"
    ? event.notification.data.url
    : "/";
  let url = new URL("/", self.location.origin);
  try {
    const parsed = new URL(target, self.location.origin);
    if (parsed.origin === self.location.origin) url = parsed;
  } catch { /* Keep the same-origin home page. */ }
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    for (const client of clients) {
      if (new URL(client.url).origin === self.location.origin && "focus" in client) {
        return client.navigate(url.href).then((navigated) => navigated ? navigated.focus() : client.focus());
      }
    }
    return self.clients.openWindow(url.href);
  }));
});
