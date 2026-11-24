"use strict";
/* Logins. Everyone has their own account (email + password, plus the team code once when signing up), and their
   projects and linked social media accounts belong to that account. The accounts live in Supabase; this file
   talks to it directly over its HTTP API (no library needed):
     /auth/v1/...  sign up, log in, refresh, log out
     /rest/v1/...  the user's own rows (row-level security in the database makes sure nobody sees anyone else's)
   "Remember me" keeps the login in this browser (localStorage); without it the login ends when the browser
   closes (sessionStorage). The login token is refreshed in the background a minute before it runs out.

   When the server has no accounts set up (a copy running on your own computer) the studio asks for the old
   shared passcode instead, in the same window.

   Loaded first: backend.js and everything after it waits for SLSAuth.ready. */
window.SLSAuth = (() => {
  const FALLBACK = { url: "https://lmkqtxgueubtaojadqtr.supabase.co", key: "sb_publishable_L-Q3p87GLtyC7DMC3PdKsg_coipSeDR" };
  const SKEY = "sls-session", RKEY = "sls-remember", PKEY = "sls-pass";
  const ls = { get(k){ try { return localStorage.getItem(k); } catch { return null; } }, set(k, v){ try { localStorage.setItem(k, v); } catch {} }, del(k){ try { localStorage.removeItem(k); } catch {} } };
  const ss = { get(k){ try { return sessionStorage.getItem(k); } catch { return null; } }, set(k, v){ try { sessionStorage.setItem(k, v); } catch {} }, del(k){ try { sessionStorage.removeItem(k); } catch {} } };
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let cfg = null, mode = "accounts", session = null, refreshTimer = null, readyResolve, gateOpen = false;
  const listeners = new Set();
  const ready = new Promise(r => { readyResolve = r; });

  /* ---------- the session ---------- */
  function loadSession(){
    const raw = ls.get(SKEY) || ss.get(SKEY);
    try { const s = raw ? JSON.parse(raw) : null; return s && s.access_token && s.refresh_token && s.user ? s : null; } catch { return null; }
  }
  function storeSession(s, remember){
    session = s; ls.del(SKEY); ss.del(SKEY);
    if(s){ (remember ? ls : ss).set(SKEY, JSON.stringify(s)); ls.set(RKEY, remember ? "1" : "0"); }
    clearTimeout(refreshTimer);
    if(s){ const ms = Math.max(5000, s.expires_at * 1000 - Date.now() - 60000); refreshTimer = setTimeout(() => refresh().catch(() => {}), ms); }
  }
  const remembered = () => ls.get(RKEY) !== "0";
  const fromAuth = d => ({ access_token: d.access_token, refresh_token: d.refresh_token, expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600),
    user: { id: d.user.id, email: d.user.email, name: (d.user.user_metadata && d.user.user_metadata.name) || "" } });

  async function gotrue(path, body, token){
    let r;
    try { r = await fetch(cfg.url + "/auth/v1" + path, { method: "POST", headers: { apikey: cfg.key, "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: JSON.stringify(body || {}) }); }
    catch { throw Object.assign(new Error("Can't reach the login server. Check the internet connection."), { code: "offline" }); }
    const d = await r.json().catch(() => ({}));
    if(!r.ok) throw Object.assign(new Error(nice(d, r.status)), { code: d.error_code || d.code || "auth_" + r.status, status: r.status });
    return d;
  }
  function nice(d, status){
    const m = String(d.msg || d.message || d.error_description || d.error || "");
    if(/wrong_team_code/i.test(m)) return "That team code isn't right. Ask Stellar Music for it.";
    if(/invalid login credentials|invalid_grant/i.test(m) || d.error_code === "invalid_credentials") return "Wrong email or password.";
    if(/already (registered|exists)/i.test(m) || d.error_code === "user_already_exists") return "There's already an account with that email. Log in instead.";
    if(/password/i.test(m) && /(short|weak|characters|at least)/i.test(m)) return "Pick a longer password (at least 8 characters).";
    if(/valid email|email address/i.test(m) && /invalid/i.test(m)) return "That doesn't look like an email address.";
    if(status === 429 || /rate limit|too many/i.test(m)) return "Too many tries. Wait a minute and try again.";
    if(/signups? not allowed|disabled/i.test(m)) return "New accounts can't be made right now.";
    return m || "Something went wrong (" + status + ").";
  }
  let refreshing = null;
  function refresh(){
    if(refreshing) return refreshing;
    refreshing = (async () => {
      const s = session || loadSession(); if(!s) throw new Error("Not logged in");
      try { const d = await gotrue("/token?grant_type=refresh_token", { refresh_token: s.refresh_token }); storeSession(fromAuth(d), remembered()); emit(); return session; }
      catch(err){ if(err.status >= 400 && err.status < 500){ storeSession(null); emit(); requireLogin("Your login has run out. Log in again."); } throw err; }
      finally { refreshing = null; }
    })();
    return refreshing;
  }
  async function token(){
    if(mode === "passcode") return ls.get(PKEY) || "";
    if(!session) return "";
    if(session.expires_at * 1000 - Date.now() < 45000){ try { await refresh(); } catch {} }
    return session ? session.access_token : "";
  }
  const tokenSync = () => mode === "passcode" ? (ls.get(PKEY) || "") : session ? session.access_token : "";
  function emit(){ listeners.forEach(fn => { try { fn(user()); } catch(err){ console.error(err); } }); paintMenus(); }
  const user = () => mode === "passcode" ? (ls.get(PKEY) ? { id: "", email: "", name: "Team" } : null) : session ? session.user : null;

  async function signIn(email, password, remember){
    const d = await gotrue("/token?grant_type=password", { email: email.trim(), password });
    storeSession(fromAuth(d), remember); emit(); return user();
  }
  async function signUp(name, email, password, code, remember){
    const d = await gotrue("/signup", { email: email.trim(), password, data: { name: name.trim().slice(0, 80), team_code: code.trim() } });
    if(!d.access_token) throw Object.assign(new Error("The account was made, but it needs to be confirmed by email first."), { code: "confirm" });
    storeSession(fromAuth(d), remember); emit(); return user();
  }
  async function signOut(){
    if(mode === "passcode"){ ls.del(PKEY); location.reload(); return; }
    const t = session && session.access_token;
    storeSession(null);
    try { if(t) await gotrue("/logout?scope=local", {}, t); } catch {}
    try { sessionStorage.removeItem("sls-open"); } catch {}
    location.reload();
  }

  /* ---------- the user's own rows ---------- */
  async function rest(path, { method = "GET", body, prefer } = {}){
    if(mode !== "accounts" || !session) throw Object.assign(new Error("Not logged in"), { code: "unauthorized" });
    const go = async () => fetch(cfg.url + "/rest/v1/" + path, { method, headers: { apikey: cfg.key, authorization: "Bearer " + await token(), ...(body != null ? { "content-type": "application/json" } : {}), ...(prefer ? { prefer } : {}) }, body: body != null ? JSON.stringify(body) : undefined });
    let r = await go();
    if(r.status === 401){ await refresh().catch(() => {}); r = await go(); }
    if(!r.ok){ const d = await r.json().catch(() => ({})); throw Object.assign(new Error(d.message || "The cloud save failed (" + r.status + ")."), { code: d.code || "rest_" + r.status, status: r.status }); }
    return r.status === 204 ? null : r.json().catch(() => null);
  }

  /* ---------- linked social media accounts, per user ----------
     Kept in the user's account (table social_accounts) with a copy in this browser so the posting window opens
     instantly. "sealed" is readable only by the studio server. */
  const accounts = (() => {
    let list = [];
    const ckey = () => "sls-accounts:" + ((user() && user().id) || "team");
    const cache = () => ls.set(ckey(), JSON.stringify(list));
    const toRow = a => ({ id: a.id, platform: a.platform, name: String(a.name || "").slice(0, 200), avatar: String(a.avatar || "").slice(0, 2000), artist: String(a.label || "").slice(0, 120), sealed: a.sealed, updated_at: new Date().toISOString() });
    const fromRow = r => ({ id: r.id, platform: r.platform, name: r.name, avatar: r.avatar, label: r.artist, sealed: r.sealed });
    function init(){
      try { list = JSON.parse(ls.get(ckey()) || "[]") || []; } catch { list = []; }
      // linked from a login window that couldn't reach this one
      adoptNew();
      if(mode === "accounts") rest("social_accounts?select=id,platform,name,avatar,artist,sealed&order=updated_at.asc").then(rows => {
        const cloud = (rows || []).map(fromRow), ids = new Set(cloud.map(a => a.id));
        const localOnly = list.filter(a => !ids.has(a.id));
        list = [...cloud, ...localOnly]; cache();
        localOnly.forEach(a => rest("social_accounts", { method: "POST", body: toRow(a), prefer: "resolution=merge-duplicates" }).catch(() => {}));
        window.dispatchEvent(new Event("sls-accounts"));
      }).catch(err => console.warn("couldn't load linked accounts", err));
    }
    function adoptNew(){
      let q = []; try { q = JSON.parse(ls.get("sls-account-new") || "[]") || []; } catch {}
      if(!q.length) return;
      ls.del("sls-account-new");
      q.forEach(r => put(r, { keepLabel: true }));
    }
    function put(a, { keepLabel = true } = {}){
      const old = list.find(x => x.id === a.id);
      const rec = { ...(old || {}), ...a, label: keepLabel && old && old.label && !a.label ? old.label : (a.label || (old && old.label) || "") };
      list = [...list.filter(x => x.id !== a.id), rec]; cache();
      if(mode === "accounts") rest("social_accounts", { method: "POST", body: toRow(rec), prefer: "resolution=merge-duplicates" }).catch(err => console.warn("account not saved to the cloud", err));
      window.dispatchEvent(new Event("sls-accounts"));
      return rec;
    }
    function remove(id){
      list = list.filter(x => x.id !== id); cache();
      if(mode === "accounts") rest("social_accounts?id=eq." + encodeURIComponent(id), { method: "DELETE" }).catch(err => console.warn("account not removed from the cloud", err));
      window.dispatchEvent(new Event("sls-accounts"));
    }
    addEventListener("storage", e => { if(e.key === "sls-account-new" && e.newValue) adoptNew(); });
    return { init, all: () => list.slice(), put, remove, update: (id, patch) => { const a = list.find(x => x.id === id); return a ? put({ ...a, ...patch }, { keepLabel: false }) : null; }, adoptNew };
  })();

  /* ---------- the login window ---------- */
  const gate = document.createElement("div");
  gate.className = "auth-gate"; gate.id = "authGate"; gate.hidden = true;
  gate.innerHTML = `
    <div class="auth-card" role="dialog" aria-modal="true" aria-labelledby="authTitle">
      <div class="auth-brand"><span class="wordmark">SLS</span><span class="brand-sub">Stellar Lyric Studio</span></div>
      <div class="seg auth-tabs" id="authTabs" role="tablist"><button type="button" data-v="in" role="tab">Log in</button><button type="button" data-v="up" role="tab">Create account</button></div>
      <form id="authForm" autocomplete="on" novalidate>
        <h2 id="authTitle">Log in</h2>
        <p class="auth-why" id="authWhy"></p>
        <label class="auth-f" data-for="up"><span>Your name</span><input id="authName" name="name" autocomplete="name" maxlength="80"></label>
        <label class="auth-f" data-for="in up"><span>Email</span><input id="authEmail" name="email" type="email" autocomplete="username" inputmode="email" maxlength="200" required></label>
        <label class="auth-f" data-for="in up"><span>Password</span><input id="authPass" name="password" type="password" autocomplete="current-password" minlength="8" maxlength="200" required></label>
        <label class="auth-f" data-for="up"><span>Team code</span><input id="authCode" name="team-code" autocomplete="off" maxlength="120" spellcheck="false"></label>
        <label class="auth-f" data-for="pass"><span>Studio passcode</span><input id="authPasscode" type="password" autocomplete="current-password" maxlength="200"></label>
        <label class="auth-rem" data-for="in up"><input type="checkbox" id="authRemember" checked> Remember me on this computer</label>
        <div class="auth-err" id="authErr" role="alert" hidden></div>
        <button class="btn primary auth-go" type="submit" id="authGo">Log in</button>
        <p class="auth-note" id="authNote"></p>
      </form>
      <p class="auth-legal"><a href="/terms.html" target="_blank" rel="noopener">Terms</a> · <a href="/privacy.html" target="_blank" rel="noopener">Privacy</a> · Stellar Music</p>
    </div>`;
  document.body.append(gate);
  const $g = s => gate.querySelector(s);
  let tab = "in";
  function paintGate(){
    const t = mode === "passcode" ? "pass" : tab;
    $g("#authTabs").hidden = mode === "passcode";
    gate.querySelectorAll("#authTabs button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.v === tab)));
    gate.querySelectorAll("#authTabs button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === tab)));
    gate.querySelectorAll("[data-for]").forEach(el => { el.hidden = !el.dataset.for.split(" ").includes(t); });
    $g("#authTitle").textContent = t === "pass" ? "Studio passcode" : t === "up" ? "Create your account" : "Log in";
    $g("#authGo").textContent = t === "pass" ? "Unlock" : t === "up" ? "Create account" : "Log in";
    $g("#authPass").autocomplete = t === "up" ? "new-password" : "current-password";
    $g("#authNote").textContent = t === "up" ? "Your projects and linked social accounts are saved to your account, so you can pick up on any computer. The team code comes from Stellar Music." : t === "in" ? "No account yet? Choose Create account." : "";
  }
  $g("#authTabs").onclick = e => { const b = e.target.closest("button"); if(!b) return; tab = b.dataset.v; showErr(""); paintGate(); (tab === "up" ? $g("#authName") : $g("#authEmail")).focus(); };
  const showErr = t => { const e = $g("#authErr"); e.textContent = t || ""; e.hidden = !t; };
  $g("#authForm").onsubmit = async e => {
    e.preventDefault(); showErr("");
    const go = $g("#authGo"); if(go.disabled) return;
    const remember = $g("#authRemember").checked;
    try {
      go.disabled = true;
      if(mode === "passcode"){
        const v = $g("#authPasscode").value.trim(); if(!v) return showErr("Type the passcode.");
        ls.set(PKEY, v);
        const r = await fetch("/api/session", { method: "POST", headers: { authorization: "Bearer " + v } });
        if(!r.ok){ ls.del(PKEY); const d = await r.json().catch(() => ({})); return showErr(d.message || "That passcode isn't right."); }
        return done();
      }
      const email = $g("#authEmail").value.trim(), pw = $g("#authPass").value;
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showErr("Type your email address.");
      if(tab === "up"){
        const name = $g("#authName").value.trim(), code = $g("#authCode").value.trim();
        if(!name) return showErr("Type your name.");
        if(pw.length < 8) return showErr("Pick a password of at least 8 characters.");
        if(!code) return showErr("Type the team code.");
        await signUp(name, email, pw, code, remember);
      } else {
        if(!pw) return showErr("Type your password.");
        await signIn(email, pw, remember);
      }
      done();
    } catch(err){ showErr(err.message || "Something went wrong."); }
    finally { go.disabled = false; }
  };
  function done(){
    gate.hidden = true; gateOpen = false; $g("#authPass").value = ""; $g("#authPasscode").value = ""; $g("#authCode").value = "";
    document.body.classList.remove("auth-locked");
    accounts.init(); emit();
    readyResolve(user());
  }
  function requireLogin(why){
    if(gateOpen){ if(why) $g("#authWhy").textContent = why; return; }
    gateOpen = true; gate.hidden = false; document.body.classList.add("auth-locked");
    $g("#authWhy").textContent = why || ""; $g("#authWhy").hidden = !why;
    const last = ls.get("sls-last-email"); if(last && !$g("#authEmail").value) $g("#authEmail").value = last;
    paintGate(); setTimeout(() => { const f = mode === "passcode" ? $g("#authPasscode") : $g("#authEmail").value ? $g("#authPass") : $g("#authEmail"); f && f.focus(); }, 50);
  }
  listeners.add(u => { if(u && u.email) ls.set("sls-last-email", u.email); });

  /* ---------- who's logged in, in the top bars ---------- */
  function paintMenus(){
    const u = user();
    document.querySelectorAll("[data-sls-user]").forEach(el => {
      el.hidden = !u;
      if(!u) return;
      const label = u.name || (u.email || "").split("@")[0] || "Account";
      el.innerHTML = `<button class="btn ghost small acct-btn" type="button" aria-haspopup="menu" aria-expanded="false" title="${esc(u.email || "")}"><span class="acct-dot" aria-hidden="true">${esc(label.slice(0, 1).toUpperCase())}</span><span class="acct-name">${esc(label)}</span></button>
        <div class="tmenu acct-menu" role="menu" hidden><div class="acct-who"><b>${esc(label)}</b><span>${esc(u.email || (mode === "passcode" ? "Shared passcode" : ""))}</span></div><button role="menuitem" type="button" data-act="out">Log out</button></div>`;
    });
  }
  document.addEventListener("click", e => {
    const b = e.target.closest(".acct-btn");
    document.querySelectorAll(".acct-menu").forEach(m => { if(!b || m !== b.nextElementSibling){ m.hidden = true; m.previousElementSibling && m.previousElementSibling.setAttribute("aria-expanded", "false"); } });
    if(b){ const m = b.nextElementSibling; m.hidden = !m.hidden; b.setAttribute("aria-expanded", String(!m.hidden)); return; }
    const out = e.target.closest(".acct-menu [data-act=out]");
    if(out) signOut();
  });

  /* ---------- start ---------- */
  (async () => {
    let h = null;
    try { const r = await fetch("/api/health", { cache: "no-store" }); h = r.ok ? await r.json() : null; } catch {}
    if(h && h.auth && h.auth.url && h.auth.key) cfg = { url: h.auth.url, key: h.auth.key };
    else if(h && h.ok && !h.auth) mode = "passcode";
    else cfg = FALLBACK;      // server unreachable: still let people log in; the studio reports the server problem itself
    if(mode === "passcode"){
      if(ls.get(PKEY)) return done();
      return requireLogin();
    }
    session = loadSession();
    if(session){
      storeSession(session, remembered());
      if(session.expires_at * 1000 - Date.now() < 60000){ try { await refresh(); } catch { return; } }
      if(session) return done();
    }
    requireLogin();
  })();

  return {
    ready, token, tokenSync, user, rest, signOut, requireLogin, accounts,
    get mode(){ return mode; },
    onChange(fn){ listeners.add(fn); return () => listeners.delete(fn); },
    signedIn: () => !!user(),
  };
})();
