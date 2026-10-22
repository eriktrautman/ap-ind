// Shared top navigation for the non-broadcast pages (index, docs, candidate index).
// Works in both deployments: locally the docs live under /docs/ beside the live pages;
// on Vercel only the docs exist, at the root. Broadcast graphics never include this.
(() => {
  const onDocs = location.pathname.startsWith("/docs/");
  const local = onDocs || ["localhost", "127.0.0.1"].includes(location.hostname);
  const docs = onDocs ? "/docs/" : local ? "/docs/" : "/";
  const links = [
    ["Home", local ? "/" : "/"],
    ["Spec", docs + "spec.html"],
    ["Graphics data options", docs + "graphics-data-options.html"],
  ];
  if (local) links.push(["Candidate index", "/candidates.html"], ["Photos", "/photos.html"], ["Ticker", "/g/ticker.html?bg=black"], ["Race chart", "/g/race.html?id=28594&bg=black"]);
  else links.push(["GitHub", "https://github.com/eriktrautman/ap-ind"]);

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
    `<span class="env">${local ? "local · live data" : "docs site"}</span>`;
  document.body.insertBefore(nav, document.body.firstChild);
})();
