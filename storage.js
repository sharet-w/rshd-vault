/* ================================================================
   RSHD JOURNAL — AES-256 ENCRYPTED STORAGE ENGINE
   ================================================================ */

window.JournalStore = (() => {
  "use strict";

  const DATA_FILE  = "data.json";
  const MEDIA_DIR  = "media";
  const HANDLE_DB  = "rshdJournalFS";
  const HANDLE_KEY = "dirHandle";

  let dirHandle = null;
  let data = null; 
  let sessionKey = null;
  let overlayResolve = null;
  let overlayWired = false;

  // --- 1. Folder Permission Handling ---
  function hdb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(HANDLE_DB, 1);
      r.onupgradeneeded = e => e.target.result.createObjectStore("kv");
      r.onsuccess = e => res(e.target.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function saveHandle(h) {
    const db = await hdb();
    return new Promise(res => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(h, HANDLE_KEY);
      tx.oncomplete = () => res();
    });
  }
  async function loadHandle() {
    const db = await hdb();
    return new Promise(res => {
      const rq = db.transaction("kv", "readonly").objectStore("kv").get(HANDLE_KEY);
      rq.onsuccess = () => res(rq.result || null);
    });
  }
  const PERM = { mode: "readwrite" };
  async function hasPermission(h)  { return (await h.queryPermission(PERM)) === "granted"; }
  async function requestPermission(h){ return (await h.requestPermission(PERM)) === "granted"; }

  // --- 2. Overlay UI ---
  const OVERLAY_CSS = `
    #js-overlay{position:fixed;inset:0;z-index:9999;display:none;align-items:center;justify-content:center;
      background:rgba(8,8,13,0.8);backdrop-filter:saturate(160%) blur(18px);-webkit-backdrop-filter:saturate(160%) blur(18px);}
    #js-overlay .js-card{width:440px;padding:44px 40px;border-radius:26px;text-align:center;
      background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);
      box-shadow:0 30px 80px rgba(0,0,0,0.6);font-family:sans-serif;color:#f5f5f7;}
    #js-overlay .js-emoji{font-size:46px;margin-bottom:18px;}
    #js-overlay h2{font-size:22px;font-weight:700;margin-bottom:10px;}
    #js-overlay p{font-size:13.5px;line-height:1.6;color:rgba(245,245,247,0.55);margin-bottom:22px;}
    #js-overlay #js-btn{font-weight:700;color:#fff;cursor:pointer;padding:12px 28px;border:none;border-radius:99px;background:#0a84ff;}
    #js-overlay .js-note{margin:14px 0 0;font-size:12px;color:rgba(245,245,247,0.4);}`;

  function injectOverlay() {
    if (document.getElementById("js-overlay")) return;
    const css = document.createElement("style"); css.textContent = OVERLAY_CSS; document.head.appendChild(css);
    const div = document.createElement("div"); div.id = "js-overlay";
    div.innerHTML = `<div class="js-card"><div class="js-emoji">📁</div><h2 id="js-title"></h2><p id="js-sub"></p><button id="js-btn"></button><p class="js-note" id="js-note"></p></div>`;
    document.body.appendChild(div);
  }
  function showOverlay(mode) {
    injectOverlay(); document.getElementById("js-overlay").style.display = "flex";
    document.getElementById("js-title").textContent = mode === "choose" ? "Connect USB folder" : "Folder access needed";
    document.getElementById("js-sub").textContent = mode === "choose" ? "Select the RSHD_Journal folder on your USB drive." : "Browser needs permission to reopen the USB folder.";
    document.getElementById("js-btn").textContent = mode === "choose" ? "Choose Folder" : "Grant Access";
  }
  function overlayStatus(msg) { const n = document.getElementById("js-note"); if (n) n.textContent = msg; }
  function hideOverlay() { const o = document.getElementById("js-overlay"); if (o) o.style.display = "none"; }

  function wireOverlay() {
    if (overlayWired) return; overlayWired = true;
    document.getElementById("js-btn").addEventListener("click", async () => {
      try {
        if (!dirHandle) {
          overlayStatus("Opening folder picker…"); dirHandle = await window.showDirectoryPicker({ mode: "readwrite" }); await saveHandle(dirHandle);
        } else {
          overlayStatus("Requesting permission…"); if (!(await requestPermission(dirHandle))) return;
        }
        overlayStatus("Reading secure data…"); await readData(); hideOverlay();
        const r = overlayResolve; overlayResolve = null; r && r(data);
      } catch (err) { overlayStatus("Cancelled or error."); }
    });
  }

  // --- 3. Cryptography Engine ---
  function genRandom(bytes) { return window.crypto.getRandomValues(new Uint8Array(bytes)); }

  async function unlockSession(passcode) {
    const enc = new TextEncoder();
    const keyMat = await window.crypto.subtle.importKey("raw", enc.encode(passcode), {name: "PBKDF2"}, false, ["deriveKey"]);
    const salt = enc.encode("RSHD_AES_SALT_2026"); 
    
    // Derive AES-GCM 256-bit key from 4-digit passcode
    sessionKey = await window.crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: salt, iterations: 100000, hash: "SHA-256" },
      keyMat, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]
    );
    
    // Save transient key to sessionStorage so other pages can decrypt data
    const raw = await window.crypto.subtle.exportKey("raw", sessionKey);
    sessionStorage.setItem("rshdKey", btoa(String.fromCharCode(...new Uint8Array(raw))));
  }

  async function loadSessionKey() {
    if (sessionKey) return true;
    const b64 = sessionStorage.getItem("rshdKey");
    if (!b64) return false;
    
    const raw = new Uint8Array(atob(b64).split("").map(c => c.charCodeAt(0)));
    sessionKey = await window.crypto.subtle.importKey("raw", raw, {name: "AES-GCM"}, false, ["encrypt", "decrypt"]);
    return true;
  }

  async function encryptBytes(buffer) {
    await loadSessionKey();
    const iv = genRandom(12);
    const ciphertext = await window.crypto.subtle.encrypt({name: "AES-GCM", iv}, sessionKey, buffer);
    const result = new Uint8Array(iv.length + ciphertext.byteLength);
    result.set(iv, 0); result.set(new Uint8Array(ciphertext), iv.length); // Pack IV + Ciphertext
    return result;
  }

  async function decryptBytes(buffer) {
    await loadSessionKey();
    const dataArray = new Uint8Array(buffer);
    const iv = dataArray.slice(0, 12);
    const ciphertext = dataArray.slice(12);
    return await window.crypto.subtle.decrypt({name: "AES-GCM", iv}, sessionKey, ciphertext);
  }

  // --- 4. Secure Data.json I/O ---
  async function writeData() {
    const jsonStr = JSON.stringify(data.entries || []);
    const encBytes = await encryptBytes(new TextEncoder().encode(jsonStr));
    
    // Safely convert binary to base64
    const binString = Array.from(encBytes).map(b => String.fromCharCode(b)).join("");
    const wrapper = { passcodeHash: data.passcodeHash, payload: btoa(binString) };
    
    const fh = await dirHandle.getFileHandle(DATA_FILE, { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify(wrapper, null, 2));
    await w.close();
  }

  async function readData() {
    try {
      const fh = await dirHandle.getFileHandle(DATA_FILE);
      const wrapper = JSON.parse(await (await fh.getFile()).text());
      data = { passcodeHash: wrapper.passcodeHash, entries: [] };
      
      // Decrypt payload if the user has already entered the passcode
      if (wrapper.payload && await loadSessionKey()) {
         const binString = atob(wrapper.payload);
         const encBytes = new Uint8Array(binString.length);
         for (let i = 0; i < binString.length; i++) encBytes[i] = binString.charCodeAt(i);
         
         const decBytes = await decryptBytes(encBytes);
         data.entries = JSON.parse(new TextDecoder().decode(decBytes));
      }
    } catch (e) { if (!data) data = { passcodeHash: null, entries: [] }; }
    if (!("passcodeHash" in data)) data.passcodeHash = null;
    return data;
  }

  // --- 5. Encrypted Media I/O ---
  function sanitize(name) { return String(name).replace(/[^\w.\-]+/g, "_"); }

  async function writeMediaBlob(blob, baseName) {
    const dir = await dirHandle.getDirectoryHandle(MEDIA_DIR, { create: true });
    const name = Date.now() + "_" + sanitize(baseName).slice(-60) + ".enc"; // Saves as unopenable .enc file
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    
    const arrayBuffer = await blob.arrayBuffer();
    const encBytes = await encryptBytes(arrayBuffer); // Encrypt entire photo
    
    await w.write(encBytes); await w.close();
    return MEDIA_DIR + "/" + name;
  }
  async function writeMedia(file) { return writeMediaBlob(file, file.name); }

  const urlCache = new Map();
  async function getMediaURL(fileName) {
    if (!fileName) return null;
    if (urlCache.has(fileName)) return urlCache.get(fileName);
    try {
      const parts = fileName.split("/"); let h = dirHandle;
      for (let i = 0; i < parts.length - 1; i++) h = await h.getDirectoryHandle(parts[i]);
      const fh = await h.getFileHandle(parts[parts.length - 1]);
      const file = await fh.getFile();
      
      const arrayBuffer = await file.arrayBuffer();
      const decBytes = await decryptBytes(arrayBuffer); // Decrypt photo directly into RAM
      
      let mime = "application/octet-stream";
      if (fileName.includes(".mp4") || fileName.includes(".mov")) mime = "video/mp4";
      else if (fileName.includes(".jpg") || fileName.includes(".png") || fileName.includes(".heic")) mime = "image/jpeg";
      
      const decBlob = new Blob([decBytes], { type: mime });
      const url = URL.createObjectURL(decBlob);
      urlCache.set(fileName, url);
      return url;
    } catch (e) { return null; }
  }

  async function deleteMedia(fileName) {
    if (!fileName) return;
    try {
      const parts = fileName.split("/"); let h = dirHandle;
      for (let i = 0; i < parts.length - 1; i++) h = await h.getDirectoryHandle(parts[i]);
      await h.removeEntry(parts[parts.length - 1]);
    } catch {}
    urlCache.delete(fileName);
  }

  async function init({ required = true } = {}) {
    if (data) return data;
    if (dirHandle && await hasPermission(dirHandle)) return await readData();
    const h = await loadHandle();
    if (h && await hasPermission(h)) { dirHandle = h; return await readData(); }
    if (!required) return null;
    return new Promise(resolve => { overlayResolve = resolve; showOverlay(h ? "grant" : "choose"); wireOverlay(); });
  }

  const ensureAccess = () => init({ required: true });
  const getData = () => data;
  const save = async () => { if (!dirHandle) throw new Error("No folder"); await writeData(); };
  async function hashCode(code) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("rshd-journal::" + code));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
  }

  return { init, ensureAccess, getData, save, hashCode, writeMedia, getMediaURL, deleteMedia, unlockSession };
})();