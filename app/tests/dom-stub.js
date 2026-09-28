// dom-stub.js -- a minimal, dependency-free browser shim so Harmonizer's <script> can be
// loaded and exercised under plain Node, without a real browser. Used by logic.test.js.
//
// This works because the app script (as of v2.9) ends with a small, normally-inert block:
//
//   if (typeof globalThis !== 'undefined' && globalThis.__HARMONIZER_TEST__){
//     globalThis.__harmonizer = { init, getSong, setSong, ... };
//   }
//
// Setting __HARMONIZER_TEST__ before the script runs makes it publish its internals on
// globalThis.__harmonizer instead of staying fully closed up in its IIFE. If you add a new
// function to the app that a test should reach, add it to that block too -- this file and
// logic.test.js don't need to change, only that one list in the app itself.
'use strict';
const fs = require('fs');

function makeClassList(){
  const set = new Set();
  return {
    add(){ for (const c of arguments) if (c) set.add(c); },
    remove(){ for (const c of arguments) set.delete(c); },
    toggle(c, force){
      if (force === undefined){
        if (set.has(c)){ set.delete(c); return false; }
        set.add(c); return true;
      }
      if (force) set.add(c); else set.delete(c);
      return force;
    },
    contains(c){ return set.has(c); }
  };
}

function makeCtx(){
  return {
    fillRect(){}, clearRect(){}, beginPath(){}, moveTo(){}, lineTo(){}, stroke(){}, fill(){}, arc(){},
    save(){}, restore(){}, translate(){}, scale(){}, measureText(){ return { width: 0 }; },
    fillText(){}, strokeText(){}, setTransform(){}, closePath(){}, bezierCurveTo(){}, quadraticCurveTo(){}, rect(){}
  };
}

