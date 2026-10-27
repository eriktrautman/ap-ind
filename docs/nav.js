// Shared top navigation for the non-broadcast pages (index, docs). The docs are served at the
// root by the app (Vercel or npm start); under /docs/ when opened from the repo. Broadcast
// graphics never include this.
(() => {
  const onDocs = location.pathname.startsWith("/docs/");
  const local = onDocs || ["localhost", "127.0.0.1"].includes(location.hostname);
  const docs = onDocs ? "/docs/" : local ? "/docs/" : "/";
  const links = [
    ["Home", local ? "/" : "/"],
    ["Spec", docs + "spec.html"],
    ["Graphics data options", docs + "graphics-data-options.html"],
    ["Watch Party design", docs + "watch-party.html"],
  ];
  links.push(["Control room", "/studio"], ["Ticker", "/ticker?bg=black"], ["Build plan", docs + "producer-plan.html"]);
  if (!local) links.push(["GitHub", "https://github.com/eriktrautman/ap-ind"]);

  const here = location.pathname.replace(/\/$/, "/index.html");
  const style = document.createElement("style");
  style.textContent = `
    .apnav { background: #071222; color: #c7cfdf; font: 13px Arial, Helvetica, sans-serif; padding: 0 24px; display: flex; align-items: center; gap: 18px; height: 40px; }
    .apnav .brand { color: #d4af37; font-family: Georgia, serif; font-size: 16px; text-decoration: none; margin-right: 6px; letter-spacing: .02em; }
    .apnav a { color: #c7cfdf; text-decoration: none; white-space: nowrap; }
    .apnav a:hover { color: #fff; text-decoration: underline; }
    .apnav a.here { color: #fff; font-weight: 700; }
    .apnav .env { margin-left: auto; font-size: 11px; color: #6f7d99; letter-spacing: .06em; text-transform: uppercase; }
    @media (max-width: 640px) { .apnav { height: auto; flex-wrap: wrap; padding: 8px 16px; gap: 8px 14px; } .apnav .env { display: none; } }
  `;
  document.head.appendChild(style);
  const nav = document.createElement("nav");
  nav.className = "apnav";
  nav.innerHTML = `<a class="brand" href="/">ap-ind</a>` +
    links.map(([label, href]) => `<a href="${href}" class="${href.split("?")[0] === here ? "here" : ""}">${label}</a>`).join("") +
    `<span class="env">${local ? "local" : location.host}</span>`;
  document.body.insertBefore(nav, document.body.firstChild);
})();
