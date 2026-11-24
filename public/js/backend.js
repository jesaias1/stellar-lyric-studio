"use strict";
/* Talks to the studio backend (src/worker.js): the lyric AI, photos, posting and the shared templates.
   Every request carries the user's login token (from auth.js). Loaded before studio.js, so it uses nothing from it. */
window.SLSBackend = (() => {
  const auth = window.SLSAuth;
  const expired = () => auth.requireLogin("Your login has run out. Log in again to carry on.");

  class ApiError extends Error {
    constructor(code, message, status){ super(message); this.code = code; this.status = status; }
  }

  async function call(path, { method = "GET", body, signal, timeout = 90000 } = {}){
    const pass = path === "/api/health" ? "" : await auth.token();
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
      if(res.status === 401) expired();
      // a page opened straight from disk or from a host without the backend answers 404/405 with no JSON
      const code = (data && data.error) || (res.status === 404 || res.status === 405 ? "offline" : "http_" + res.status);
      throw new ApiError(code, (data && data.message) || (code === "offline" ? "The studio server can't be reached." : "The server answered with an error (" + res.status + ")."), res.status);
    }
    return data;
  }

  return {
    ApiError,
    hasPass: () => auth.signedIn(),
    /* the login token right now (refreshed in the background, so it's fresh) */
    passcode: () => auth.tokenSync(),
    health: () => call("/api/health", { timeout: 8000 }),
    transcribe: (payload, signal) => call("/api/transcribe", { method: "POST", body: payload, signal, timeout: 120000 }),
    api: (path, opts) => call(path, opts),
    /* Sends a file (the exported video) as the request body, reporting upload progress 0..1. Answers JSON. */
    send(path, blob, { headers = {}, onProgress = () => {}, timeout = 900000 } = {}){
      return new Promise((resolve, reject) => {
        const x = new XMLHttpRequest(); x.open("POST", path); x.timeout = timeout;
        const pass = auth.tokenSync();
        if(pass) x.setRequestHeader("authorization", "Bearer " + pass);
        for(const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v);
        x.upload.onprogress = e => { if(e.lengthComputable) onProgress(e.loaded / e.total); };
        x.onload = () => {
          let d = null; try { d = JSON.parse(x.responseText); } catch {}
          if(x.status >= 200 && x.status < 300) return resolve(d || {});
          if(x.status === 401) expired();
          reject(new ApiError((d && d.error) || "http_" + x.status, (d && d.message) || `The upload failed (${x.status}).`, x.status));
        };
        x.onerror = () => reject(new ApiError("offline", "The studio server can't be reached.", 0));
        x.ontimeout = () => reject(new ApiError("timeout", "The upload took too long.", 0));
        x.send(blob);
      });
    },
    /* Downloads a file the backend relays (stock and AI videos), reporting progress 0..1. */
    async blob(path, { signal, onProgress = () => {} } = {}){
      let res; const pass = await auth.token();
      try { res = await fetch(path, { signal, headers: pass ? { authorization: "Bearer " + pass } : {} }); }
      catch(err){ throw new ApiError(signal && signal.aborted ? "cancelled" : "offline", signal && signal.aborted ? "Cancelled." : "The studio server can't be reached.", 0); }
      if(!res.ok){ let d = null; try { d = await res.json(); } catch {} if(res.status === 401) expired();
        throw new ApiError((d && d.error) || "http_" + res.status, (d && d.message) || `The download failed (${res.status}).`, res.status); }
      const total = +res.headers.get("content-length") || 0, type = res.headers.get("content-type") || "video/mp4";
      if(!res.body || !res.body.getReader) return res.blob();
      const reader = res.body.getReader(), parts = []; let got = 0;
      for(;;){ const { done, value } = await reader.read(); if(done) break; parts.push(value); got += value.length; onProgress(total ? got / total : Math.min(0.95, got / 2e7)); }
      onProgress(1); return new Blob(parts, { type });
    },

    /* Shared templates, shaped like the small database interface studio.js already uses. Null when not signed in. */
    async db(){
      await auth.ready;
      if(!auth.signedIn()) return null;
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
