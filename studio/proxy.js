// Routing Middleware (vercel.json "proxy", matched on /studio and everything under it): the Studio's page and
// scripts are served only to a browser with a valid Studio cookie. Any other browser is sent to the sign-in page,
// so nothing of the Studio is on screen, in view-source or in the network log before signing in. The sign-in page
// and the stylesheet are open to everyone; the APIs check the cookie themselves (lib/auth.js), and the outputs
// (/ticker, /live-screen-*, /g/) stay public by design. scripts/serve.mjs applies the same rule on a laptop.
import { next } from "@vercel/functions";
import { cookieAccount } from "./lib/auth.js";

const OPEN = new Set(["/studio/login", "/studio/login.html", "/studio/studio.css"]);

/** True when this path is the Studio and the Cookie header does not sign it in: send the browser to /studio/login. */
export function studioGate(pathname, cookieHeader) {
  if (!/^\/studio(\/|$)/.test(pathname) || OPEN.has(pathname)) return false;
  return !cookieAccount(cookieHeader);
}

export default function proxy(request) {
  const url = new URL(request.url);
  if (!studioGate(url.pathname, request.headers.get("cookie"))) return next();
  return new Response(null, { status: 302, headers: { Location: "/studio/login", "Cache-Control": "no-store" } });
}