function makeElement(tagName){
  const listeners = {};
  const children = [];
  let _value = '', _textContent = '', _innerHTML = '', _checked = false, _disabled = false, _hidden = false;
  const el = {
    tagName: (tagName || 'DIV').toUpperCase(),
    id: '', style: {}, dataset: {}, classList: makeClassList(),
    children, childNodes: children, attributes: {}, parentNode: null,
    addEventListener(type, fn){ (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener(type, fn){ if (listeners[type]) listeners[type] = listeners[type].filter(f => f !== fn); },
    dispatch(type, ev){ (listeners[type] || []).slice().forEach(fn => fn(ev || { target: el })); },
    appendChild(c){ children.push(c); c.parentNode = el; return c; },
    insertBefore(c, ref){ const i = ref ? children.indexOf(ref) : -1; if (i < 0) children.push(c); else children.splice(i, 0, c); c.parentNode = el; return c; },
    removeChild(c){ const i = children.indexOf(c); if (i >= 0) children.splice(i, 1); return c; },
    setAttribute(k, v){ el.attributes[k] = String(v); },
    getAttribute(k){ return Object.prototype.hasOwnProperty.call(el.attributes, k) ? el.attributes[k] : null; },
    removeAttribute(k){ delete el.attributes[k]; },
    getContext(){ return makeCtx(); },
    querySelector(){ return null; },
    querySelectorAll(){ return []; },
    focus(){ el.dispatch('focus'); },
    blur(){ el.dispatch('blur'); },
    click(){ el.dispatch('click', { target: el, currentTarget: el, preventDefault(){} }); },
    getBoundingClientRect(){ return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
    scrollTo(){}, scrollBy(){}
  };
  Object.defineProperty(el, 'textContent', { get(){ return _textContent; }, set(v){ _textContent = String(v); } });
  Object.defineProperty(el, 'innerHTML', { get(){ return _innerHTML; }, set(v){ _innerHTML = String(v); children.length = 0; } });
  Object.defineProperty(el, 'value', { get(){ return _value; }, set(v){ _value = v; } });
  Object.defineProperty(el, 'checked', { get(){ return _checked; }, set(v){ _checked = !!v; } });
  Object.defineProperty(el, 'disabled', { get(){ return _disabled; }, set(v){ _disabled = !!v; } });
  Object.defineProperty(el, 'hidden', { get(){ return _hidden; }, set(v){ _hidden = !!v; } });
  return el;
}

// Loads an app HTML file's <script> block into a fresh sandboxed set of globals and returns
// the globalThis.__harmonizer API it publishes. `htmlPath` should point at a harmonizer-x.y.html.
function loadApp(htmlPath){
  const html = fs.readFileSync(htmlPath, 'utf8');
  // v2.21: the page can hold more than one <script> (2.20 added an inline analytics snippet in
  // <head>), so pick the app's own block -- the one with the test hook -- not just the first.
  const blocks = Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g), mm => mm[1]);
  const m = blocks.find(b => b.indexOf('__HARMONIZER_TEST__') !== -1);
  if (!m) throw new Error('Could not find the app <script> block in ' + htmlPath);
  const src = m;

  const registry = new Map();
  function getElementById(id){
    if (!registry.has(id)){
      const el = makeElement('DIV');
      el.id = id;
      registry.set(id, el);
    }
    return registry.get(id);
  }

  const storageData = {};
  const localStorage = {
    getItem(k){ return Object.prototype.hasOwnProperty.call(storageData, k) ? storageData[k] : null; },
    setItem(k, v){ storageData[k] = String(v); },
    removeItem(k){ delete storageData[k]; },
    clear(){ for (const k in storageData) delete storageData[k]; }
  };

  const docListeners = {};
  const documentStub = {
    getElementById,
    createElement(tag){ return makeElement(tag); },
    createElementNS(_ns, tag){ return makeElement(tag); },
    createTextNode(t){ return { nodeType: 3, textContent: t }; },
    addEventListener(type, fn){ (docListeners[type] = docListeners[type] || []).push(fn); },
    removeEventListener(type, fn){ if (docListeners[type]) docListeners[type] = docListeners[type].filter(f => f !== fn); },
    body: makeElement('BODY'), documentElement: makeElement('HTML'),
    querySelector(){ return null; }, querySelectorAll(){ return []; },
    title: '', activeElement: null
  };

  // Recent Node versions ship their own read-only globalThis.navigator (and similar) --
  // defineProperty instead of plain assignment so overriding them doesn't throw.
  function setGlobal(name, value){
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true, enumerable: true });
  }

  setGlobal('__HARMONIZER_TEST__', true);
  setGlobal('document', documentStub);
  setGlobal('window', globalThis);
  // window === globalThis here, so these land on "window" too -- needed since v2.10 added a
  // window.addEventListener('beforeprint', ...) call at the top level of the app's script
  // (Print / PDF's dynamic print header), which plain Node's globalThis doesn't provide.
  const winListeners = {};
  setGlobal('addEventListener', function(type, fn){ (winListeners[type] = winListeners[type] || []).push(fn); });
  setGlobal('removeEventListener', function(type, fn){ if (winListeners[type]) winListeners[type] = winListeners[type].filter(f => f !== fn); });
  setGlobal('localStorage', localStorage);
  setGlobal('navigator', { userAgent: 'node-test' });
  setGlobal('requestAnimationFrame', function(fn){ return setTimeout(fn, 0); });
  setGlobal('cancelAnimationFrame', function(id){ clearTimeout(id); });
  setGlobal('fetch', function(){ return Promise.reject(new Error('no network in test')); });
  setGlobal('alert', function(){});
  setGlobal('confirm', function(){ return true; });
  setGlobal('prompt', function(){ return null; });
  setGlobal('AudioContext', function(){
    return {
      createGain(){ return { connect(){}, gain: { value: 1 } }; },
      createBufferSource(){ return { connect(){}, start(){}, stop(){} }; },
      decodeAudioData(){ return Promise.resolve({}); },
      currentTime: 0, destination: {}
    };
  });
  setGlobal('Blob', function(parts, opts){ this.parts = parts; this.opts = opts; });
  setGlobal('URL', { createObjectURL(){ return 'blob:stub'; }, revokeObjectURL(){} });

  // eslint-disable-next-line no-eval
  (0, eval)(src);

  const api = globalThis.__harmonizer;
  if (!api) throw new Error('App script did not expose globalThis.__harmonizer -- __HARMONIZER_TEST__ hook missing or broken in ' + htmlPath);
  return api;
}

module.exports = { loadApp, makeElement };
