"use strict";
/* Talks to the studio backend (src/worker.js): the passcode, the lyric AI and the shared templates.
   Loaded before studio.js, so it uses nothing from it. */
window.SLSBackend = (() => {
  const KEY = "sls-pass";
  let pass = null;
  try { pass = localStorage.getItem(KEY) || null; } catch {}

  class ApiError extends Error {
    constructor(code, message, status){ super(message); this.code = code; this.status = status; }
  }

  async function call(path, { method = "GET", body, signal, timeout = 90000 } = {}){
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeout);
    const onAbort = () => ctl.abort();
    if(signal){ if(signal.aborted) ctl.abort(); else signal.addEventListener("abort", onAbort, { once: true }); }
    let res;
    try {
      res = await fetch(path, {
        method, signal: ctl.signal,
        headers: { ...(pass ? { authorization: "Bearer " + pass } : {}), ...(body != null ? { "content-type": "application/json" } : {}) },
        body: body != null ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
      });
    } catch(err){
      if(signal && signal.aborted) throw new ApiError("cancelled", "Cancelled.", 0);
      throw new ApiError(ctl.signal.aborted ? "timeout" : "offline", ctl.signal.aborted ? "The server took too long to answer." : "The studio server can't be reached.", 0);
    } finally { clearTimeout(timer); if(signal) signal.removeEventListener("abort", onAbort); }
    let data = null;
    try { data = await res.json(); } catch {}
    if(!res.ok){
      if(res.status === 401){ pass = null; try { localStorage.removeItem(KEY); } catch {} }
      // a page opened straight from disk or from a host without the backend answers 404/405 with no JSON
      const code = (data && data.error) || (res.status === 404 || res.status === 405 ? "offline" : "http_" + res.status);
      throw new ApiError(code, (data && data.message) || (code === "offline" ? "The studio server can't be reached." : "The server answered with an error (" + res.status + ")."), res.status);
    }
    return data;
  }

  return {
    ApiError,
    hasPass: () => !!pass,
    health: () => call("/api/health", { timeout: 8000 }),
    /* Checks a passcode with the server and remembers it in this browser when it is right. */
    async unlock(candidate){
      const before = pass; pass = candidate;
      try { await call("/api/session", { method: "POST", timeout: 15000 }); try { localStorage.setItem(KEY, candidate); } catch {} return true; }
      catch(err){ pass = err.code === "unauthorized" ? null : before; throw err; }
    },
    forget(){ pass = null; try { localStorage.removeItem(KEY); } catch {} },
    transcribe: (payload, signal) => call("/api/transcribe", { method: "POST", body: payload, signal, timeout: 120000 }),
    api: (path, opts) => call(path, opts),
    /* Downloads a file the backend relays (stock and AI videos), reporting progress 0..1. */
    async blob(path, { signal, onProgress = () => {} } = {}){
      let res;
      try { res = await fetch(path, { signal, headers: pass ? { authorization: "Bearer " + pass } : {} }); }
      catch(err){ throw new ApiError(signal && signal.aborted ? "cancelled" : "offline", signal && signal.aborted ? "Cancelled." : "The studio server can't be reached.", 0); }
      if(!res.ok){ let d = null; try { d = await res.json(); } catch {} if(res.status === 401){ pass = null; try { localStorage.removeItem(KEY); } catch {} }
        throw new ApiError((d && d.error) || "http_" + res.status, (d && d.message) || `The download failed (${res.status}).`, res.status); }
      const total = +res.headers.get("content-length") || 0, type = res.headers.get("content-type") || "video/mp4";
      if(!res.body || !res.body.getReader) return res.blob();
      const reader = res.body.getReader(), parts = []; let got = 0;
      for(;;){ const { done, value } = await reader.read(); if(done) break; parts.push(value); got += value.length; onProgress(total ? got / total : Math.min(0.95, got / 2e7)); }
      onProgress(1); return new Blob(parts, { type });
    },

    /* Shared templates, shaped like the small database interface studio.js already uses. Null when not signed in. */
    async db(){
      if(!pass) return null;
      try { const h = await call("/api/health", { timeout: 8000 }); if(!h.templates) return null; } catch { return null; }
      let listener = null, onErr = null;
      const refresh = async () => {
        try { const { templates } = await call("/api/templates"); if(listener) listener({ docs: templates.map(t => ({ id: t.id, data: () => t })) }); }
        catch(err){ if(onErr) onErr(err); }
      };
      const col = {
        orderBy: () => col, limit: () => col,
        onSnapshot(cb, errCb){ listener = cb; onErr = errCb; refresh(); const f = () => { if(!document.hidden) refresh(); }; document.addEventListener("visibilitychange", f); return () => { listener = null; document.removeEventListener("visibilitychange", f); }; },
        async add(doc){ const id = "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); await call("/api/templates/" + id, { method: "PUT", body: doc }); refresh(); return { id }; },
        doc: id => ({ async delete(){ await call("/api/templates/" + id, { method: "DELETE" }); refresh(); }, async set(doc){ await call("/api/templates/" + id, { method: "PUT", body: doc }); refresh(); } }),
      };
      return { collection: () => col };
    },
  };
})();
