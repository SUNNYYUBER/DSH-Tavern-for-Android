"use strict";
var DSHT = (() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __esm = (fn, res, err) => function __init() {
    if (err) throw err[0];
    try {
      return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
    } catch (e) {
      throw err = [e], e;
    }
  };
  var __commonJS = (cb, mod) => function __require2() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/lore/entry.ts
  function pick(entry, keys, fallback) {
    for (const k of keys) {
      if (entry[k] !== void 0 && entry[k] !== null) return entry[k];
    }
    return fallback;
  }
  function importLoreBook(name, raw) {
    const warnings = [];
    const obj = raw ?? {};
    const rawEntries = Array.isArray(obj.entries) ? obj.entries : obj.entries && typeof obj.entries === "object" ? Object.values(obj.entries) : [];
    const entries = rawEntries.map((e, i) => {
      const r = e ?? {};
      if (pick(r, ["probability"], 100) !== 100 && pick(r, ["probability"], 100) > 0) warnings.push(`#${i}\u300C${String(r.comment ?? "")}\u300D\u6982\u7387\u89E6\u53D1\u5DF2\u5F03\u7528\uFF08\u6309 100% \u5904\u7406\uFF09`);
      const content = pick(r, ["content"], "");
      const rawKeys = pick(r, ["key", "keys"], []);
      const keys = (Array.isArray(rawKeys) ? rawKeys : [rawKeys]).map(String).filter((k) => k !== "");
      const rawSecondary = pick(r, ["keysecondary", "secondaryKeys"], []);
      const secondary = (Array.isArray(rawSecondary) ? rawSecondary : [rawSecondary]).map(String).filter((k) => k !== "");
      return {
        id: `lore-${name}-${i}`,
        comment: pick(r, ["comment", "name"], `\u6761\u76EE ${i}`),
        content,
        keys: keys.map(String).filter((k) => k !== ""),
        secondaryKeys: secondary.map(String).filter((k) => k !== ""),
        selectiveLogic: pick(r, ["selectiveLogic"], 0),
        constant: pick(r, ["constant"], false),
        selective: pick(r, ["selective"], false),
        position: pick(r, ["position", "world_info_position"], WI_POSITION.BEFORE),
        depth: pick(r, ["depth", "world_info_depth"], 4),
        role: pick(r, ["role", "world_info_role"], "system"),
        scanDepth: r.scanDepth != null ? Number(r.scanDepth) : null,
        preventRecursion: pick(r, ["preventRecursion"], false),
        excludeRecursion: pick(r, ["excludeRecursion"], false),
        insertionOrder: pick(r, ["order", "insertion_order"], 100),
        sticky: pick(r, ["sticky"], 0),
        cooldown: pick(r, ["cooldown"], 0),
        delay: pick(r, ["delay"], 0),
        group: pick(r, ["group"], ""),
        groupOverride: pick(r, ["groupOverride"], false),
        enabled: pick(r, ["disable", "disabled"], false) === false,
        book: name
      };
    });
    return { name, entries, importWarnings: [...new Set(warnings)] };
  }
  var WI_POSITION;
  var init_entry = __esm({
    "src/lore/entry.ts"() {
      "use strict";
      WI_POSITION = {
        BEFORE: 0,
        AFTER: 1,
        AN_TOP: 2,
        AN_BOTTOM: 3,
        AT_DEPTH: 4,
        EM_TOP: 5,
        EM_BOTTOM: 6,
        OUTLET: 7
      };
    }
  });

  // src/regex/engine.ts
  function importRegexScripts(raw) {
    const warnings = [];
    if (!Array.isArray(raw)) return { scripts: [], warnings: ["\u6B63\u5219\u6570\u636E\u4E0D\u662F\u6570\u7EC4"] };
    const scripts = raw.map((item, i) => {
      const r = item ?? {};
      if (typeof r.findRegex !== "string" || r.findRegex === "") {
        warnings.push(`#${i}\uFF08${String(r.scriptName ?? "\u672A\u547D\u540D")}\uFF09\u7F3A\u5C11 findRegex\uFF0C\u5DF2\u8DF3\u8FC7`);
        return null;
      }
      return {
        id: typeof r.id === "string" ? r.id : `regex-${i}-${Date.now()}`,
        scriptName: typeof r.scriptName === "string" ? r.scriptName : `\u672A\u547D\u540D\u811A\u672C ${i}`,
        findRegex: r.findRegex,
        replaceString: typeof r.replaceString === "string" ? r.replaceString : "",
        trimStrings: Array.isArray(r.trimStrings) ? r.trimStrings : [],
        placement: Array.isArray(r.placement) ? r.placement : [PLACEMENT.AI_OUTPUT],
        disabled: r.disabled === true,
        markdownOnly: r.markdownOnly === true,
        promptOnly: r.promptOnly === true,
        runOnEdit: r.runOnEdit === true,
        substituteRegex: typeof r.substituteRegex === "number" ? r.substituteRegex : 0,
        minDepth: typeof r.minDepth === "number" ? r.minDepth : null,
        maxDepth: typeof r.maxDepth === "number" ? r.maxDepth : null
      };
    }).filter((s) => s !== null);
    return { scripts, warnings };
  }
  var PLACEMENT;
  var init_engine = __esm({
    "src/regex/engine.ts"() {
      "use strict";
      PLACEMENT = {
        USER_INPUT: 1,
        AI_OUTPUT: 2,
        SLASH_COMMAND: 3,
        WORLD_INFO: 5,
        REASONING: 6
      };
    }
  });

  // src/import/character-card.ts
  var character_card_exports = {};
  __export(character_card_exports, {
    extractCardJsonFromPng: () => extractCardJsonFromPng,
    importCharacterJson: () => importCharacterJson,
    importCharacterPng: () => importCharacterPng,
    parseCharacterCard: () => parseCharacterCard,
    summarizeBundle: () => summarizeBundle
  });
  function extractCardJsonFromPng(bytes) {
    if (bytes.length < 8) return null;
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const decoder = new TextDecoder("latin1");
    let pos = 8;
    while (pos + 12 <= bytes.length) {
      const length = view.getUint32(pos);
      const type = decoder.decode(bytes.subarray(pos + 4, pos + 8));
      if (type === "tEXt") {
        const dataStart = pos + 8;
        let kwEnd = dataStart;
        while (kwEnd < dataStart + length && bytes[kwEnd] !== 0) kwEnd++;
        const keyword = decoder.decode(bytes.subarray(dataStart, kwEnd));
        if (keyword === "char" || keyword === "ccv3") {
          const textStart = kwEnd + 1;
          const b64 = decoder.decode(bytes.subarray(textStart, pos + 8 + length));
          try {
            const bin = atob(b64.trim());
            const jsonBytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) jsonBytes[i] = bin.charCodeAt(i);
            return new TextDecoder("utf-8").decode(jsonBytes);
          } catch {
            return null;
          }
        }
      }
      if (type === "IEND") break;
      pos = pos + 8 + length + 4;
    }
    return null;
  }
  function str(v, fallback = "") {
    return typeof v === "string" ? v : fallback;
  }
  function parseCharacterCard(json, sourceName) {
    let root;
    try {
      root = JSON.parse(json);
    } catch {
      return null;
    }
    const warnings = [];
    const data = root.data && typeof root.data === "object" ? root.data : root;
    const spec = str(root.spec, data === root ? "chara_card_v1" : "chara_card_v2");
    let embeddedBook = null;
    const rawBook = data.character_book;
    if (rawBook && typeof rawBook === "object") {
      embeddedBook = importLoreBook(`${str(data.name, sourceName)}::embedded`, rawBook);
      if (embeddedBook.entries.length === 0) embeddedBook = null;
    }
    let embeddedRegex = [];
    const ext = data.extensions && typeof data.extensions === "object" ? data.extensions : {};
    if (Array.isArray(ext.regex_scripts)) {
      const r = importRegexScripts(ext.regex_scripts);
      embeddedRegex = r.scripts;
      warnings.push(...r.warnings);
    }
    let depthPrompt = null;
    const dp = ext.depth_prompt;
    if (dp && typeof dp === "object") {
      const d = dp;
      depthPrompt = {
        prompt: str(d.prompt),
        depth: typeof d.depth === "number" ? d.depth : 4,
        role: str(d.role, "system")
      };
    }
    const externalWorldRef = typeof ext.world === "string" && ext.world !== "" ? ext.world : null;
    return {
      spec,
      name: str(data.name, sourceName),
      description: str(data.description),
      personality: str(data.personality),
      scenario: str(data.scenario),
      firstMes: str(data.first_mes),
      alternateGreetings: Array.isArray(data.alternate_greetings) ? data.alternate_greetings : [],
      mesExample: str(data.mes_example),
      creatorNotes: str(data.creator_notes),
      systemPrompt: str(data.system_prompt),
      postHistoryInstructions: str(data.post_history_instructions),
      tags: Array.isArray(data.tags) ? data.tags : [],
      creator: str(data.creator),
      characterVersion: str(data.character_version),
      embeddedBook,
      embeddedRegex,
      depthPrompt,
      externalWorldRef,
      importWarnings: warnings,
      // T3.1b：原样保留解析前的 ST JSON（无损导出；不覆盖调用方已设置的值）
      rawJson: typeof json === "string" && json.length > 0 ? json : void 0
    };
  }
  function importCharacterPng(bytes, sourceName) {
    const json = extractCardJsonFromPng(bytes);
    if (json === null) return null;
    const card = parseCharacterCard(json, sourceName);
    if (card) card.avatar = bytes;
    return card;
  }
  function importCharacterJson(json, sourceName) {
    return parseCharacterCard(json, sourceName);
  }
  function summarizeBundle(card) {
    return {
      card,
      manifest: {
        character: card.name,
        embeddedBook: card.embeddedBook ? { name: card.embeddedBook.name, entryCount: card.embeddedBook.entries.length } : null,
        embeddedRegexCount: card.embeddedRegex.length,
        depthPrompt: card.depthPrompt !== null,
        externalWorldRef: card.externalWorldRef
      }
    };
  }
  var init_character_card = __esm({
    "src/import/character-card.ts"() {
      "use strict";
      init_entry();
      init_engine();
    }
  });

  // node_modules/jszip/dist/jszip.min.js
  var require_jszip_min = __commonJS({
    "node_modules/jszip/dist/jszip.min.js"(exports, module) {
      !(function(e) {
        if ("object" == typeof exports && "undefined" != typeof module) module.exports = e();
        else if ("function" == typeof define && define.amd) define([], e);
        else {
          ("undefined" != typeof window ? window : "undefined" != typeof global ? global : "undefined" != typeof self ? self : this).JSZip = e();
        }
      })(function() {
        return (function s(a, o, h) {
          function u(r, e2) {
            if (!o[r]) {
              if (!a[r]) {
                var t = "function" == typeof __require && __require;
                if (!e2 && t) return t(r, true);
                if (l) return l(r, true);
                var n = new Error("Cannot find module '" + r + "'");
                throw n.code = "MODULE_NOT_FOUND", n;
              }
              var i = o[r] = { exports: {} };
              a[r][0].call(i.exports, function(e3) {
                var t2 = a[r][1][e3];
                return u(t2 || e3);
              }, i, i.exports, s, a, o, h);
            }
            return o[r].exports;
          }
          for (var l = "function" == typeof __require && __require, e = 0; e < h.length; e++) u(h[e]);
          return u;
        })({ 1: [function(e, t, r) {
          "use strict";
          var d = e("./utils"), c = e("./support"), p = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
          r.encode = function(e2) {
            for (var t2, r2, n, i, s, a, o, h = [], u = 0, l = e2.length, f = l, c2 = "string" !== d.getTypeOf(e2); u < e2.length; ) f = l - u, n = c2 ? (t2 = e2[u++], r2 = u < l ? e2[u++] : 0, u < l ? e2[u++] : 0) : (t2 = e2.charCodeAt(u++), r2 = u < l ? e2.charCodeAt(u++) : 0, u < l ? e2.charCodeAt(u++) : 0), i = t2 >> 2, s = (3 & t2) << 4 | r2 >> 4, a = 1 < f ? (15 & r2) << 2 | n >> 6 : 64, o = 2 < f ? 63 & n : 64, h.push(p.charAt(i) + p.charAt(s) + p.charAt(a) + p.charAt(o));
            return h.join("");
          }, r.decode = function(e2) {
            var t2, r2, n, i, s, a, o = 0, h = 0, u = "data:";
            if (e2.substr(0, u.length) === u) throw new Error("Invalid base64 input, it looks like a data url.");
            var l, f = 3 * (e2 = e2.replace(/[^A-Za-z0-9+/=]/g, "")).length / 4;
            if (e2.charAt(e2.length - 1) === p.charAt(64) && f--, e2.charAt(e2.length - 2) === p.charAt(64) && f--, f % 1 != 0) throw new Error("Invalid base64 input, bad content length.");
            for (l = c.uint8array ? new Uint8Array(0 | f) : new Array(0 | f); o < e2.length; ) t2 = p.indexOf(e2.charAt(o++)) << 2 | (i = p.indexOf(e2.charAt(o++))) >> 4, r2 = (15 & i) << 4 | (s = p.indexOf(e2.charAt(o++))) >> 2, n = (3 & s) << 6 | (a = p.indexOf(e2.charAt(o++))), l[h++] = t2, 64 !== s && (l[h++] = r2), 64 !== a && (l[h++] = n);
            return l;
          };
        }, { "./support": 30, "./utils": 32 }], 2: [function(e, t, r) {
          "use strict";
          var n = e("./external"), i = e("./stream/DataWorker"), s = e("./stream/Crc32Probe"), a = e("./stream/DataLengthProbe");
          function o(e2, t2, r2, n2, i2) {
            this.compressedSize = e2, this.uncompressedSize = t2, this.crc32 = r2, this.compression = n2, this.compressedContent = i2;
          }
          o.prototype = { getContentWorker: function() {
            var e2 = new i(n.Promise.resolve(this.compressedContent)).pipe(this.compression.uncompressWorker()).pipe(new a("data_length")), t2 = this;
            return e2.on("end", function() {
              if (this.streamInfo.data_length !== t2.uncompressedSize) throw new Error("Bug : uncompressed data size mismatch");
            }), e2;
          }, getCompressedWorker: function() {
            return new i(n.Promise.resolve(this.compressedContent)).withStreamInfo("compressedSize", this.compressedSize).withStreamInfo("uncompressedSize", this.uncompressedSize).withStreamInfo("crc32", this.crc32).withStreamInfo("compression", this.compression);
          } }, o.createWorkerFrom = function(e2, t2, r2) {
            return e2.pipe(new s()).pipe(new a("uncompressedSize")).pipe(t2.compressWorker(r2)).pipe(new a("compressedSize")).withStreamInfo("compression", t2);
          }, t.exports = o;
        }, { "./external": 6, "./stream/Crc32Probe": 25, "./stream/DataLengthProbe": 26, "./stream/DataWorker": 27 }], 3: [function(e, t, r) {
          "use strict";
          var n = e("./stream/GenericWorker");
          r.STORE = { magic: "\0\0", compressWorker: function() {
            return new n("STORE compression");
          }, uncompressWorker: function() {
            return new n("STORE decompression");
          } }, r.DEFLATE = e("./flate");
        }, { "./flate": 7, "./stream/GenericWorker": 28 }], 4: [function(e, t, r) {
          "use strict";
          var n = e("./utils");
          var o = (function() {
            for (var e2, t2 = [], r2 = 0; r2 < 256; r2++) {
              e2 = r2;
              for (var n2 = 0; n2 < 8; n2++) e2 = 1 & e2 ? 3988292384 ^ e2 >>> 1 : e2 >>> 1;
              t2[r2] = e2;
            }
            return t2;
          })();
          t.exports = function(e2, t2) {
            return void 0 !== e2 && e2.length ? "string" !== n.getTypeOf(e2) ? (function(e3, t3, r2, n2) {
              var i = o, s = n2 + r2;
              e3 ^= -1;
              for (var a = n2; a < s; a++) e3 = e3 >>> 8 ^ i[255 & (e3 ^ t3[a])];
              return -1 ^ e3;
            })(0 | t2, e2, e2.length, 0) : (function(e3, t3, r2, n2) {
              var i = o, s = n2 + r2;
              e3 ^= -1;
              for (var a = n2; a < s; a++) e3 = e3 >>> 8 ^ i[255 & (e3 ^ t3.charCodeAt(a))];
              return -1 ^ e3;
            })(0 | t2, e2, e2.length, 0) : 0;
          };
        }, { "./utils": 32 }], 5: [function(e, t, r) {
          "use strict";
          r.base64 = false, r.binary = false, r.dir = false, r.createFolders = true, r.date = null, r.compression = null, r.compressionOptions = null, r.comment = null, r.unixPermissions = null, r.dosPermissions = null;
        }, {}], 6: [function(e, t, r) {
          "use strict";
          var n = null;
          n = "undefined" != typeof Promise ? Promise : e("lie"), t.exports = { Promise: n };
        }, { lie: 37 }], 7: [function(e, t, r) {
          "use strict";
          var n = "undefined" != typeof Uint8Array && "undefined" != typeof Uint16Array && "undefined" != typeof Uint32Array, i = e("pako"), s = e("./utils"), a = e("./stream/GenericWorker"), o = n ? "uint8array" : "array";
          function h(e2, t2) {
            a.call(this, "FlateWorker/" + e2), this._pako = null, this._pakoAction = e2, this._pakoOptions = t2, this.meta = {};
          }
          r.magic = "\b\0", s.inherits(h, a), h.prototype.processChunk = function(e2) {
            this.meta = e2.meta, null === this._pako && this._createPako(), this._pako.push(s.transformTo(o, e2.data), false);
          }, h.prototype.flush = function() {
            a.prototype.flush.call(this), null === this._pako && this._createPako(), this._pako.push([], true);
          }, h.prototype.cleanUp = function() {
            a.prototype.cleanUp.call(this), this._pako = null;
          }, h.prototype._createPako = function() {
            this._pako = new i[this._pakoAction]({ raw: true, level: this._pakoOptions.level || -1 });
            var t2 = this;
            this._pako.onData = function(e2) {
              t2.push({ data: e2, meta: t2.meta });
            };
          }, r.compressWorker = function(e2) {
            return new h("Deflate", e2);
          }, r.uncompressWorker = function() {
            return new h("Inflate", {});
          };
        }, { "./stream/GenericWorker": 28, "./utils": 32, pako: 38 }], 8: [function(e, t, r) {
          "use strict";
          function A(e2, t2) {
            var r2, n2 = "";
            for (r2 = 0; r2 < t2; r2++) n2 += String.fromCharCode(255 & e2), e2 >>>= 8;
            return n2;
          }
          function n(e2, t2, r2, n2, i2, s2) {
            var a, o, h = e2.file, u = e2.compression, l = s2 !== O.utf8encode, f = I.transformTo("string", s2(h.name)), c = I.transformTo("string", O.utf8encode(h.name)), d = h.comment, p = I.transformTo("string", s2(d)), m = I.transformTo("string", O.utf8encode(d)), _ = c.length !== h.name.length, g = m.length !== d.length, b = "", v = "", y = "", w = h.dir, k = h.date, x = { crc32: 0, compressedSize: 0, uncompressedSize: 0 };
            t2 && !r2 || (x.crc32 = e2.crc32, x.compressedSize = e2.compressedSize, x.uncompressedSize = e2.uncompressedSize);
            var S = 0;
            t2 && (S |= 8), l || !_ && !g || (S |= 2048);
            var z = 0, C = 0;
            w && (z |= 16), "UNIX" === i2 ? (C = 798, z |= (function(e3, t3) {
              var r3 = e3;
              return e3 || (r3 = t3 ? 16893 : 33204), (65535 & r3) << 16;
            })(h.unixPermissions, w)) : (C = 20, z |= (function(e3) {
              return 63 & (e3 || 0);
            })(h.dosPermissions)), a = k.getUTCHours(), a <<= 6, a |= k.getUTCMinutes(), a <<= 5, a |= k.getUTCSeconds() / 2, o = k.getUTCFullYear() - 1980, o <<= 4, o |= k.getUTCMonth() + 1, o <<= 5, o |= k.getUTCDate(), _ && (v = A(1, 1) + A(B(f), 4) + c, b += "up" + A(v.length, 2) + v), g && (y = A(1, 1) + A(B(p), 4) + m, b += "uc" + A(y.length, 2) + y);
            var E = "";
            return E += "\n\0", E += A(S, 2), E += u.magic, E += A(a, 2), E += A(o, 2), E += A(x.crc32, 4), E += A(x.compressedSize, 4), E += A(x.uncompressedSize, 4), E += A(f.length, 2), E += A(b.length, 2), { fileRecord: R.LOCAL_FILE_HEADER + E + f + b, dirRecord: R.CENTRAL_FILE_HEADER + A(C, 2) + E + A(p.length, 2) + "\0\0\0\0" + A(z, 4) + A(n2, 4) + f + b + p };
          }
          var I = e("../utils"), i = e("../stream/GenericWorker"), O = e("../utf8"), B = e("../crc32"), R = e("../signature");
          function s(e2, t2, r2, n2) {
            i.call(this, "ZipFileWorker"), this.bytesWritten = 0, this.zipComment = t2, this.zipPlatform = r2, this.encodeFileName = n2, this.streamFiles = e2, this.accumulate = false, this.contentBuffer = [], this.dirRecords = [], this.currentSourceOffset = 0, this.entriesCount = 0, this.currentFile = null, this._sources = [];
          }
          I.inherits(s, i), s.prototype.push = function(e2) {
            var t2 = e2.meta.percent || 0, r2 = this.entriesCount, n2 = this._sources.length;
            this.accumulate ? this.contentBuffer.push(e2) : (this.bytesWritten += e2.data.length, i.prototype.push.call(this, { data: e2.data, meta: { currentFile: this.currentFile, percent: r2 ? (t2 + 100 * (r2 - n2 - 1)) / r2 : 100 } }));
          }, s.prototype.openedSource = function(e2) {
            this.currentSourceOffset = this.bytesWritten, this.currentFile = e2.file.name;
            var t2 = this.streamFiles && !e2.file.dir;
            if (t2) {
              var r2 = n(e2, t2, false, this.currentSourceOffset, this.zipPlatform, this.encodeFileName);
              this.push({ data: r2.fileRecord, meta: { percent: 0 } });
            } else this.accumulate = true;
          }, s.prototype.closedSource = function(e2) {
            this.accumulate = false;
            var t2 = this.streamFiles && !e2.file.dir, r2 = n(e2, t2, true, this.currentSourceOffset, this.zipPlatform, this.encodeFileName);
            if (this.dirRecords.push(r2.dirRecord), t2) this.push({ data: (function(e3) {
              return R.DATA_DESCRIPTOR + A(e3.crc32, 4) + A(e3.compressedSize, 4) + A(e3.uncompressedSize, 4);
            })(e2), meta: { percent: 100 } });
            else for (this.push({ data: r2.fileRecord, meta: { percent: 0 } }); this.contentBuffer.length; ) this.push(this.contentBuffer.shift());
            this.currentFile = null;
          }, s.prototype.flush = function() {
            for (var e2 = this.bytesWritten, t2 = 0; t2 < this.dirRecords.length; t2++) this.push({ data: this.dirRecords[t2], meta: { percent: 100 } });
            var r2 = this.bytesWritten - e2, n2 = (function(e3, t3, r3, n3, i2) {
              var s2 = I.transformTo("string", i2(n3));
              return R.CENTRAL_DIRECTORY_END + "\0\0\0\0" + A(e3, 2) + A(e3, 2) + A(t3, 4) + A(r3, 4) + A(s2.length, 2) + s2;
            })(this.dirRecords.length, r2, e2, this.zipComment, this.encodeFileName);
            this.push({ data: n2, meta: { percent: 100 } });
          }, s.prototype.prepareNextSource = function() {
            this.previous = this._sources.shift(), this.openedSource(this.previous.streamInfo), this.isPaused ? this.previous.pause() : this.previous.resume();
          }, s.prototype.registerPrevious = function(e2) {
            this._sources.push(e2);
            var t2 = this;
            return e2.on("data", function(e3) {
              t2.processChunk(e3);
            }), e2.on("end", function() {
              t2.closedSource(t2.previous.streamInfo), t2._sources.length ? t2.prepareNextSource() : t2.end();
            }), e2.on("error", function(e3) {
              t2.error(e3);
            }), this;
          }, s.prototype.resume = function() {
            return !!i.prototype.resume.call(this) && (!this.previous && this._sources.length ? (this.prepareNextSource(), true) : this.previous || this._sources.length || this.generatedError ? void 0 : (this.end(), true));
          }, s.prototype.error = function(e2) {
            var t2 = this._sources;
            if (!i.prototype.error.call(this, e2)) return false;
            for (var r2 = 0; r2 < t2.length; r2++) try {
              t2[r2].error(e2);
            } catch (e3) {
            }
            return true;
          }, s.prototype.lock = function() {
            i.prototype.lock.call(this);
            for (var e2 = this._sources, t2 = 0; t2 < e2.length; t2++) e2[t2].lock();
          }, t.exports = s;
        }, { "../crc32": 4, "../signature": 23, "../stream/GenericWorker": 28, "../utf8": 31, "../utils": 32 }], 9: [function(e, t, r) {
          "use strict";
          var u = e("../compressions"), n = e("./ZipFileWorker");
          r.generateWorker = function(e2, a, t2) {
            var o = new n(a.streamFiles, t2, a.platform, a.encodeFileName), h = 0;
            try {
              e2.forEach(function(e3, t3) {
                h++;
                var r2 = (function(e4, t4) {
                  var r3 = e4 || t4, n3 = u[r3];
                  if (!n3) throw new Error(r3 + " is not a valid compression method !");
                  return n3;
                })(t3.options.compression, a.compression), n2 = t3.options.compressionOptions || a.compressionOptions || {}, i = t3.dir, s = t3.date;
                t3._compressWorker(r2, n2).withStreamInfo("file", { name: e3, dir: i, date: s, comment: t3.comment || "", unixPermissions: t3.unixPermissions, dosPermissions: t3.dosPermissions }).pipe(o);
              }), o.entriesCount = h;
            } catch (e3) {
              o.error(e3);
            }
            return o;
          };
        }, { "../compressions": 3, "./ZipFileWorker": 8 }], 10: [function(e, t, r) {
          "use strict";
          function n() {
            if (!(this instanceof n)) return new n();
            if (arguments.length) throw new Error("The constructor with parameters has been removed in JSZip 3.0, please check the upgrade guide.");
            this.files = /* @__PURE__ */ Object.create(null), this.comment = null, this.root = "", this.clone = function() {
              var e2 = new n();
              for (var t2 in this) "function" != typeof this[t2] && (e2[t2] = this[t2]);
              return e2;
            };
          }
          (n.prototype = e("./object")).loadAsync = e("./load"), n.support = e("./support"), n.defaults = e("./defaults"), n.version = "3.10.1", n.loadAsync = function(e2, t2) {
            return new n().loadAsync(e2, t2);
          }, n.external = e("./external"), t.exports = n;
        }, { "./defaults": 5, "./external": 6, "./load": 11, "./object": 15, "./support": 30 }], 11: [function(e, t, r) {
          "use strict";
          var u = e("./utils"), i = e("./external"), n = e("./utf8"), s = e("./zipEntries"), a = e("./stream/Crc32Probe"), l = e("./nodejsUtils");
          function f(n2) {
            return new i.Promise(function(e2, t2) {
              var r2 = n2.decompressed.getContentWorker().pipe(new a());
              r2.on("error", function(e3) {
                t2(e3);
              }).on("end", function() {
                r2.streamInfo.crc32 !== n2.decompressed.crc32 ? t2(new Error("Corrupted zip : CRC32 mismatch")) : e2();
              }).resume();
            });
          }
          t.exports = function(e2, o) {
            var h = this;
            return o = u.extend(o || {}, { base64: false, checkCRC32: false, optimizedBinaryString: false, createFolders: false, decodeFileName: n.utf8decode }), l.isNode && l.isStream(e2) ? i.Promise.reject(new Error("JSZip can't accept a stream when loading a zip file.")) : u.prepareContent("the loaded zip file", e2, true, o.optimizedBinaryString, o.base64).then(function(e3) {
              var t2 = new s(o);
              return t2.load(e3), t2;
            }).then(function(e3) {
              var t2 = [i.Promise.resolve(e3)], r2 = e3.files;
              if (o.checkCRC32) for (var n2 = 0; n2 < r2.length; n2++) t2.push(f(r2[n2]));
              return i.Promise.all(t2);
            }).then(function(e3) {
              for (var t2 = e3.shift(), r2 = t2.files, n2 = 0; n2 < r2.length; n2++) {
                var i2 = r2[n2], s2 = i2.fileNameStr, a2 = u.resolve(i2.fileNameStr);
                h.file(a2, i2.decompressed, { binary: true, optimizedBinaryString: true, date: i2.date, dir: i2.dir, comment: i2.fileCommentStr.length ? i2.fileCommentStr : null, unixPermissions: i2.unixPermissions, dosPermissions: i2.dosPermissions, createFolders: o.createFolders }), i2.dir || (h.file(a2).unsafeOriginalName = s2);
              }
              return t2.zipComment.length && (h.comment = t2.zipComment), h;
            });
          };
        }, { "./external": 6, "./nodejsUtils": 14, "./stream/Crc32Probe": 25, "./utf8": 31, "./utils": 32, "./zipEntries": 33 }], 12: [function(e, t, r) {
          "use strict";
          var n = e("../utils"), i = e("../stream/GenericWorker");
          function s(e2, t2) {
            i.call(this, "Nodejs stream input adapter for " + e2), this._upstreamEnded = false, this._bindStream(t2);
          }
          n.inherits(s, i), s.prototype._bindStream = function(e2) {
            var t2 = this;
            (this._stream = e2).pause(), e2.on("data", function(e3) {
              t2.push({ data: e3, meta: { percent: 0 } });
            }).on("error", function(e3) {
              t2.isPaused ? this.generatedError = e3 : t2.error(e3);
            }).on("end", function() {
              t2.isPaused ? t2._upstreamEnded = true : t2.end();
            });
          }, s.prototype.pause = function() {
            return !!i.prototype.pause.call(this) && (this._stream.pause(), true);
          }, s.prototype.resume = function() {
            return !!i.prototype.resume.call(this) && (this._upstreamEnded ? this.end() : this._stream.resume(), true);
          }, t.exports = s;
        }, { "../stream/GenericWorker": 28, "../utils": 32 }], 13: [function(e, t, r) {
          "use strict";
          var i = e("readable-stream").Readable;
          function n(e2, t2, r2) {
            i.call(this, t2), this._helper = e2;
            var n2 = this;
            e2.on("data", function(e3, t3) {
              n2.push(e3) || n2._helper.pause(), r2 && r2(t3);
            }).on("error", function(e3) {
              n2.emit("error", e3);
            }).on("end", function() {
              n2.push(null);
            });
          }
          e("../utils").inherits(n, i), n.prototype._read = function() {
            this._helper.resume();
          }, t.exports = n;
        }, { "../utils": 32, "readable-stream": 16 }], 14: [function(e, t, r) {
          "use strict";
          t.exports = { isNode: "undefined" != typeof Buffer, newBufferFrom: function(e2, t2) {
            if (Buffer.from && Buffer.from !== Uint8Array.from) return Buffer.from(e2, t2);
            if ("number" == typeof e2) throw new Error('The "data" argument must not be a number');
            return new Buffer(e2, t2);
          }, allocBuffer: function(e2) {
            if (Buffer.alloc) return Buffer.alloc(e2);
            var t2 = new Buffer(e2);
            return t2.fill(0), t2;
          }, isBuffer: function(e2) {
            return Buffer.isBuffer(e2);
          }, isStream: function(e2) {
            return e2 && "function" == typeof e2.on && "function" == typeof e2.pause && "function" == typeof e2.resume;
          } };
        }, {}], 15: [function(e, t, r) {
          "use strict";
          function s(e2, t2, r2) {
            var n2, i2 = u.getTypeOf(t2), s2 = u.extend(r2 || {}, f);
            s2.date = s2.date || /* @__PURE__ */ new Date(), null !== s2.compression && (s2.compression = s2.compression.toUpperCase()), "string" == typeof s2.unixPermissions && (s2.unixPermissions = parseInt(s2.unixPermissions, 8)), s2.unixPermissions && 16384 & s2.unixPermissions && (s2.dir = true), s2.dosPermissions && 16 & s2.dosPermissions && (s2.dir = true), s2.dir && (e2 = g(e2)), s2.createFolders && (n2 = _(e2)) && b.call(this, n2, true);
            var a2 = "string" === i2 && false === s2.binary && false === s2.base64;
            r2 && void 0 !== r2.binary || (s2.binary = !a2), (t2 instanceof c && 0 === t2.uncompressedSize || s2.dir || !t2 || 0 === t2.length) && (s2.base64 = false, s2.binary = true, t2 = "", s2.compression = "STORE", i2 = "string");
            var o2 = null;
            o2 = t2 instanceof c || t2 instanceof l ? t2 : p.isNode && p.isStream(t2) ? new m(e2, t2) : u.prepareContent(e2, t2, s2.binary, s2.optimizedBinaryString, s2.base64);
            var h2 = new d(e2, o2, s2);
            this.files[e2] = h2;
          }
          var i = e("./utf8"), u = e("./utils"), l = e("./stream/GenericWorker"), a = e("./stream/StreamHelper"), f = e("./defaults"), c = e("./compressedObject"), d = e("./zipObject"), o = e("./generate"), p = e("./nodejsUtils"), m = e("./nodejs/NodejsStreamInputAdapter"), _ = function(e2) {
            "/" === e2.slice(-1) && (e2 = e2.substring(0, e2.length - 1));
            var t2 = e2.lastIndexOf("/");
            return 0 < t2 ? e2.substring(0, t2) : "";
          }, g = function(e2) {
            return "/" !== e2.slice(-1) && (e2 += "/"), e2;
          }, b = function(e2, t2) {
            return t2 = void 0 !== t2 ? t2 : f.createFolders, e2 = g(e2), this.files[e2] || s.call(this, e2, null, { dir: true, createFolders: t2 }), this.files[e2];
          };
          function h(e2) {
            return "[object RegExp]" === Object.prototype.toString.call(e2);
          }
          var n = { load: function() {
            throw new Error("This method has been removed in JSZip 3.0, please check the upgrade guide.");
          }, forEach: function(e2) {
            var t2, r2, n2;
            for (t2 in this.files) n2 = this.files[t2], (r2 = t2.slice(this.root.length, t2.length)) && t2.slice(0, this.root.length) === this.root && e2(r2, n2);
          }, filter: function(r2) {
            var n2 = [];
            return this.forEach(function(e2, t2) {
              r2(e2, t2) && n2.push(t2);
            }), n2;
          }, file: function(e2, t2, r2) {
            if (1 !== arguments.length) return e2 = this.root + e2, s.call(this, e2, t2, r2), this;
            if (h(e2)) {
              var n2 = e2;
              return this.filter(function(e3, t3) {
                return !t3.dir && n2.test(e3);
              });
            }
            var i2 = this.files[this.root + e2];
            return i2 && !i2.dir ? i2 : null;
          }, folder: function(r2) {
            if (!r2) return this;
            if (h(r2)) return this.filter(function(e3, t3) {
              return t3.dir && r2.test(e3);
            });
            var e2 = this.root + r2, t2 = b.call(this, e2), n2 = this.clone();
            return n2.root = t2.name, n2;
          }, remove: function(r2) {
            r2 = this.root + r2;
            var e2 = this.files[r2];
            if (e2 || ("/" !== r2.slice(-1) && (r2 += "/"), e2 = this.files[r2]), e2 && !e2.dir) delete this.files[r2];
            else for (var t2 = this.filter(function(e3, t3) {
              return t3.name.slice(0, r2.length) === r2;
            }), n2 = 0; n2 < t2.length; n2++) delete this.files[t2[n2].name];
            return this;
          }, generate: function() {
            throw new Error("This method has been removed in JSZip 3.0, please check the upgrade guide.");
          }, generateInternalStream: function(e2) {
            var t2, r2 = {};
            try {
              if ((r2 = u.extend(e2 || {}, { streamFiles: false, compression: "STORE", compressionOptions: null, type: "", platform: "DOS", comment: null, mimeType: "application/zip", encodeFileName: i.utf8encode })).type = r2.type.toLowerCase(), r2.compression = r2.compression.toUpperCase(), "binarystring" === r2.type && (r2.type = "string"), !r2.type) throw new Error("No output type specified.");
              u.checkSupport(r2.type), "darwin" !== r2.platform && "freebsd" !== r2.platform && "linux" !== r2.platform && "sunos" !== r2.platform || (r2.platform = "UNIX"), "win32" === r2.platform && (r2.platform = "DOS");
              var n2 = r2.comment || this.comment || "";
              t2 = o.generateWorker(this, r2, n2);
            } catch (e3) {
              (t2 = new l("error")).error(e3);
            }
            return new a(t2, r2.type || "string", r2.mimeType);
          }, generateAsync: function(e2, t2) {
            return this.generateInternalStream(e2).accumulate(t2);
          }, generateNodeStream: function(e2, t2) {
            return (e2 = e2 || {}).type || (e2.type = "nodebuffer"), this.generateInternalStream(e2).toNodejsStream(t2);
          } };
          t.exports = n;
        }, { "./compressedObject": 2, "./defaults": 5, "./generate": 9, "./nodejs/NodejsStreamInputAdapter": 12, "./nodejsUtils": 14, "./stream/GenericWorker": 28, "./stream/StreamHelper": 29, "./utf8": 31, "./utils": 32, "./zipObject": 35 }], 16: [function(e, t, r) {
          "use strict";
          t.exports = e("stream");
        }, { stream: void 0 }], 17: [function(e, t, r) {
          "use strict";
          var n = e("./DataReader");
          function i(e2) {
            n.call(this, e2);
            for (var t2 = 0; t2 < this.data.length; t2++) e2[t2] = 255 & e2[t2];
          }
          e("../utils").inherits(i, n), i.prototype.byteAt = function(e2) {
            return this.data[this.zero + e2];
          }, i.prototype.lastIndexOfSignature = function(e2) {
            for (var t2 = e2.charCodeAt(0), r2 = e2.charCodeAt(1), n2 = e2.charCodeAt(2), i2 = e2.charCodeAt(3), s = this.length - 4; 0 <= s; --s) if (this.data[s] === t2 && this.data[s + 1] === r2 && this.data[s + 2] === n2 && this.data[s + 3] === i2) return s - this.zero;
            return -1;
          }, i.prototype.readAndCheckSignature = function(e2) {
            var t2 = e2.charCodeAt(0), r2 = e2.charCodeAt(1), n2 = e2.charCodeAt(2), i2 = e2.charCodeAt(3), s = this.readData(4);
            return t2 === s[0] && r2 === s[1] && n2 === s[2] && i2 === s[3];
          }, i.prototype.readData = function(e2) {
            if (this.checkOffset(e2), 0 === e2) return [];
            var t2 = this.data.slice(this.zero + this.index, this.zero + this.index + e2);
            return this.index += e2, t2;
          }, t.exports = i;
        }, { "../utils": 32, "./DataReader": 18 }], 18: [function(e, t, r) {
          "use strict";
          var n = e("../utils");
          function i(e2) {
            this.data = e2, this.length = e2.length, this.index = 0, this.zero = 0;
          }
          i.prototype = { checkOffset: function(e2) {
            this.checkIndex(this.index + e2);
          }, checkIndex: function(e2) {
            if (this.length < this.zero + e2 || e2 < 0) throw new Error("End of data reached (data length = " + this.length + ", asked index = " + e2 + "). Corrupted zip ?");
          }, setIndex: function(e2) {
            this.checkIndex(e2), this.index = e2;
          }, skip: function(e2) {
            this.setIndex(this.index + e2);
          }, byteAt: function() {
          }, readInt: function(e2) {
            var t2, r2 = 0;
            for (this.checkOffset(e2), t2 = this.index + e2 - 1; t2 >= this.index; t2--) r2 = (r2 << 8) + this.byteAt(t2);
            return this.index += e2, r2;
          }, readString: function(e2) {
            return n.transformTo("string", this.readData(e2));
          }, readData: function() {
          }, lastIndexOfSignature: function() {
          }, readAndCheckSignature: function() {
          }, readDate: function() {
            var e2 = this.readInt(4);
            return new Date(Date.UTC(1980 + (e2 >> 25 & 127), (e2 >> 21 & 15) - 1, e2 >> 16 & 31, e2 >> 11 & 31, e2 >> 5 & 63, (31 & e2) << 1));
          } }, t.exports = i;
        }, { "../utils": 32 }], 19: [function(e, t, r) {
          "use strict";
          var n = e("./Uint8ArrayReader");
          function i(e2) {
            n.call(this, e2);
          }
          e("../utils").inherits(i, n), i.prototype.readData = function(e2) {
            this.checkOffset(e2);
            var t2 = this.data.slice(this.zero + this.index, this.zero + this.index + e2);
            return this.index += e2, t2;
          }, t.exports = i;
        }, { "../utils": 32, "./Uint8ArrayReader": 21 }], 20: [function(e, t, r) {
          "use strict";
          var n = e("./DataReader");
          function i(e2) {
            n.call(this, e2);
          }
          e("../utils").inherits(i, n), i.prototype.byteAt = function(e2) {
            return this.data.charCodeAt(this.zero + e2);
          }, i.prototype.lastIndexOfSignature = function(e2) {
            return this.data.lastIndexOf(e2) - this.zero;
          }, i.prototype.readAndCheckSignature = function(e2) {
            return e2 === this.readData(4);
          }, i.prototype.readData = function(e2) {
            this.checkOffset(e2);
            var t2 = this.data.slice(this.zero + this.index, this.zero + this.index + e2);
            return this.index += e2, t2;
          }, t.exports = i;
        }, { "../utils": 32, "./DataReader": 18 }], 21: [function(e, t, r) {
          "use strict";
          var n = e("./ArrayReader");
          function i(e2) {
            n.call(this, e2);
          }
          e("../utils").inherits(i, n), i.prototype.readData = function(e2) {
            if (this.checkOffset(e2), 0 === e2) return new Uint8Array(0);
            var t2 = this.data.subarray(this.zero + this.index, this.zero + this.index + e2);
            return this.index += e2, t2;
          }, t.exports = i;
        }, { "../utils": 32, "./ArrayReader": 17 }], 22: [function(e, t, r) {
          "use strict";
          var n = e("../utils"), i = e("../support"), s = e("./ArrayReader"), a = e("./StringReader"), o = e("./NodeBufferReader"), h = e("./Uint8ArrayReader");
          t.exports = function(e2) {
            var t2 = n.getTypeOf(e2);
            return n.checkSupport(t2), "string" !== t2 || i.uint8array ? "nodebuffer" === t2 ? new o(e2) : i.uint8array ? new h(n.transformTo("uint8array", e2)) : new s(n.transformTo("array", e2)) : new a(e2);
          };
        }, { "../support": 30, "../utils": 32, "./ArrayReader": 17, "./NodeBufferReader": 19, "./StringReader": 20, "./Uint8ArrayReader": 21 }], 23: [function(e, t, r) {
          "use strict";
          r.LOCAL_FILE_HEADER = "PK", r.CENTRAL_FILE_HEADER = "PK", r.CENTRAL_DIRECTORY_END = "PK", r.ZIP64_CENTRAL_DIRECTORY_LOCATOR = "PK\x07", r.ZIP64_CENTRAL_DIRECTORY_END = "PK", r.DATA_DESCRIPTOR = "PK\x07\b";
        }, {}], 24: [function(e, t, r) {
          "use strict";
          var n = e("./GenericWorker"), i = e("../utils");
          function s(e2) {
            n.call(this, "ConvertWorker to " + e2), this.destType = e2;
          }
          i.inherits(s, n), s.prototype.processChunk = function(e2) {
            this.push({ data: i.transformTo(this.destType, e2.data), meta: e2.meta });
          }, t.exports = s;
        }, { "../utils": 32, "./GenericWorker": 28 }], 25: [function(e, t, r) {
          "use strict";
          var n = e("./GenericWorker"), i = e("../crc32");
          function s() {
            n.call(this, "Crc32Probe"), this.withStreamInfo("crc32", 0);
          }
          e("../utils").inherits(s, n), s.prototype.processChunk = function(e2) {
            this.streamInfo.crc32 = i(e2.data, this.streamInfo.crc32 || 0), this.push(e2);
          }, t.exports = s;
        }, { "../crc32": 4, "../utils": 32, "./GenericWorker": 28 }], 26: [function(e, t, r) {
          "use strict";
          var n = e("../utils"), i = e("./GenericWorker");
          function s(e2) {
            i.call(this, "DataLengthProbe for " + e2), this.propName = e2, this.withStreamInfo(e2, 0);
          }
          n.inherits(s, i), s.prototype.processChunk = function(e2) {
            if (e2) {
              var t2 = this.streamInfo[this.propName] || 0;
              this.streamInfo[this.propName] = t2 + e2.data.length;
            }
            i.prototype.processChunk.call(this, e2);
          }, t.exports = s;
        }, { "../utils": 32, "./GenericWorker": 28 }], 27: [function(e, t, r) {
          "use strict";
          var n = e("../utils"), i = e("./GenericWorker");
          function s(e2) {
            i.call(this, "DataWorker");
            var t2 = this;
            this.dataIsReady = false, this.index = 0, this.max = 0, this.data = null, this.type = "", this._tickScheduled = false, e2.then(function(e3) {
              t2.dataIsReady = true, t2.data = e3, t2.max = e3 && e3.length || 0, t2.type = n.getTypeOf(e3), t2.isPaused || t2._tickAndRepeat();
            }, function(e3) {
              t2.error(e3);
            });
          }
          n.inherits(s, i), s.prototype.cleanUp = function() {
            i.prototype.cleanUp.call(this), this.data = null;
          }, s.prototype.resume = function() {
            return !!i.prototype.resume.call(this) && (!this._tickScheduled && this.dataIsReady && (this._tickScheduled = true, n.delay(this._tickAndRepeat, [], this)), true);
          }, s.prototype._tickAndRepeat = function() {
            this._tickScheduled = false, this.isPaused || this.isFinished || (this._tick(), this.isFinished || (n.delay(this._tickAndRepeat, [], this), this._tickScheduled = true));
          }, s.prototype._tick = function() {
            if (this.isPaused || this.isFinished) return false;
            var e2 = null, t2 = Math.min(this.max, this.index + 16384);
            if (this.index >= this.max) return this.end();
            switch (this.type) {
              case "string":
                e2 = this.data.substring(this.index, t2);
                break;
              case "uint8array":
                e2 = this.data.subarray(this.index, t2);
                break;
              case "array":
              case "nodebuffer":
                e2 = this.data.slice(this.index, t2);
            }
            return this.index = t2, this.push({ data: e2, meta: { percent: this.max ? this.index / this.max * 100 : 0 } });
          }, t.exports = s;
        }, { "../utils": 32, "./GenericWorker": 28 }], 28: [function(e, t, r) {
          "use strict";
          function n(e2) {
            this.name = e2 || "default", this.streamInfo = {}, this.generatedError = null, this.extraStreamInfo = {}, this.isPaused = true, this.isFinished = false, this.isLocked = false, this._listeners = { data: [], end: [], error: [] }, this.previous = null;
          }
          n.prototype = { push: function(e2) {
            this.emit("data", e2);
          }, end: function() {
            if (this.isFinished) return false;
            this.flush();
            try {
              this.emit("end"), this.cleanUp(), this.isFinished = true;
            } catch (e2) {
              this.emit("error", e2);
            }
            return true;
          }, error: function(e2) {
            return !this.isFinished && (this.isPaused ? this.generatedError = e2 : (this.isFinished = true, this.emit("error", e2), this.previous && this.previous.error(e2), this.cleanUp()), true);
          }, on: function(e2, t2) {
            return this._listeners[e2].push(t2), this;
          }, cleanUp: function() {
            this.streamInfo = this.generatedError = this.extraStreamInfo = null, this._listeners = [];
          }, emit: function(e2, t2) {
            if (this._listeners[e2]) for (var r2 = 0; r2 < this._listeners[e2].length; r2++) this._listeners[e2][r2].call(this, t2);
          }, pipe: function(e2) {
            return e2.registerPrevious(this);
          }, registerPrevious: function(e2) {
            if (this.isLocked) throw new Error("The stream '" + this + "' has already been used.");
            this.streamInfo = e2.streamInfo, this.mergeStreamInfo(), this.previous = e2;
            var t2 = this;
            return e2.on("data", function(e3) {
              t2.processChunk(e3);
            }), e2.on("end", function() {
              t2.end();
            }), e2.on("error", function(e3) {
              t2.error(e3);
            }), this;
          }, pause: function() {
            return !this.isPaused && !this.isFinished && (this.isPaused = true, this.previous && this.previous.pause(), true);
          }, resume: function() {
            if (!this.isPaused || this.isFinished) return false;
            var e2 = this.isPaused = false;
            return this.generatedError && (this.error(this.generatedError), e2 = true), this.previous && this.previous.resume(), !e2;
          }, flush: function() {
          }, processChunk: function(e2) {
            this.push(e2);
          }, withStreamInfo: function(e2, t2) {
            return this.extraStreamInfo[e2] = t2, this.mergeStreamInfo(), this;
          }, mergeStreamInfo: function() {
            for (var e2 in this.extraStreamInfo) Object.prototype.hasOwnProperty.call(this.extraStreamInfo, e2) && (this.streamInfo[e2] = this.extraStreamInfo[e2]);
          }, lock: function() {
            if (this.isLocked) throw new Error("The stream '" + this + "' has already been used.");
            this.isLocked = true, this.previous && this.previous.lock();
          }, toString: function() {
            var e2 = "Worker " + this.name;
            return this.previous ? this.previous + " -> " + e2 : e2;
          } }, t.exports = n;
        }, {}], 29: [function(e, t, r) {
          "use strict";
          var h = e("../utils"), i = e("./ConvertWorker"), s = e("./GenericWorker"), u = e("../base64"), n = e("../support"), a = e("../external"), o = null;
          if (n.nodestream) try {
            o = e("../nodejs/NodejsStreamOutputAdapter");
          } catch (e2) {
          }
          function l(e2, o2) {
            return new a.Promise(function(t2, r2) {
              var n2 = [], i2 = e2._internalType, s2 = e2._outputType, a2 = e2._mimeType;
              e2.on("data", function(e3, t3) {
                n2.push(e3), o2 && o2(t3);
              }).on("error", function(e3) {
                n2 = [], r2(e3);
              }).on("end", function() {
                try {
                  var e3 = (function(e4, t3, r3) {
                    switch (e4) {
                      case "blob":
                        return h.newBlob(h.transformTo("arraybuffer", t3), r3);
                      case "base64":
                        return u.encode(t3);
                      default:
                        return h.transformTo(e4, t3);
                    }
                  })(s2, (function(e4, t3) {
                    var r3, n3 = 0, i3 = null, s3 = 0;
                    for (r3 = 0; r3 < t3.length; r3++) s3 += t3[r3].length;
                    switch (e4) {
                      case "string":
                        return t3.join("");
                      case "array":
                        return Array.prototype.concat.apply([], t3);
                      case "uint8array":
                        for (i3 = new Uint8Array(s3), r3 = 0; r3 < t3.length; r3++) i3.set(t3[r3], n3), n3 += t3[r3].length;
                        return i3;
                      case "nodebuffer":
                        return Buffer.concat(t3);
                      default:
                        throw new Error("concat : unsupported type '" + e4 + "'");
                    }
                  })(i2, n2), a2);
                  t2(e3);
                } catch (e4) {
                  r2(e4);
                }
                n2 = [];
              }).resume();
            });
          }
          function f(e2, t2, r2) {
            var n2 = t2;
            switch (t2) {
              case "blob":
              case "arraybuffer":
                n2 = "uint8array";
                break;
              case "base64":
                n2 = "string";
            }
            try {
              this._internalType = n2, this._outputType = t2, this._mimeType = r2, h.checkSupport(n2), this._worker = e2.pipe(new i(n2)), e2.lock();
            } catch (e3) {
              this._worker = new s("error"), this._worker.error(e3);
            }
          }
          f.prototype = { accumulate: function(e2) {
            return l(this, e2);
          }, on: function(e2, t2) {
            var r2 = this;
            return "data" === e2 ? this._worker.on(e2, function(e3) {
              t2.call(r2, e3.data, e3.meta);
            }) : this._worker.on(e2, function() {
              h.delay(t2, arguments, r2);
            }), this;
          }, resume: function() {
            return h.delay(this._worker.resume, [], this._worker), this;
          }, pause: function() {
            return this._worker.pause(), this;
          }, toNodejsStream: function(e2) {
            if (h.checkSupport("nodestream"), "nodebuffer" !== this._outputType) throw new Error(this._outputType + " is not supported by this method");
            return new o(this, { objectMode: "nodebuffer" !== this._outputType }, e2);
          } }, t.exports = f;
        }, { "../base64": 1, "../external": 6, "../nodejs/NodejsStreamOutputAdapter": 13, "../support": 30, "../utils": 32, "./ConvertWorker": 24, "./GenericWorker": 28 }], 30: [function(e, t, r) {
          "use strict";
          if (r.base64 = true, r.array = true, r.string = true, r.arraybuffer = "undefined" != typeof ArrayBuffer && "undefined" != typeof Uint8Array, r.nodebuffer = "undefined" != typeof Buffer, r.uint8array = "undefined" != typeof Uint8Array, "undefined" == typeof ArrayBuffer) r.blob = false;
          else {
            var n = new ArrayBuffer(0);
            try {
              r.blob = 0 === new Blob([n], { type: "application/zip" }).size;
            } catch (e2) {
              try {
                var i = new (self.BlobBuilder || self.WebKitBlobBuilder || self.MozBlobBuilder || self.MSBlobBuilder)();
                i.append(n), r.blob = 0 === i.getBlob("application/zip").size;
              } catch (e3) {
                r.blob = false;
              }
            }
          }
          try {
            r.nodestream = !!e("readable-stream").Readable;
          } catch (e2) {
            r.nodestream = false;
          }
        }, { "readable-stream": 16 }], 31: [function(e, t, s) {
          "use strict";
          for (var o = e("./utils"), h = e("./support"), r = e("./nodejsUtils"), n = e("./stream/GenericWorker"), u = new Array(256), i = 0; i < 256; i++) u[i] = 252 <= i ? 6 : 248 <= i ? 5 : 240 <= i ? 4 : 224 <= i ? 3 : 192 <= i ? 2 : 1;
          u[254] = u[254] = 1;
          function a() {
            n.call(this, "utf-8 decode"), this.leftOver = null;
          }
          function l() {
            n.call(this, "utf-8 encode");
          }
          s.utf8encode = function(e2) {
            return h.nodebuffer ? r.newBufferFrom(e2, "utf-8") : (function(e3) {
              var t2, r2, n2, i2, s2, a2 = e3.length, o2 = 0;
              for (i2 = 0; i2 < a2; i2++) 55296 == (64512 & (r2 = e3.charCodeAt(i2))) && i2 + 1 < a2 && 56320 == (64512 & (n2 = e3.charCodeAt(i2 + 1))) && (r2 = 65536 + (r2 - 55296 << 10) + (n2 - 56320), i2++), o2 += r2 < 128 ? 1 : r2 < 2048 ? 2 : r2 < 65536 ? 3 : 4;
              for (t2 = h.uint8array ? new Uint8Array(o2) : new Array(o2), i2 = s2 = 0; s2 < o2; i2++) 55296 == (64512 & (r2 = e3.charCodeAt(i2))) && i2 + 1 < a2 && 56320 == (64512 & (n2 = e3.charCodeAt(i2 + 1))) && (r2 = 65536 + (r2 - 55296 << 10) + (n2 - 56320), i2++), r2 < 128 ? t2[s2++] = r2 : (r2 < 2048 ? t2[s2++] = 192 | r2 >>> 6 : (r2 < 65536 ? t2[s2++] = 224 | r2 >>> 12 : (t2[s2++] = 240 | r2 >>> 18, t2[s2++] = 128 | r2 >>> 12 & 63), t2[s2++] = 128 | r2 >>> 6 & 63), t2[s2++] = 128 | 63 & r2);
              return t2;
            })(e2);
          }, s.utf8decode = function(e2) {
            return h.nodebuffer ? o.transformTo("nodebuffer", e2).toString("utf-8") : (function(e3) {
              var t2, r2, n2, i2, s2 = e3.length, a2 = new Array(2 * s2);
              for (t2 = r2 = 0; t2 < s2; ) if ((n2 = e3[t2++]) < 128) a2[r2++] = n2;
              else if (4 < (i2 = u[n2])) a2[r2++] = 65533, t2 += i2 - 1;
              else {
                for (n2 &= 2 === i2 ? 31 : 3 === i2 ? 15 : 7; 1 < i2 && t2 < s2; ) n2 = n2 << 6 | 63 & e3[t2++], i2--;
                1 < i2 ? a2[r2++] = 65533 : n2 < 65536 ? a2[r2++] = n2 : (n2 -= 65536, a2[r2++] = 55296 | n2 >> 10 & 1023, a2[r2++] = 56320 | 1023 & n2);
              }
              return a2.length !== r2 && (a2.subarray ? a2 = a2.subarray(0, r2) : a2.length = r2), o.applyFromCharCode(a2);
            })(e2 = o.transformTo(h.uint8array ? "uint8array" : "array", e2));
          }, o.inherits(a, n), a.prototype.processChunk = function(e2) {
            var t2 = o.transformTo(h.uint8array ? "uint8array" : "array", e2.data);
            if (this.leftOver && this.leftOver.length) {
              if (h.uint8array) {
                var r2 = t2;
                (t2 = new Uint8Array(r2.length + this.leftOver.length)).set(this.leftOver, 0), t2.set(r2, this.leftOver.length);
              } else t2 = this.leftOver.concat(t2);
              this.leftOver = null;
            }
            var n2 = (function(e3, t3) {
              var r3;
              for ((t3 = t3 || e3.length) > e3.length && (t3 = e3.length), r3 = t3 - 1; 0 <= r3 && 128 == (192 & e3[r3]); ) r3--;
              return r3 < 0 ? t3 : 0 === r3 ? t3 : r3 + u[e3[r3]] > t3 ? r3 : t3;
            })(t2), i2 = t2;
            n2 !== t2.length && (h.uint8array ? (i2 = t2.subarray(0, n2), this.leftOver = t2.subarray(n2, t2.length)) : (i2 = t2.slice(0, n2), this.leftOver = t2.slice(n2, t2.length))), this.push({ data: s.utf8decode(i2), meta: e2.meta });
          }, a.prototype.flush = function() {
            this.leftOver && this.leftOver.length && (this.push({ data: s.utf8decode(this.leftOver), meta: {} }), this.leftOver = null);
          }, s.Utf8DecodeWorker = a, o.inherits(l, n), l.prototype.processChunk = function(e2) {
            this.push({ data: s.utf8encode(e2.data), meta: e2.meta });
          }, s.Utf8EncodeWorker = l;
        }, { "./nodejsUtils": 14, "./stream/GenericWorker": 28, "./support": 30, "./utils": 32 }], 32: [function(e, t, a) {
          "use strict";
          var o = e("./support"), h = e("./base64"), r = e("./nodejsUtils"), u = e("./external");
          function n(e2) {
            return e2;
          }
          function l(e2, t2) {
            for (var r2 = 0; r2 < e2.length; ++r2) t2[r2] = 255 & e2.charCodeAt(r2);
            return t2;
          }
          e("setimmediate"), a.newBlob = function(t2, r2) {
            a.checkSupport("blob");
            try {
              return new Blob([t2], { type: r2 });
            } catch (e2) {
              try {
                var n2 = new (self.BlobBuilder || self.WebKitBlobBuilder || self.MozBlobBuilder || self.MSBlobBuilder)();
                return n2.append(t2), n2.getBlob(r2);
              } catch (e3) {
                throw new Error("Bug : can't construct the Blob.");
              }
            }
          };
          var i = { stringifyByChunk: function(e2, t2, r2) {
            var n2 = [], i2 = 0, s2 = e2.length;
            if (s2 <= r2) return String.fromCharCode.apply(null, e2);
            for (; i2 < s2; ) "array" === t2 || "nodebuffer" === t2 ? n2.push(String.fromCharCode.apply(null, e2.slice(i2, Math.min(i2 + r2, s2)))) : n2.push(String.fromCharCode.apply(null, e2.subarray(i2, Math.min(i2 + r2, s2)))), i2 += r2;
            return n2.join("");
          }, stringifyByChar: function(e2) {
            for (var t2 = "", r2 = 0; r2 < e2.length; r2++) t2 += String.fromCharCode(e2[r2]);
            return t2;
          }, applyCanBeUsed: { uint8array: (function() {
            try {
              return o.uint8array && 1 === String.fromCharCode.apply(null, new Uint8Array(1)).length;
            } catch (e2) {
              return false;
            }
          })(), nodebuffer: (function() {
            try {
              return o.nodebuffer && 1 === String.fromCharCode.apply(null, r.allocBuffer(1)).length;
            } catch (e2) {
              return false;
            }
          })() } };
          function s(e2) {
            var t2 = 65536, r2 = a.getTypeOf(e2), n2 = true;
            if ("uint8array" === r2 ? n2 = i.applyCanBeUsed.uint8array : "nodebuffer" === r2 && (n2 = i.applyCanBeUsed.nodebuffer), n2) for (; 1 < t2; ) try {
              return i.stringifyByChunk(e2, r2, t2);
            } catch (e3) {
              t2 = Math.floor(t2 / 2);
            }
            return i.stringifyByChar(e2);
          }
          function f(e2, t2) {
            for (var r2 = 0; r2 < e2.length; r2++) t2[r2] = e2[r2];
            return t2;
          }
          a.applyFromCharCode = s;
          var c = {};
          c.string = { string: n, array: function(e2) {
            return l(e2, new Array(e2.length));
          }, arraybuffer: function(e2) {
            return c.string.uint8array(e2).buffer;
          }, uint8array: function(e2) {
            return l(e2, new Uint8Array(e2.length));
          }, nodebuffer: function(e2) {
            return l(e2, r.allocBuffer(e2.length));
          } }, c.array = { string: s, array: n, arraybuffer: function(e2) {
            return new Uint8Array(e2).buffer;
          }, uint8array: function(e2) {
            return new Uint8Array(e2);
          }, nodebuffer: function(e2) {
            return r.newBufferFrom(e2);
          } }, c.arraybuffer = { string: function(e2) {
            return s(new Uint8Array(e2));
          }, array: function(e2) {
            return f(new Uint8Array(e2), new Array(e2.byteLength));
          }, arraybuffer: n, uint8array: function(e2) {
            return new Uint8Array(e2);
          }, nodebuffer: function(e2) {
            return r.newBufferFrom(new Uint8Array(e2));
          } }, c.uint8array = { string: s, array: function(e2) {
            return f(e2, new Array(e2.length));
          }, arraybuffer: function(e2) {
            return e2.buffer;
          }, uint8array: n, nodebuffer: function(e2) {
            return r.newBufferFrom(e2);
          } }, c.nodebuffer = { string: s, array: function(e2) {
            return f(e2, new Array(e2.length));
          }, arraybuffer: function(e2) {
            return c.nodebuffer.uint8array(e2).buffer;
          }, uint8array: function(e2) {
            return f(e2, new Uint8Array(e2.length));
          }, nodebuffer: n }, a.transformTo = function(e2, t2) {
            if (t2 = t2 || "", !e2) return t2;
            a.checkSupport(e2);
            var r2 = a.getTypeOf(t2);
            return c[r2][e2](t2);
          }, a.resolve = function(e2) {
            for (var t2 = e2.split("/"), r2 = [], n2 = 0; n2 < t2.length; n2++) {
              var i2 = t2[n2];
              "." === i2 || "" === i2 && 0 !== n2 && n2 !== t2.length - 1 || (".." === i2 ? r2.pop() : r2.push(i2));
            }
            return r2.join("/");
          }, a.getTypeOf = function(e2) {
            return "string" == typeof e2 ? "string" : "[object Array]" === Object.prototype.toString.call(e2) ? "array" : o.nodebuffer && r.isBuffer(e2) ? "nodebuffer" : o.uint8array && e2 instanceof Uint8Array ? "uint8array" : o.arraybuffer && e2 instanceof ArrayBuffer ? "arraybuffer" : void 0;
          }, a.checkSupport = function(e2) {
            if (!o[e2.toLowerCase()]) throw new Error(e2 + " is not supported by this platform");
          }, a.MAX_VALUE_16BITS = 65535, a.MAX_VALUE_32BITS = -1, a.pretty = function(e2) {
            var t2, r2, n2 = "";
            for (r2 = 0; r2 < (e2 || "").length; r2++) n2 += "\\x" + ((t2 = e2.charCodeAt(r2)) < 16 ? "0" : "") + t2.toString(16).toUpperCase();
            return n2;
          }, a.delay = function(e2, t2, r2) {
            setImmediate(function() {
              e2.apply(r2 || null, t2 || []);
            });
          }, a.inherits = function(e2, t2) {
            function r2() {
            }
            r2.prototype = t2.prototype, e2.prototype = new r2();
          }, a.extend = function() {
            var e2, t2, r2 = {};
            for (e2 = 0; e2 < arguments.length; e2++) for (t2 in arguments[e2]) Object.prototype.hasOwnProperty.call(arguments[e2], t2) && void 0 === r2[t2] && (r2[t2] = arguments[e2][t2]);
            return r2;
          }, a.prepareContent = function(r2, e2, n2, i2, s2) {
            return u.Promise.resolve(e2).then(function(n3) {
              return o.blob && (n3 instanceof Blob || -1 !== ["[object File]", "[object Blob]"].indexOf(Object.prototype.toString.call(n3))) && "undefined" != typeof FileReader ? new u.Promise(function(t2, r3) {
                var e3 = new FileReader();
                e3.onload = function(e4) {
                  t2(e4.target.result);
                }, e3.onerror = function(e4) {
                  r3(e4.target.error);
                }, e3.readAsArrayBuffer(n3);
              }) : n3;
            }).then(function(e3) {
              var t2 = a.getTypeOf(e3);
              return t2 ? ("arraybuffer" === t2 ? e3 = a.transformTo("uint8array", e3) : "string" === t2 && (s2 ? e3 = h.decode(e3) : n2 && true !== i2 && (e3 = (function(e4) {
                return l(e4, o.uint8array ? new Uint8Array(e4.length) : new Array(e4.length));
              })(e3))), e3) : u.Promise.reject(new Error("Can't read the data of '" + r2 + "'. Is it in a supported JavaScript type (String, Blob, ArrayBuffer, etc) ?"));
            });
          };
        }, { "./base64": 1, "./external": 6, "./nodejsUtils": 14, "./support": 30, setimmediate: 54 }], 33: [function(e, t, r) {
          "use strict";
          var n = e("./reader/readerFor"), i = e("./utils"), s = e("./signature"), a = e("./zipEntry"), o = e("./support");
          function h(e2) {
            this.files = [], this.loadOptions = e2;
          }
          h.prototype = { checkSignature: function(e2) {
            if (!this.reader.readAndCheckSignature(e2)) {
              this.reader.index -= 4;
              var t2 = this.reader.readString(4);
              throw new Error("Corrupted zip or bug: unexpected signature (" + i.pretty(t2) + ", expected " + i.pretty(e2) + ")");
            }
          }, isSignature: function(e2, t2) {
            var r2 = this.reader.index;
            this.reader.setIndex(e2);
            var n2 = this.reader.readString(4) === t2;
            return this.reader.setIndex(r2), n2;
          }, readBlockEndOfCentral: function() {
            this.diskNumber = this.reader.readInt(2), this.diskWithCentralDirStart = this.reader.readInt(2), this.centralDirRecordsOnThisDisk = this.reader.readInt(2), this.centralDirRecords = this.reader.readInt(2), this.centralDirSize = this.reader.readInt(4), this.centralDirOffset = this.reader.readInt(4), this.zipCommentLength = this.reader.readInt(2);
            var e2 = this.reader.readData(this.zipCommentLength), t2 = o.uint8array ? "uint8array" : "array", r2 = i.transformTo(t2, e2);
            this.zipComment = this.loadOptions.decodeFileName(r2);
          }, readBlockZip64EndOfCentral: function() {
            this.zip64EndOfCentralSize = this.reader.readInt(8), this.reader.skip(4), this.diskNumber = this.reader.readInt(4), this.diskWithCentralDirStart = this.reader.readInt(4), this.centralDirRecordsOnThisDisk = this.reader.readInt(8), this.centralDirRecords = this.reader.readInt(8), this.centralDirSize = this.reader.readInt(8), this.centralDirOffset = this.reader.readInt(8), this.zip64ExtensibleData = {};
            for (var e2, t2, r2, n2 = this.zip64EndOfCentralSize - 44; 0 < n2; ) e2 = this.reader.readInt(2), t2 = this.reader.readInt(4), r2 = this.reader.readData(t2), this.zip64ExtensibleData[e2] = { id: e2, length: t2, value: r2 };
          }, readBlockZip64EndOfCentralLocator: function() {
            if (this.diskWithZip64CentralDirStart = this.reader.readInt(4), this.relativeOffsetEndOfZip64CentralDir = this.reader.readInt(8), this.disksCount = this.reader.readInt(4), 1 < this.disksCount) throw new Error("Multi-volumes zip are not supported");
          }, readLocalFiles: function() {
            var e2, t2;
            for (e2 = 0; e2 < this.files.length; e2++) t2 = this.files[e2], this.reader.setIndex(t2.localHeaderOffset), this.checkSignature(s.LOCAL_FILE_HEADER), t2.readLocalPart(this.reader), t2.handleUTF8(), t2.processAttributes();
          }, readCentralDir: function() {
            var e2;
            for (this.reader.setIndex(this.centralDirOffset); this.reader.readAndCheckSignature(s.CENTRAL_FILE_HEADER); ) (e2 = new a({ zip64: this.zip64 }, this.loadOptions)).readCentralPart(this.reader), this.files.push(e2);
            if (this.centralDirRecords !== this.files.length && 0 !== this.centralDirRecords && 0 === this.files.length) throw new Error("Corrupted zip or bug: expected " + this.centralDirRecords + " records in central dir, got " + this.files.length);
          }, readEndOfCentral: function() {
            var e2 = this.reader.lastIndexOfSignature(s.CENTRAL_DIRECTORY_END);
            if (e2 < 0) throw !this.isSignature(0, s.LOCAL_FILE_HEADER) ? new Error("Can't find end of central directory : is this a zip file ? If it is, see https://stuk.github.io/jszip/documentation/howto/read_zip.html") : new Error("Corrupted zip: can't find end of central directory");
            this.reader.setIndex(e2);
            var t2 = e2;
            if (this.checkSignature(s.CENTRAL_DIRECTORY_END), this.readBlockEndOfCentral(), this.diskNumber === i.MAX_VALUE_16BITS || this.diskWithCentralDirStart === i.MAX_VALUE_16BITS || this.centralDirRecordsOnThisDisk === i.MAX_VALUE_16BITS || this.centralDirRecords === i.MAX_VALUE_16BITS || this.centralDirSize === i.MAX_VALUE_32BITS || this.centralDirOffset === i.MAX_VALUE_32BITS) {
              if (this.zip64 = true, (e2 = this.reader.lastIndexOfSignature(s.ZIP64_CENTRAL_DIRECTORY_LOCATOR)) < 0) throw new Error("Corrupted zip: can't find the ZIP64 end of central directory locator");
              if (this.reader.setIndex(e2), this.checkSignature(s.ZIP64_CENTRAL_DIRECTORY_LOCATOR), this.readBlockZip64EndOfCentralLocator(), !this.isSignature(this.relativeOffsetEndOfZip64CentralDir, s.ZIP64_CENTRAL_DIRECTORY_END) && (this.relativeOffsetEndOfZip64CentralDir = this.reader.lastIndexOfSignature(s.ZIP64_CENTRAL_DIRECTORY_END), this.relativeOffsetEndOfZip64CentralDir < 0)) throw new Error("Corrupted zip: can't find the ZIP64 end of central directory");
              this.reader.setIndex(this.relativeOffsetEndOfZip64CentralDir), this.checkSignature(s.ZIP64_CENTRAL_DIRECTORY_END), this.readBlockZip64EndOfCentral();
            }
            var r2 = this.centralDirOffset + this.centralDirSize;
            this.zip64 && (r2 += 20, r2 += 12 + this.zip64EndOfCentralSize);
            var n2 = t2 - r2;
            if (0 < n2) this.isSignature(t2, s.CENTRAL_FILE_HEADER) || (this.reader.zero = n2);
            else if (n2 < 0) throw new Error("Corrupted zip: missing " + Math.abs(n2) + " bytes.");
          }, prepareReader: function(e2) {
            this.reader = n(e2);
          }, load: function(e2) {
            this.prepareReader(e2), this.readEndOfCentral(), this.readCentralDir(), this.readLocalFiles();
          } }, t.exports = h;
        }, { "./reader/readerFor": 22, "./signature": 23, "./support": 30, "./utils": 32, "./zipEntry": 34 }], 34: [function(e, t, r) {
          "use strict";
          var n = e("./reader/readerFor"), s = e("./utils"), i = e("./compressedObject"), a = e("./crc32"), o = e("./utf8"), h = e("./compressions"), u = e("./support");
          function l(e2, t2) {
            this.options = e2, this.loadOptions = t2;
          }
          l.prototype = { isEncrypted: function() {
            return 1 == (1 & this.bitFlag);
          }, useUTF8: function() {
            return 2048 == (2048 & this.bitFlag);
          }, readLocalPart: function(e2) {
            var t2, r2;
            if (e2.skip(22), this.fileNameLength = e2.readInt(2), r2 = e2.readInt(2), this.fileName = e2.readData(this.fileNameLength), e2.skip(r2), -1 === this.compressedSize || -1 === this.uncompressedSize) throw new Error("Bug or corrupted zip : didn't get enough information from the central directory (compressedSize === -1 || uncompressedSize === -1)");
            if (null === (t2 = (function(e3) {
              for (var t3 in h) if (Object.prototype.hasOwnProperty.call(h, t3) && h[t3].magic === e3) return h[t3];
              return null;
            })(this.compressionMethod))) throw new Error("Corrupted zip : compression " + s.pretty(this.compressionMethod) + " unknown (inner file : " + s.transformTo("string", this.fileName) + ")");
            this.decompressed = new i(this.compressedSize, this.uncompressedSize, this.crc32, t2, e2.readData(this.compressedSize));
          }, readCentralPart: function(e2) {
            this.versionMadeBy = e2.readInt(2), e2.skip(2), this.bitFlag = e2.readInt(2), this.compressionMethod = e2.readString(2), this.date = e2.readDate(), this.crc32 = e2.readInt(4), this.compressedSize = e2.readInt(4), this.uncompressedSize = e2.readInt(4);
            var t2 = e2.readInt(2);
            if (this.extraFieldsLength = e2.readInt(2), this.fileCommentLength = e2.readInt(2), this.diskNumberStart = e2.readInt(2), this.internalFileAttributes = e2.readInt(2), this.externalFileAttributes = e2.readInt(4), this.localHeaderOffset = e2.readInt(4), this.isEncrypted()) throw new Error("Encrypted zip are not supported");
            e2.skip(t2), this.readExtraFields(e2), this.parseZIP64ExtraField(e2), this.fileComment = e2.readData(this.fileCommentLength);
          }, processAttributes: function() {
            this.unixPermissions = null, this.dosPermissions = null;
            var e2 = this.versionMadeBy >> 8;
            this.dir = !!(16 & this.externalFileAttributes), 0 == e2 && (this.dosPermissions = 63 & this.externalFileAttributes), 3 == e2 && (this.unixPermissions = this.externalFileAttributes >> 16 & 65535), this.dir || "/" !== this.fileNameStr.slice(-1) || (this.dir = true);
          }, parseZIP64ExtraField: function() {
            if (this.extraFields[1]) {
              var e2 = n(this.extraFields[1].value);
              this.uncompressedSize === s.MAX_VALUE_32BITS && (this.uncompressedSize = e2.readInt(8)), this.compressedSize === s.MAX_VALUE_32BITS && (this.compressedSize = e2.readInt(8)), this.localHeaderOffset === s.MAX_VALUE_32BITS && (this.localHeaderOffset = e2.readInt(8)), this.diskNumberStart === s.MAX_VALUE_32BITS && (this.diskNumberStart = e2.readInt(4));
            }
          }, readExtraFields: function(e2) {
            var t2, r2, n2, i2 = e2.index + this.extraFieldsLength;
            for (this.extraFields || (this.extraFields = {}); e2.index + 4 < i2; ) t2 = e2.readInt(2), r2 = e2.readInt(2), n2 = e2.readData(r2), this.extraFields[t2] = { id: t2, length: r2, value: n2 };
            e2.setIndex(i2);
          }, handleUTF8: function() {
            var e2 = u.uint8array ? "uint8array" : "array";
            if (this.useUTF8()) this.fileNameStr = o.utf8decode(this.fileName), this.fileCommentStr = o.utf8decode(this.fileComment);
            else {
              var t2 = this.findExtraFieldUnicodePath();
              if (null !== t2) this.fileNameStr = t2;
              else {
                var r2 = s.transformTo(e2, this.fileName);
                this.fileNameStr = this.loadOptions.decodeFileName(r2);
              }
              var n2 = this.findExtraFieldUnicodeComment();
              if (null !== n2) this.fileCommentStr = n2;
              else {
                var i2 = s.transformTo(e2, this.fileComment);
                this.fileCommentStr = this.loadOptions.decodeFileName(i2);
              }
            }
          }, findExtraFieldUnicodePath: function() {
            var e2 = this.extraFields[28789];
            if (e2) {
              var t2 = n(e2.value);
              return 1 !== t2.readInt(1) ? null : a(this.fileName) !== t2.readInt(4) ? null : o.utf8decode(t2.readData(e2.length - 5));
            }
            return null;
          }, findExtraFieldUnicodeComment: function() {
            var e2 = this.extraFields[25461];
            if (e2) {
              var t2 = n(e2.value);
              return 1 !== t2.readInt(1) ? null : a(this.fileComment) !== t2.readInt(4) ? null : o.utf8decode(t2.readData(e2.length - 5));
            }
            return null;
          } }, t.exports = l;
        }, { "./compressedObject": 2, "./compressions": 3, "./crc32": 4, "./reader/readerFor": 22, "./support": 30, "./utf8": 31, "./utils": 32 }], 35: [function(e, t, r) {
          "use strict";
          function n(e2, t2, r2) {
            this.name = e2, this.dir = r2.dir, this.date = r2.date, this.comment = r2.comment, this.unixPermissions = r2.unixPermissions, this.dosPermissions = r2.dosPermissions, this._data = t2, this._dataBinary = r2.binary, this.options = { compression: r2.compression, compressionOptions: r2.compressionOptions };
          }
          var s = e("./stream/StreamHelper"), i = e("./stream/DataWorker"), a = e("./utf8"), o = e("./compressedObject"), h = e("./stream/GenericWorker");
          n.prototype = { internalStream: function(e2) {
            var t2 = null, r2 = "string";
            try {
              if (!e2) throw new Error("No output type specified.");
              var n2 = "string" === (r2 = e2.toLowerCase()) || "text" === r2;
              "binarystring" !== r2 && "text" !== r2 || (r2 = "string"), t2 = this._decompressWorker();
              var i2 = !this._dataBinary;
              i2 && !n2 && (t2 = t2.pipe(new a.Utf8EncodeWorker())), !i2 && n2 && (t2 = t2.pipe(new a.Utf8DecodeWorker()));
            } catch (e3) {
              (t2 = new h("error")).error(e3);
            }
            return new s(t2, r2, "");
          }, async: function(e2, t2) {
            return this.internalStream(e2).accumulate(t2);
          }, nodeStream: function(e2, t2) {
            return this.internalStream(e2 || "nodebuffer").toNodejsStream(t2);
          }, _compressWorker: function(e2, t2) {
            if (this._data instanceof o && this._data.compression.magic === e2.magic) return this._data.getCompressedWorker();
            var r2 = this._decompressWorker();
            return this._dataBinary || (r2 = r2.pipe(new a.Utf8EncodeWorker())), o.createWorkerFrom(r2, e2, t2);
          }, _decompressWorker: function() {
            return this._data instanceof o ? this._data.getContentWorker() : this._data instanceof h ? this._data : new i(this._data);
          } };
          for (var u = ["asText", "asBinary", "asNodeBuffer", "asUint8Array", "asArrayBuffer"], l = function() {
            throw new Error("This method has been removed in JSZip 3.0, please check the upgrade guide.");
          }, f = 0; f < u.length; f++) n.prototype[u[f]] = l;
          t.exports = n;
        }, { "./compressedObject": 2, "./stream/DataWorker": 27, "./stream/GenericWorker": 28, "./stream/StreamHelper": 29, "./utf8": 31 }], 36: [function(e, l, t) {
          (function(t2) {
            "use strict";
            var r, n, e2 = t2.MutationObserver || t2.WebKitMutationObserver;
            if (e2) {
              var i = 0, s = new e2(u), a = t2.document.createTextNode("");
              s.observe(a, { characterData: true }), r = function() {
                a.data = i = ++i % 2;
              };
            } else if (t2.setImmediate || void 0 === t2.MessageChannel) r = "document" in t2 && "onreadystatechange" in t2.document.createElement("script") ? function() {
              var e3 = t2.document.createElement("script");
              e3.onreadystatechange = function() {
                u(), e3.onreadystatechange = null, e3.parentNode.removeChild(e3), e3 = null;
              }, t2.document.documentElement.appendChild(e3);
            } : function() {
              setTimeout(u, 0);
            };
            else {
              var o = new t2.MessageChannel();
              o.port1.onmessage = u, r = function() {
                o.port2.postMessage(0);
              };
            }
            var h = [];
            function u() {
              var e3, t3;
              n = true;
              for (var r2 = h.length; r2; ) {
                for (t3 = h, h = [], e3 = -1; ++e3 < r2; ) t3[e3]();
                r2 = h.length;
              }
              n = false;
            }
            l.exports = function(e3) {
              1 !== h.push(e3) || n || r();
            };
          }).call(this, "undefined" != typeof global ? global : "undefined" != typeof self ? self : "undefined" != typeof window ? window : {});
        }, {}], 37: [function(e, t, r) {
          "use strict";
          var i = e("immediate");
          function u() {
          }
          var l = {}, s = ["REJECTED"], a = ["FULFILLED"], n = ["PENDING"];
          function o(e2) {
            if ("function" != typeof e2) throw new TypeError("resolver must be a function");
            this.state = n, this.queue = [], this.outcome = void 0, e2 !== u && d(this, e2);
          }
          function h(e2, t2, r2) {
            this.promise = e2, "function" == typeof t2 && (this.onFulfilled = t2, this.callFulfilled = this.otherCallFulfilled), "function" == typeof r2 && (this.onRejected = r2, this.callRejected = this.otherCallRejected);
          }
          function f(t2, r2, n2) {
            i(function() {
              var e2;
              try {
                e2 = r2(n2);
              } catch (e3) {
                return l.reject(t2, e3);
              }
              e2 === t2 ? l.reject(t2, new TypeError("Cannot resolve promise with itself")) : l.resolve(t2, e2);
            });
          }
          function c(e2) {
            var t2 = e2 && e2.then;
            if (e2 && ("object" == typeof e2 || "function" == typeof e2) && "function" == typeof t2) return function() {
              t2.apply(e2, arguments);
            };
          }
          function d(t2, e2) {
            var r2 = false;
            function n2(e3) {
              r2 || (r2 = true, l.reject(t2, e3));
            }
            function i2(e3) {
              r2 || (r2 = true, l.resolve(t2, e3));
            }
            var s2 = p(function() {
              e2(i2, n2);
            });
            "error" === s2.status && n2(s2.value);
          }
          function p(e2, t2) {
            var r2 = {};
            try {
              r2.value = e2(t2), r2.status = "success";
            } catch (e3) {
              r2.status = "error", r2.value = e3;
            }
            return r2;
          }
          (t.exports = o).prototype.finally = function(t2) {
            if ("function" != typeof t2) return this;
            var r2 = this.constructor;
            return this.then(function(e2) {
              return r2.resolve(t2()).then(function() {
                return e2;
              });
            }, function(e2) {
              return r2.resolve(t2()).then(function() {
                throw e2;
              });
            });
          }, o.prototype.catch = function(e2) {
            return this.then(null, e2);
          }, o.prototype.then = function(e2, t2) {
            if ("function" != typeof e2 && this.state === a || "function" != typeof t2 && this.state === s) return this;
            var r2 = new this.constructor(u);
            this.state !== n ? f(r2, this.state === a ? e2 : t2, this.outcome) : this.queue.push(new h(r2, e2, t2));
            return r2;
          }, h.prototype.callFulfilled = function(e2) {
            l.resolve(this.promise, e2);
          }, h.prototype.otherCallFulfilled = function(e2) {
            f(this.promise, this.onFulfilled, e2);
          }, h.prototype.callRejected = function(e2) {
            l.reject(this.promise, e2);
          }, h.prototype.otherCallRejected = function(e2) {
            f(this.promise, this.onRejected, e2);
          }, l.resolve = function(e2, t2) {
            var r2 = p(c, t2);
            if ("error" === r2.status) return l.reject(e2, r2.value);
            var n2 = r2.value;
            if (n2) d(e2, n2);
            else {
              e2.state = a, e2.outcome = t2;
              for (var i2 = -1, s2 = e2.queue.length; ++i2 < s2; ) e2.queue[i2].callFulfilled(t2);
            }
            return e2;
          }, l.reject = function(e2, t2) {
            e2.state = s, e2.outcome = t2;
            for (var r2 = -1, n2 = e2.queue.length; ++r2 < n2; ) e2.queue[r2].callRejected(t2);
            return e2;
          }, o.resolve = function(e2) {
            if (e2 instanceof this) return e2;
            return l.resolve(new this(u), e2);
          }, o.reject = function(e2) {
            var t2 = new this(u);
            return l.reject(t2, e2);
          }, o.all = function(e2) {
            var r2 = this;
            if ("[object Array]" !== Object.prototype.toString.call(e2)) return this.reject(new TypeError("must be an array"));
            var n2 = e2.length, i2 = false;
            if (!n2) return this.resolve([]);
            var s2 = new Array(n2), a2 = 0, t2 = -1, o2 = new this(u);
            for (; ++t2 < n2; ) h2(e2[t2], t2);
            return o2;
            function h2(e3, t3) {
              r2.resolve(e3).then(function(e4) {
                s2[t3] = e4, ++a2 !== n2 || i2 || (i2 = true, l.resolve(o2, s2));
              }, function(e4) {
                i2 || (i2 = true, l.reject(o2, e4));
              });
            }
          }, o.race = function(e2) {
            var t2 = this;
            if ("[object Array]" !== Object.prototype.toString.call(e2)) return this.reject(new TypeError("must be an array"));
            var r2 = e2.length, n2 = false;
            if (!r2) return this.resolve([]);
            var i2 = -1, s2 = new this(u);
            for (; ++i2 < r2; ) a2 = e2[i2], t2.resolve(a2).then(function(e3) {
              n2 || (n2 = true, l.resolve(s2, e3));
            }, function(e3) {
              n2 || (n2 = true, l.reject(s2, e3));
            });
            var a2;
            return s2;
          };
        }, { immediate: 36 }], 38: [function(e, t, r) {
          "use strict";
          var n = {};
          (0, e("./lib/utils/common").assign)(n, e("./lib/deflate"), e("./lib/inflate"), e("./lib/zlib/constants")), t.exports = n;
        }, { "./lib/deflate": 39, "./lib/inflate": 40, "./lib/utils/common": 41, "./lib/zlib/constants": 44 }], 39: [function(e, t, r) {
          "use strict";
          var a = e("./zlib/deflate"), o = e("./utils/common"), h = e("./utils/strings"), i = e("./zlib/messages"), s = e("./zlib/zstream"), u = Object.prototype.toString, l = 0, f = -1, c = 0, d = 8;
          function p(e2) {
            if (!(this instanceof p)) return new p(e2);
            this.options = o.assign({ level: f, method: d, chunkSize: 16384, windowBits: 15, memLevel: 8, strategy: c, to: "" }, e2 || {});
            var t2 = this.options;
            t2.raw && 0 < t2.windowBits ? t2.windowBits = -t2.windowBits : t2.gzip && 0 < t2.windowBits && t2.windowBits < 16 && (t2.windowBits += 16), this.err = 0, this.msg = "", this.ended = false, this.chunks = [], this.strm = new s(), this.strm.avail_out = 0;
            var r2 = a.deflateInit2(this.strm, t2.level, t2.method, t2.windowBits, t2.memLevel, t2.strategy);
            if (r2 !== l) throw new Error(i[r2]);
            if (t2.header && a.deflateSetHeader(this.strm, t2.header), t2.dictionary) {
              var n2;
              if (n2 = "string" == typeof t2.dictionary ? h.string2buf(t2.dictionary) : "[object ArrayBuffer]" === u.call(t2.dictionary) ? new Uint8Array(t2.dictionary) : t2.dictionary, (r2 = a.deflateSetDictionary(this.strm, n2)) !== l) throw new Error(i[r2]);
              this._dict_set = true;
            }
          }
          function n(e2, t2) {
            var r2 = new p(t2);
            if (r2.push(e2, true), r2.err) throw r2.msg || i[r2.err];
            return r2.result;
          }
          p.prototype.push = function(e2, t2) {
            var r2, n2, i2 = this.strm, s2 = this.options.chunkSize;
            if (this.ended) return false;
            n2 = t2 === ~~t2 ? t2 : true === t2 ? 4 : 0, "string" == typeof e2 ? i2.input = h.string2buf(e2) : "[object ArrayBuffer]" === u.call(e2) ? i2.input = new Uint8Array(e2) : i2.input = e2, i2.next_in = 0, i2.avail_in = i2.input.length;
            do {
              if (0 === i2.avail_out && (i2.output = new o.Buf8(s2), i2.next_out = 0, i2.avail_out = s2), 1 !== (r2 = a.deflate(i2, n2)) && r2 !== l) return this.onEnd(r2), !(this.ended = true);
              0 !== i2.avail_out && (0 !== i2.avail_in || 4 !== n2 && 2 !== n2) || ("string" === this.options.to ? this.onData(h.buf2binstring(o.shrinkBuf(i2.output, i2.next_out))) : this.onData(o.shrinkBuf(i2.output, i2.next_out)));
            } while ((0 < i2.avail_in || 0 === i2.avail_out) && 1 !== r2);
            return 4 === n2 ? (r2 = a.deflateEnd(this.strm), this.onEnd(r2), this.ended = true, r2 === l) : 2 !== n2 || (this.onEnd(l), !(i2.avail_out = 0));
          }, p.prototype.onData = function(e2) {
            this.chunks.push(e2);
          }, p.prototype.onEnd = function(e2) {
            e2 === l && ("string" === this.options.to ? this.result = this.chunks.join("") : this.result = o.flattenChunks(this.chunks)), this.chunks = [], this.err = e2, this.msg = this.strm.msg;
          }, r.Deflate = p, r.deflate = n, r.deflateRaw = function(e2, t2) {
            return (t2 = t2 || {}).raw = true, n(e2, t2);
          }, r.gzip = function(e2, t2) {
            return (t2 = t2 || {}).gzip = true, n(e2, t2);
          };
        }, { "./utils/common": 41, "./utils/strings": 42, "./zlib/deflate": 46, "./zlib/messages": 51, "./zlib/zstream": 53 }], 40: [function(e, t, r) {
          "use strict";
          var c = e("./zlib/inflate"), d = e("./utils/common"), p = e("./utils/strings"), m = e("./zlib/constants"), n = e("./zlib/messages"), i = e("./zlib/zstream"), s = e("./zlib/gzheader"), _ = Object.prototype.toString;
          function a(e2) {
            if (!(this instanceof a)) return new a(e2);
            this.options = d.assign({ chunkSize: 16384, windowBits: 0, to: "" }, e2 || {});
            var t2 = this.options;
            t2.raw && 0 <= t2.windowBits && t2.windowBits < 16 && (t2.windowBits = -t2.windowBits, 0 === t2.windowBits && (t2.windowBits = -15)), !(0 <= t2.windowBits && t2.windowBits < 16) || e2 && e2.windowBits || (t2.windowBits += 32), 15 < t2.windowBits && t2.windowBits < 48 && 0 == (15 & t2.windowBits) && (t2.windowBits |= 15), this.err = 0, this.msg = "", this.ended = false, this.chunks = [], this.strm = new i(), this.strm.avail_out = 0;
            var r2 = c.inflateInit2(this.strm, t2.windowBits);
            if (r2 !== m.Z_OK) throw new Error(n[r2]);
            this.header = new s(), c.inflateGetHeader(this.strm, this.header);
          }
          function o(e2, t2) {
            var r2 = new a(t2);
            if (r2.push(e2, true), r2.err) throw r2.msg || n[r2.err];
            return r2.result;
          }
          a.prototype.push = function(e2, t2) {
            var r2, n2, i2, s2, a2, o2, h = this.strm, u = this.options.chunkSize, l = this.options.dictionary, f = false;
            if (this.ended) return false;
            n2 = t2 === ~~t2 ? t2 : true === t2 ? m.Z_FINISH : m.Z_NO_FLUSH, "string" == typeof e2 ? h.input = p.binstring2buf(e2) : "[object ArrayBuffer]" === _.call(e2) ? h.input = new Uint8Array(e2) : h.input = e2, h.next_in = 0, h.avail_in = h.input.length;
            do {
              if (0 === h.avail_out && (h.output = new d.Buf8(u), h.next_out = 0, h.avail_out = u), (r2 = c.inflate(h, m.Z_NO_FLUSH)) === m.Z_NEED_DICT && l && (o2 = "string" == typeof l ? p.string2buf(l) : "[object ArrayBuffer]" === _.call(l) ? new Uint8Array(l) : l, r2 = c.inflateSetDictionary(this.strm, o2)), r2 === m.Z_BUF_ERROR && true === f && (r2 = m.Z_OK, f = false), r2 !== m.Z_STREAM_END && r2 !== m.Z_OK) return this.onEnd(r2), !(this.ended = true);
              h.next_out && (0 !== h.avail_out && r2 !== m.Z_STREAM_END && (0 !== h.avail_in || n2 !== m.Z_FINISH && n2 !== m.Z_SYNC_FLUSH) || ("string" === this.options.to ? (i2 = p.utf8border(h.output, h.next_out), s2 = h.next_out - i2, a2 = p.buf2string(h.output, i2), h.next_out = s2, h.avail_out = u - s2, s2 && d.arraySet(h.output, h.output, i2, s2, 0), this.onData(a2)) : this.onData(d.shrinkBuf(h.output, h.next_out)))), 0 === h.avail_in && 0 === h.avail_out && (f = true);
            } while ((0 < h.avail_in || 0 === h.avail_out) && r2 !== m.Z_STREAM_END);
            return r2 === m.Z_STREAM_END && (n2 = m.Z_FINISH), n2 === m.Z_FINISH ? (r2 = c.inflateEnd(this.strm), this.onEnd(r2), this.ended = true, r2 === m.Z_OK) : n2 !== m.Z_SYNC_FLUSH || (this.onEnd(m.Z_OK), !(h.avail_out = 0));
          }, a.prototype.onData = function(e2) {
            this.chunks.push(e2);
          }, a.prototype.onEnd = function(e2) {
            e2 === m.Z_OK && ("string" === this.options.to ? this.result = this.chunks.join("") : this.result = d.flattenChunks(this.chunks)), this.chunks = [], this.err = e2, this.msg = this.strm.msg;
          }, r.Inflate = a, r.inflate = o, r.inflateRaw = function(e2, t2) {
            return (t2 = t2 || {}).raw = true, o(e2, t2);
          }, r.ungzip = o;
        }, { "./utils/common": 41, "./utils/strings": 42, "./zlib/constants": 44, "./zlib/gzheader": 47, "./zlib/inflate": 49, "./zlib/messages": 51, "./zlib/zstream": 53 }], 41: [function(e, t, r) {
          "use strict";
          var n = "undefined" != typeof Uint8Array && "undefined" != typeof Uint16Array && "undefined" != typeof Int32Array;
          r.assign = function(e2) {
            for (var t2 = Array.prototype.slice.call(arguments, 1); t2.length; ) {
              var r2 = t2.shift();
              if (r2) {
                if ("object" != typeof r2) throw new TypeError(r2 + "must be non-object");
                for (var n2 in r2) r2.hasOwnProperty(n2) && (e2[n2] = r2[n2]);
              }
            }
            return e2;
          }, r.shrinkBuf = function(e2, t2) {
            return e2.length === t2 ? e2 : e2.subarray ? e2.subarray(0, t2) : (e2.length = t2, e2);
          };
          var i = { arraySet: function(e2, t2, r2, n2, i2) {
            if (t2.subarray && e2.subarray) e2.set(t2.subarray(r2, r2 + n2), i2);
            else for (var s2 = 0; s2 < n2; s2++) e2[i2 + s2] = t2[r2 + s2];
          }, flattenChunks: function(e2) {
            var t2, r2, n2, i2, s2, a;
            for (t2 = n2 = 0, r2 = e2.length; t2 < r2; t2++) n2 += e2[t2].length;
            for (a = new Uint8Array(n2), t2 = i2 = 0, r2 = e2.length; t2 < r2; t2++) s2 = e2[t2], a.set(s2, i2), i2 += s2.length;
            return a;
          } }, s = { arraySet: function(e2, t2, r2, n2, i2) {
            for (var s2 = 0; s2 < n2; s2++) e2[i2 + s2] = t2[r2 + s2];
          }, flattenChunks: function(e2) {
            return [].concat.apply([], e2);
          } };
          r.setTyped = function(e2) {
            e2 ? (r.Buf8 = Uint8Array, r.Buf16 = Uint16Array, r.Buf32 = Int32Array, r.assign(r, i)) : (r.Buf8 = Array, r.Buf16 = Array, r.Buf32 = Array, r.assign(r, s));
          }, r.setTyped(n);
        }, {}], 42: [function(e, t, r) {
          "use strict";
          var h = e("./common"), i = true, s = true;
          try {
            String.fromCharCode.apply(null, [0]);
          } catch (e2) {
            i = false;
          }
          try {
            String.fromCharCode.apply(null, new Uint8Array(1));
          } catch (e2) {
            s = false;
          }
          for (var u = new h.Buf8(256), n = 0; n < 256; n++) u[n] = 252 <= n ? 6 : 248 <= n ? 5 : 240 <= n ? 4 : 224 <= n ? 3 : 192 <= n ? 2 : 1;
          function l(e2, t2) {
            if (t2 < 65537 && (e2.subarray && s || !e2.subarray && i)) return String.fromCharCode.apply(null, h.shrinkBuf(e2, t2));
            for (var r2 = "", n2 = 0; n2 < t2; n2++) r2 += String.fromCharCode(e2[n2]);
            return r2;
          }
          u[254] = u[254] = 1, r.string2buf = function(e2) {
            var t2, r2, n2, i2, s2, a = e2.length, o = 0;
            for (i2 = 0; i2 < a; i2++) 55296 == (64512 & (r2 = e2.charCodeAt(i2))) && i2 + 1 < a && 56320 == (64512 & (n2 = e2.charCodeAt(i2 + 1))) && (r2 = 65536 + (r2 - 55296 << 10) + (n2 - 56320), i2++), o += r2 < 128 ? 1 : r2 < 2048 ? 2 : r2 < 65536 ? 3 : 4;
            for (t2 = new h.Buf8(o), i2 = s2 = 0; s2 < o; i2++) 55296 == (64512 & (r2 = e2.charCodeAt(i2))) && i2 + 1 < a && 56320 == (64512 & (n2 = e2.charCodeAt(i2 + 1))) && (r2 = 65536 + (r2 - 55296 << 10) + (n2 - 56320), i2++), r2 < 128 ? t2[s2++] = r2 : (r2 < 2048 ? t2[s2++] = 192 | r2 >>> 6 : (r2 < 65536 ? t2[s2++] = 224 | r2 >>> 12 : (t2[s2++] = 240 | r2 >>> 18, t2[s2++] = 128 | r2 >>> 12 & 63), t2[s2++] = 128 | r2 >>> 6 & 63), t2[s2++] = 128 | 63 & r2);
            return t2;
          }, r.buf2binstring = function(e2) {
            return l(e2, e2.length);
          }, r.binstring2buf = function(e2) {
            for (var t2 = new h.Buf8(e2.length), r2 = 0, n2 = t2.length; r2 < n2; r2++) t2[r2] = e2.charCodeAt(r2);
            return t2;
          }, r.buf2string = function(e2, t2) {
            var r2, n2, i2, s2, a = t2 || e2.length, o = new Array(2 * a);
            for (r2 = n2 = 0; r2 < a; ) if ((i2 = e2[r2++]) < 128) o[n2++] = i2;
            else if (4 < (s2 = u[i2])) o[n2++] = 65533, r2 += s2 - 1;
            else {
              for (i2 &= 2 === s2 ? 31 : 3 === s2 ? 15 : 7; 1 < s2 && r2 < a; ) i2 = i2 << 6 | 63 & e2[r2++], s2--;
              1 < s2 ? o[n2++] = 65533 : i2 < 65536 ? o[n2++] = i2 : (i2 -= 65536, o[n2++] = 55296 | i2 >> 10 & 1023, o[n2++] = 56320 | 1023 & i2);
            }
            return l(o, n2);
          }, r.utf8border = function(e2, t2) {
            var r2;
            for ((t2 = t2 || e2.length) > e2.length && (t2 = e2.length), r2 = t2 - 1; 0 <= r2 && 128 == (192 & e2[r2]); ) r2--;
            return r2 < 0 ? t2 : 0 === r2 ? t2 : r2 + u[e2[r2]] > t2 ? r2 : t2;
          };
        }, { "./common": 41 }], 43: [function(e, t, r) {
          "use strict";
          t.exports = function(e2, t2, r2, n) {
            for (var i = 65535 & e2 | 0, s = e2 >>> 16 & 65535 | 0, a = 0; 0 !== r2; ) {
              for (r2 -= a = 2e3 < r2 ? 2e3 : r2; s = s + (i = i + t2[n++] | 0) | 0, --a; ) ;
              i %= 65521, s %= 65521;
            }
            return i | s << 16 | 0;
          };
        }, {}], 44: [function(e, t, r) {
          "use strict";
          t.exports = { Z_NO_FLUSH: 0, Z_PARTIAL_FLUSH: 1, Z_SYNC_FLUSH: 2, Z_FULL_FLUSH: 3, Z_FINISH: 4, Z_BLOCK: 5, Z_TREES: 6, Z_OK: 0, Z_STREAM_END: 1, Z_NEED_DICT: 2, Z_ERRNO: -1, Z_STREAM_ERROR: -2, Z_DATA_ERROR: -3, Z_BUF_ERROR: -5, Z_NO_COMPRESSION: 0, Z_BEST_SPEED: 1, Z_BEST_COMPRESSION: 9, Z_DEFAULT_COMPRESSION: -1, Z_FILTERED: 1, Z_HUFFMAN_ONLY: 2, Z_RLE: 3, Z_FIXED: 4, Z_DEFAULT_STRATEGY: 0, Z_BINARY: 0, Z_TEXT: 1, Z_UNKNOWN: 2, Z_DEFLATED: 8 };
        }, {}], 45: [function(e, t, r) {
          "use strict";
          var o = (function() {
            for (var e2, t2 = [], r2 = 0; r2 < 256; r2++) {
              e2 = r2;
              for (var n = 0; n < 8; n++) e2 = 1 & e2 ? 3988292384 ^ e2 >>> 1 : e2 >>> 1;
              t2[r2] = e2;
            }
            return t2;
          })();
          t.exports = function(e2, t2, r2, n) {
            var i = o, s = n + r2;
            e2 ^= -1;
            for (var a = n; a < s; a++) e2 = e2 >>> 8 ^ i[255 & (e2 ^ t2[a])];
            return -1 ^ e2;
          };
        }, {}], 46: [function(e, t, r) {
          "use strict";
          var h, c = e("../utils/common"), u = e("./trees"), d = e("./adler32"), p = e("./crc32"), n = e("./messages"), l = 0, f = 4, m = 0, _ = -2, g = -1, b = 4, i = 2, v = 8, y = 9, s = 286, a = 30, o = 19, w = 2 * s + 1, k = 15, x = 3, S = 258, z = S + x + 1, C = 42, E = 113, A = 1, I = 2, O = 3, B = 4;
          function R(e2, t2) {
            return e2.msg = n[t2], t2;
          }
          function T(e2) {
            return (e2 << 1) - (4 < e2 ? 9 : 0);
          }
          function D(e2) {
            for (var t2 = e2.length; 0 <= --t2; ) e2[t2] = 0;
          }
          function F(e2) {
            var t2 = e2.state, r2 = t2.pending;
            r2 > e2.avail_out && (r2 = e2.avail_out), 0 !== r2 && (c.arraySet(e2.output, t2.pending_buf, t2.pending_out, r2, e2.next_out), e2.next_out += r2, t2.pending_out += r2, e2.total_out += r2, e2.avail_out -= r2, t2.pending -= r2, 0 === t2.pending && (t2.pending_out = 0));
          }
          function N(e2, t2) {
            u._tr_flush_block(e2, 0 <= e2.block_start ? e2.block_start : -1, e2.strstart - e2.block_start, t2), e2.block_start = e2.strstart, F(e2.strm);
          }
          function U(e2, t2) {
            e2.pending_buf[e2.pending++] = t2;
          }
          function P(e2, t2) {
            e2.pending_buf[e2.pending++] = t2 >>> 8 & 255, e2.pending_buf[e2.pending++] = 255 & t2;
          }
          function L(e2, t2) {
            var r2, n2, i2 = e2.max_chain_length, s2 = e2.strstart, a2 = e2.prev_length, o2 = e2.nice_match, h2 = e2.strstart > e2.w_size - z ? e2.strstart - (e2.w_size - z) : 0, u2 = e2.window, l2 = e2.w_mask, f2 = e2.prev, c2 = e2.strstart + S, d2 = u2[s2 + a2 - 1], p2 = u2[s2 + a2];
            e2.prev_length >= e2.good_match && (i2 >>= 2), o2 > e2.lookahead && (o2 = e2.lookahead);
            do {
              if (u2[(r2 = t2) + a2] === p2 && u2[r2 + a2 - 1] === d2 && u2[r2] === u2[s2] && u2[++r2] === u2[s2 + 1]) {
                s2 += 2, r2++;
                do {
                } while (u2[++s2] === u2[++r2] && u2[++s2] === u2[++r2] && u2[++s2] === u2[++r2] && u2[++s2] === u2[++r2] && u2[++s2] === u2[++r2] && u2[++s2] === u2[++r2] && u2[++s2] === u2[++r2] && u2[++s2] === u2[++r2] && s2 < c2);
                if (n2 = S - (c2 - s2), s2 = c2 - S, a2 < n2) {
                  if (e2.match_start = t2, o2 <= (a2 = n2)) break;
                  d2 = u2[s2 + a2 - 1], p2 = u2[s2 + a2];
                }
              }
            } while ((t2 = f2[t2 & l2]) > h2 && 0 != --i2);
            return a2 <= e2.lookahead ? a2 : e2.lookahead;
          }
          function j(e2) {
            var t2, r2, n2, i2, s2, a2, o2, h2, u2, l2, f2 = e2.w_size;
            do {
              if (i2 = e2.window_size - e2.lookahead - e2.strstart, e2.strstart >= f2 + (f2 - z)) {
                for (c.arraySet(e2.window, e2.window, f2, f2, 0), e2.match_start -= f2, e2.strstart -= f2, e2.block_start -= f2, t2 = r2 = e2.hash_size; n2 = e2.head[--t2], e2.head[t2] = f2 <= n2 ? n2 - f2 : 0, --r2; ) ;
                for (t2 = r2 = f2; n2 = e2.prev[--t2], e2.prev[t2] = f2 <= n2 ? n2 - f2 : 0, --r2; ) ;
                i2 += f2;
              }
              if (0 === e2.strm.avail_in) break;
              if (a2 = e2.strm, o2 = e2.window, h2 = e2.strstart + e2.lookahead, u2 = i2, l2 = void 0, l2 = a2.avail_in, u2 < l2 && (l2 = u2), r2 = 0 === l2 ? 0 : (a2.avail_in -= l2, c.arraySet(o2, a2.input, a2.next_in, l2, h2), 1 === a2.state.wrap ? a2.adler = d(a2.adler, o2, l2, h2) : 2 === a2.state.wrap && (a2.adler = p(a2.adler, o2, l2, h2)), a2.next_in += l2, a2.total_in += l2, l2), e2.lookahead += r2, e2.lookahead + e2.insert >= x) for (s2 = e2.strstart - e2.insert, e2.ins_h = e2.window[s2], e2.ins_h = (e2.ins_h << e2.hash_shift ^ e2.window[s2 + 1]) & e2.hash_mask; e2.insert && (e2.ins_h = (e2.ins_h << e2.hash_shift ^ e2.window[s2 + x - 1]) & e2.hash_mask, e2.prev[s2 & e2.w_mask] = e2.head[e2.ins_h], e2.head[e2.ins_h] = s2, s2++, e2.insert--, !(e2.lookahead + e2.insert < x)); ) ;
            } while (e2.lookahead < z && 0 !== e2.strm.avail_in);
          }
          function Z(e2, t2) {
            for (var r2, n2; ; ) {
              if (e2.lookahead < z) {
                if (j(e2), e2.lookahead < z && t2 === l) return A;
                if (0 === e2.lookahead) break;
              }
              if (r2 = 0, e2.lookahead >= x && (e2.ins_h = (e2.ins_h << e2.hash_shift ^ e2.window[e2.strstart + x - 1]) & e2.hash_mask, r2 = e2.prev[e2.strstart & e2.w_mask] = e2.head[e2.ins_h], e2.head[e2.ins_h] = e2.strstart), 0 !== r2 && e2.strstart - r2 <= e2.w_size - z && (e2.match_length = L(e2, r2)), e2.match_length >= x) if (n2 = u._tr_tally(e2, e2.strstart - e2.match_start, e2.match_length - x), e2.lookahead -= e2.match_length, e2.match_length <= e2.max_lazy_match && e2.lookahead >= x) {
                for (e2.match_length--; e2.strstart++, e2.ins_h = (e2.ins_h << e2.hash_shift ^ e2.window[e2.strstart + x - 1]) & e2.hash_mask, r2 = e2.prev[e2.strstart & e2.w_mask] = e2.head[e2.ins_h], e2.head[e2.ins_h] = e2.strstart, 0 != --e2.match_length; ) ;
                e2.strstart++;
              } else e2.strstart += e2.match_length, e2.match_length = 0, e2.ins_h = e2.window[e2.strstart], e2.ins_h = (e2.ins_h << e2.hash_shift ^ e2.window[e2.strstart + 1]) & e2.hash_mask;
              else n2 = u._tr_tally(e2, 0, e2.window[e2.strstart]), e2.lookahead--, e2.strstart++;
              if (n2 && (N(e2, false), 0 === e2.strm.avail_out)) return A;
            }
            return e2.insert = e2.strstart < x - 1 ? e2.strstart : x - 1, t2 === f ? (N(e2, true), 0 === e2.strm.avail_out ? O : B) : e2.last_lit && (N(e2, false), 0 === e2.strm.avail_out) ? A : I;
          }
          function W(e2, t2) {
            for (var r2, n2, i2; ; ) {
              if (e2.lookahead < z) {
                if (j(e2), e2.lookahead < z && t2 === l) return A;
                if (0 === e2.lookahead) break;
              }
              if (r2 = 0, e2.lookahead >= x && (e2.ins_h = (e2.ins_h << e2.hash_shift ^ e2.window[e2.strstart + x - 1]) & e2.hash_mask, r2 = e2.prev[e2.strstart & e2.w_mask] = e2.head[e2.ins_h], e2.head[e2.ins_h] = e2.strstart), e2.prev_length = e2.match_length, e2.prev_match = e2.match_start, e2.match_length = x - 1, 0 !== r2 && e2.prev_length < e2.max_lazy_match && e2.strstart - r2 <= e2.w_size - z && (e2.match_length = L(e2, r2), e2.match_length <= 5 && (1 === e2.strategy || e2.match_length === x && 4096 < e2.strstart - e2.match_start) && (e2.match_length = x - 1)), e2.prev_length >= x && e2.match_length <= e2.prev_length) {
                for (i2 = e2.strstart + e2.lookahead - x, n2 = u._tr_tally(e2, e2.strstart - 1 - e2.prev_match, e2.prev_length - x), e2.lookahead -= e2.prev_length - 1, e2.prev_length -= 2; ++e2.strstart <= i2 && (e2.ins_h = (e2.ins_h << e2.hash_shift ^ e2.window[e2.strstart + x - 1]) & e2.hash_mask, r2 = e2.prev[e2.strstart & e2.w_mask] = e2.head[e2.ins_h], e2.head[e2.ins_h] = e2.strstart), 0 != --e2.prev_length; ) ;
                if (e2.match_available = 0, e2.match_length = x - 1, e2.strstart++, n2 && (N(e2, false), 0 === e2.strm.avail_out)) return A;
              } else if (e2.match_available) {
                if ((n2 = u._tr_tally(e2, 0, e2.window[e2.strstart - 1])) && N(e2, false), e2.strstart++, e2.lookahead--, 0 === e2.strm.avail_out) return A;
              } else e2.match_available = 1, e2.strstart++, e2.lookahead--;
            }
            return e2.match_available && (n2 = u._tr_tally(e2, 0, e2.window[e2.strstart - 1]), e2.match_available = 0), e2.insert = e2.strstart < x - 1 ? e2.strstart : x - 1, t2 === f ? (N(e2, true), 0 === e2.strm.avail_out ? O : B) : e2.last_lit && (N(e2, false), 0 === e2.strm.avail_out) ? A : I;
          }
          function M(e2, t2, r2, n2, i2) {
            this.good_length = e2, this.max_lazy = t2, this.nice_length = r2, this.max_chain = n2, this.func = i2;
          }
          function H() {
            this.strm = null, this.status = 0, this.pending_buf = null, this.pending_buf_size = 0, this.pending_out = 0, this.pending = 0, this.wrap = 0, this.gzhead = null, this.gzindex = 0, this.method = v, this.last_flush = -1, this.w_size = 0, this.w_bits = 0, this.w_mask = 0, this.window = null, this.window_size = 0, this.prev = null, this.head = null, this.ins_h = 0, this.hash_size = 0, this.hash_bits = 0, this.hash_mask = 0, this.hash_shift = 0, this.block_start = 0, this.match_length = 0, this.prev_match = 0, this.match_available = 0, this.strstart = 0, this.match_start = 0, this.lookahead = 0, this.prev_length = 0, this.max_chain_length = 0, this.max_lazy_match = 0, this.level = 0, this.strategy = 0, this.good_match = 0, this.nice_match = 0, this.dyn_ltree = new c.Buf16(2 * w), this.dyn_dtree = new c.Buf16(2 * (2 * a + 1)), this.bl_tree = new c.Buf16(2 * (2 * o + 1)), D(this.dyn_ltree), D(this.dyn_dtree), D(this.bl_tree), this.l_desc = null, this.d_desc = null, this.bl_desc = null, this.bl_count = new c.Buf16(k + 1), this.heap = new c.Buf16(2 * s + 1), D(this.heap), this.heap_len = 0, this.heap_max = 0, this.depth = new c.Buf16(2 * s + 1), D(this.depth), this.l_buf = 0, this.lit_bufsize = 0, this.last_lit = 0, this.d_buf = 0, this.opt_len = 0, this.static_len = 0, this.matches = 0, this.insert = 0, this.bi_buf = 0, this.bi_valid = 0;
          }
          function G(e2) {
            var t2;
            return e2 && e2.state ? (e2.total_in = e2.total_out = 0, e2.data_type = i, (t2 = e2.state).pending = 0, t2.pending_out = 0, t2.wrap < 0 && (t2.wrap = -t2.wrap), t2.status = t2.wrap ? C : E, e2.adler = 2 === t2.wrap ? 0 : 1, t2.last_flush = l, u._tr_init(t2), m) : R(e2, _);
          }
          function K(e2) {
            var t2 = G(e2);
            return t2 === m && (function(e3) {
              e3.window_size = 2 * e3.w_size, D(e3.head), e3.max_lazy_match = h[e3.level].max_lazy, e3.good_match = h[e3.level].good_length, e3.nice_match = h[e3.level].nice_length, e3.max_chain_length = h[e3.level].max_chain, e3.strstart = 0, e3.block_start = 0, e3.lookahead = 0, e3.insert = 0, e3.match_length = e3.prev_length = x - 1, e3.match_available = 0, e3.ins_h = 0;
            })(e2.state), t2;
          }
          function Y(e2, t2, r2, n2, i2, s2) {
            if (!e2) return _;
            var a2 = 1;
            if (t2 === g && (t2 = 6), n2 < 0 ? (a2 = 0, n2 = -n2) : 15 < n2 && (a2 = 2, n2 -= 16), i2 < 1 || y < i2 || r2 !== v || n2 < 8 || 15 < n2 || t2 < 0 || 9 < t2 || s2 < 0 || b < s2) return R(e2, _);
            8 === n2 && (n2 = 9);
            var o2 = new H();
            return (e2.state = o2).strm = e2, o2.wrap = a2, o2.gzhead = null, o2.w_bits = n2, o2.w_size = 1 << o2.w_bits, o2.w_mask = o2.w_size - 1, o2.hash_bits = i2 + 7, o2.hash_size = 1 << o2.hash_bits, o2.hash_mask = o2.hash_size - 1, o2.hash_shift = ~~((o2.hash_bits + x - 1) / x), o2.window = new c.Buf8(2 * o2.w_size), o2.head = new c.Buf16(o2.hash_size), o2.prev = new c.Buf16(o2.w_size), o2.lit_bufsize = 1 << i2 + 6, o2.pending_buf_size = 4 * o2.lit_bufsize, o2.pending_buf = new c.Buf8(o2.pending_buf_size), o2.d_buf = 1 * o2.lit_bufsize, o2.l_buf = 3 * o2.lit_bufsize, o2.level = t2, o2.strategy = s2, o2.method = r2, K(e2);
          }
          h = [new M(0, 0, 0, 0, function(e2, t2) {
            var r2 = 65535;
            for (r2 > e2.pending_buf_size - 5 && (r2 = e2.pending_buf_size - 5); ; ) {
              if (e2.lookahead <= 1) {
                if (j(e2), 0 === e2.lookahead && t2 === l) return A;
                if (0 === e2.lookahead) break;
              }
              e2.strstart += e2.lookahead, e2.lookahead = 0;
              var n2 = e2.block_start + r2;
              if ((0 === e2.strstart || e2.strstart >= n2) && (e2.lookahead = e2.strstart - n2, e2.strstart = n2, N(e2, false), 0 === e2.strm.avail_out)) return A;
              if (e2.strstart - e2.block_start >= e2.w_size - z && (N(e2, false), 0 === e2.strm.avail_out)) return A;
            }
            return e2.insert = 0, t2 === f ? (N(e2, true), 0 === e2.strm.avail_out ? O : B) : (e2.strstart > e2.block_start && (N(e2, false), e2.strm.avail_out), A);
          }), new M(4, 4, 8, 4, Z), new M(4, 5, 16, 8, Z), new M(4, 6, 32, 32, Z), new M(4, 4, 16, 16, W), new M(8, 16, 32, 32, W), new M(8, 16, 128, 128, W), new M(8, 32, 128, 256, W), new M(32, 128, 258, 1024, W), new M(32, 258, 258, 4096, W)], r.deflateInit = function(e2, t2) {
            return Y(e2, t2, v, 15, 8, 0);
          }, r.deflateInit2 = Y, r.deflateReset = K, r.deflateResetKeep = G, r.deflateSetHeader = function(e2, t2) {
            return e2 && e2.state ? 2 !== e2.state.wrap ? _ : (e2.state.gzhead = t2, m) : _;
          }, r.deflate = function(e2, t2) {
            var r2, n2, i2, s2;
            if (!e2 || !e2.state || 5 < t2 || t2 < 0) return e2 ? R(e2, _) : _;
            if (n2 = e2.state, !e2.output || !e2.input && 0 !== e2.avail_in || 666 === n2.status && t2 !== f) return R(e2, 0 === e2.avail_out ? -5 : _);
            if (n2.strm = e2, r2 = n2.last_flush, n2.last_flush = t2, n2.status === C) if (2 === n2.wrap) e2.adler = 0, U(n2, 31), U(n2, 139), U(n2, 8), n2.gzhead ? (U(n2, (n2.gzhead.text ? 1 : 0) + (n2.gzhead.hcrc ? 2 : 0) + (n2.gzhead.extra ? 4 : 0) + (n2.gzhead.name ? 8 : 0) + (n2.gzhead.comment ? 16 : 0)), U(n2, 255 & n2.gzhead.time), U(n2, n2.gzhead.time >> 8 & 255), U(n2, n2.gzhead.time >> 16 & 255), U(n2, n2.gzhead.time >> 24 & 255), U(n2, 9 === n2.level ? 2 : 2 <= n2.strategy || n2.level < 2 ? 4 : 0), U(n2, 255 & n2.gzhead.os), n2.gzhead.extra && n2.gzhead.extra.length && (U(n2, 255 & n2.gzhead.extra.length), U(n2, n2.gzhead.extra.length >> 8 & 255)), n2.gzhead.hcrc && (e2.adler = p(e2.adler, n2.pending_buf, n2.pending, 0)), n2.gzindex = 0, n2.status = 69) : (U(n2, 0), U(n2, 0), U(n2, 0), U(n2, 0), U(n2, 0), U(n2, 9 === n2.level ? 2 : 2 <= n2.strategy || n2.level < 2 ? 4 : 0), U(n2, 3), n2.status = E);
            else {
              var a2 = v + (n2.w_bits - 8 << 4) << 8;
              a2 |= (2 <= n2.strategy || n2.level < 2 ? 0 : n2.level < 6 ? 1 : 6 === n2.level ? 2 : 3) << 6, 0 !== n2.strstart && (a2 |= 32), a2 += 31 - a2 % 31, n2.status = E, P(n2, a2), 0 !== n2.strstart && (P(n2, e2.adler >>> 16), P(n2, 65535 & e2.adler)), e2.adler = 1;
            }
            if (69 === n2.status) if (n2.gzhead.extra) {
              for (i2 = n2.pending; n2.gzindex < (65535 & n2.gzhead.extra.length) && (n2.pending !== n2.pending_buf_size || (n2.gzhead.hcrc && n2.pending > i2 && (e2.adler = p(e2.adler, n2.pending_buf, n2.pending - i2, i2)), F(e2), i2 = n2.pending, n2.pending !== n2.pending_buf_size)); ) U(n2, 255 & n2.gzhead.extra[n2.gzindex]), n2.gzindex++;
              n2.gzhead.hcrc && n2.pending > i2 && (e2.adler = p(e2.adler, n2.pending_buf, n2.pending - i2, i2)), n2.gzindex === n2.gzhead.extra.length && (n2.gzindex = 0, n2.status = 73);
            } else n2.status = 73;
            if (73 === n2.status) if (n2.gzhead.name) {
              i2 = n2.pending;
              do {
                if (n2.pending === n2.pending_buf_size && (n2.gzhead.hcrc && n2.pending > i2 && (e2.adler = p(e2.adler, n2.pending_buf, n2.pending - i2, i2)), F(e2), i2 = n2.pending, n2.pending === n2.pending_buf_size)) {
                  s2 = 1;
                  break;
                }
                s2 = n2.gzindex < n2.gzhead.name.length ? 255 & n2.gzhead.name.charCodeAt(n2.gzindex++) : 0, U(n2, s2);
              } while (0 !== s2);
              n2.gzhead.hcrc && n2.pending > i2 && (e2.adler = p(e2.adler, n2.pending_buf, n2.pending - i2, i2)), 0 === s2 && (n2.gzindex = 0, n2.status = 91);
            } else n2.status = 91;
            if (91 === n2.status) if (n2.gzhead.comment) {
              i2 = n2.pending;
              do {
                if (n2.pending === n2.pending_buf_size && (n2.gzhead.hcrc && n2.pending > i2 && (e2.adler = p(e2.adler, n2.pending_buf, n2.pending - i2, i2)), F(e2), i2 = n2.pending, n2.pending === n2.pending_buf_size)) {
                  s2 = 1;
                  break;
                }
                s2 = n2.gzindex < n2.gzhead.comment.length ? 255 & n2.gzhead.comment.charCodeAt(n2.gzindex++) : 0, U(n2, s2);
              } while (0 !== s2);
              n2.gzhead.hcrc && n2.pending > i2 && (e2.adler = p(e2.adler, n2.pending_buf, n2.pending - i2, i2)), 0 === s2 && (n2.status = 103);
            } else n2.status = 103;
            if (103 === n2.status && (n2.gzhead.hcrc ? (n2.pending + 2 > n2.pending_buf_size && F(e2), n2.pending + 2 <= n2.pending_buf_size && (U(n2, 255 & e2.adler), U(n2, e2.adler >> 8 & 255), e2.adler = 0, n2.status = E)) : n2.status = E), 0 !== n2.pending) {
              if (F(e2), 0 === e2.avail_out) return n2.last_flush = -1, m;
            } else if (0 === e2.avail_in && T(t2) <= T(r2) && t2 !== f) return R(e2, -5);
            if (666 === n2.status && 0 !== e2.avail_in) return R(e2, -5);
            if (0 !== e2.avail_in || 0 !== n2.lookahead || t2 !== l && 666 !== n2.status) {
              var o2 = 2 === n2.strategy ? (function(e3, t3) {
                for (var r3; ; ) {
                  if (0 === e3.lookahead && (j(e3), 0 === e3.lookahead)) {
                    if (t3 === l) return A;
                    break;
                  }
                  if (e3.match_length = 0, r3 = u._tr_tally(e3, 0, e3.window[e3.strstart]), e3.lookahead--, e3.strstart++, r3 && (N(e3, false), 0 === e3.strm.avail_out)) return A;
                }
                return e3.insert = 0, t3 === f ? (N(e3, true), 0 === e3.strm.avail_out ? O : B) : e3.last_lit && (N(e3, false), 0 === e3.strm.avail_out) ? A : I;
              })(n2, t2) : 3 === n2.strategy ? (function(e3, t3) {
                for (var r3, n3, i3, s3, a3 = e3.window; ; ) {
                  if (e3.lookahead <= S) {
                    if (j(e3), e3.lookahead <= S && t3 === l) return A;
                    if (0 === e3.lookahead) break;
                  }
                  if (e3.match_length = 0, e3.lookahead >= x && 0 < e3.strstart && (n3 = a3[i3 = e3.strstart - 1]) === a3[++i3] && n3 === a3[++i3] && n3 === a3[++i3]) {
                    s3 = e3.strstart + S;
                    do {
                    } while (n3 === a3[++i3] && n3 === a3[++i3] && n3 === a3[++i3] && n3 === a3[++i3] && n3 === a3[++i3] && n3 === a3[++i3] && n3 === a3[++i3] && n3 === a3[++i3] && i3 < s3);
                    e3.match_length = S - (s3 - i3), e3.match_length > e3.lookahead && (e3.match_length = e3.lookahead);
                  }
                  if (e3.match_length >= x ? (r3 = u._tr_tally(e3, 1, e3.match_length - x), e3.lookahead -= e3.match_length, e3.strstart += e3.match_length, e3.match_length = 0) : (r3 = u._tr_tally(e3, 0, e3.window[e3.strstart]), e3.lookahead--, e3.strstart++), r3 && (N(e3, false), 0 === e3.strm.avail_out)) return A;
                }
                return e3.insert = 0, t3 === f ? (N(e3, true), 0 === e3.strm.avail_out ? O : B) : e3.last_lit && (N(e3, false), 0 === e3.strm.avail_out) ? A : I;
              })(n2, t2) : h[n2.level].func(n2, t2);
              if (o2 !== O && o2 !== B || (n2.status = 666), o2 === A || o2 === O) return 0 === e2.avail_out && (n2.last_flush = -1), m;
              if (o2 === I && (1 === t2 ? u._tr_align(n2) : 5 !== t2 && (u._tr_stored_block(n2, 0, 0, false), 3 === t2 && (D(n2.head), 0 === n2.lookahead && (n2.strstart = 0, n2.block_start = 0, n2.insert = 0))), F(e2), 0 === e2.avail_out)) return n2.last_flush = -1, m;
            }
            return t2 !== f ? m : n2.wrap <= 0 ? 1 : (2 === n2.wrap ? (U(n2, 255 & e2.adler), U(n2, e2.adler >> 8 & 255), U(n2, e2.adler >> 16 & 255), U(n2, e2.adler >> 24 & 255), U(n2, 255 & e2.total_in), U(n2, e2.total_in >> 8 & 255), U(n2, e2.total_in >> 16 & 255), U(n2, e2.total_in >> 24 & 255)) : (P(n2, e2.adler >>> 16), P(n2, 65535 & e2.adler)), F(e2), 0 < n2.wrap && (n2.wrap = -n2.wrap), 0 !== n2.pending ? m : 1);
          }, r.deflateEnd = function(e2) {
            var t2;
            return e2 && e2.state ? (t2 = e2.state.status) !== C && 69 !== t2 && 73 !== t2 && 91 !== t2 && 103 !== t2 && t2 !== E && 666 !== t2 ? R(e2, _) : (e2.state = null, t2 === E ? R(e2, -3) : m) : _;
          }, r.deflateSetDictionary = function(e2, t2) {
            var r2, n2, i2, s2, a2, o2, h2, u2, l2 = t2.length;
            if (!e2 || !e2.state) return _;
            if (2 === (s2 = (r2 = e2.state).wrap) || 1 === s2 && r2.status !== C || r2.lookahead) return _;
            for (1 === s2 && (e2.adler = d(e2.adler, t2, l2, 0)), r2.wrap = 0, l2 >= r2.w_size && (0 === s2 && (D(r2.head), r2.strstart = 0, r2.block_start = 0, r2.insert = 0), u2 = new c.Buf8(r2.w_size), c.arraySet(u2, t2, l2 - r2.w_size, r2.w_size, 0), t2 = u2, l2 = r2.w_size), a2 = e2.avail_in, o2 = e2.next_in, h2 = e2.input, e2.avail_in = l2, e2.next_in = 0, e2.input = t2, j(r2); r2.lookahead >= x; ) {
              for (n2 = r2.strstart, i2 = r2.lookahead - (x - 1); r2.ins_h = (r2.ins_h << r2.hash_shift ^ r2.window[n2 + x - 1]) & r2.hash_mask, r2.prev[n2 & r2.w_mask] = r2.head[r2.ins_h], r2.head[r2.ins_h] = n2, n2++, --i2; ) ;
              r2.strstart = n2, r2.lookahead = x - 1, j(r2);
            }
            return r2.strstart += r2.lookahead, r2.block_start = r2.strstart, r2.insert = r2.lookahead, r2.lookahead = 0, r2.match_length = r2.prev_length = x - 1, r2.match_available = 0, e2.next_in = o2, e2.input = h2, e2.avail_in = a2, r2.wrap = s2, m;
          }, r.deflateInfo = "pako deflate (from Nodeca project)";
        }, { "../utils/common": 41, "./adler32": 43, "./crc32": 45, "./messages": 51, "./trees": 52 }], 47: [function(e, t, r) {
          "use strict";
          t.exports = function() {
            this.text = 0, this.time = 0, this.xflags = 0, this.os = 0, this.extra = null, this.extra_len = 0, this.name = "", this.comment = "", this.hcrc = 0, this.done = false;
          };
        }, {}], 48: [function(e, t, r) {
          "use strict";
          t.exports = function(e2, t2) {
            var r2, n, i, s, a, o, h, u, l, f, c, d, p, m, _, g, b, v, y, w, k, x, S, z, C;
            r2 = e2.state, n = e2.next_in, z = e2.input, i = n + (e2.avail_in - 5), s = e2.next_out, C = e2.output, a = s - (t2 - e2.avail_out), o = s + (e2.avail_out - 257), h = r2.dmax, u = r2.wsize, l = r2.whave, f = r2.wnext, c = r2.window, d = r2.hold, p = r2.bits, m = r2.lencode, _ = r2.distcode, g = (1 << r2.lenbits) - 1, b = (1 << r2.distbits) - 1;
            e: do {
              p < 15 && (d += z[n++] << p, p += 8, d += z[n++] << p, p += 8), v = m[d & g];
              t: for (; ; ) {
                if (d >>>= y = v >>> 24, p -= y, 0 === (y = v >>> 16 & 255)) C[s++] = 65535 & v;
                else {
                  if (!(16 & y)) {
                    if (0 == (64 & y)) {
                      v = m[(65535 & v) + (d & (1 << y) - 1)];
                      continue t;
                    }
                    if (32 & y) {
                      r2.mode = 12;
                      break e;
                    }
                    e2.msg = "invalid literal/length code", r2.mode = 30;
                    break e;
                  }
                  w = 65535 & v, (y &= 15) && (p < y && (d += z[n++] << p, p += 8), w += d & (1 << y) - 1, d >>>= y, p -= y), p < 15 && (d += z[n++] << p, p += 8, d += z[n++] << p, p += 8), v = _[d & b];
                  r: for (; ; ) {
                    if (d >>>= y = v >>> 24, p -= y, !(16 & (y = v >>> 16 & 255))) {
                      if (0 == (64 & y)) {
                        v = _[(65535 & v) + (d & (1 << y) - 1)];
                        continue r;
                      }
                      e2.msg = "invalid distance code", r2.mode = 30;
                      break e;
                    }
                    if (k = 65535 & v, p < (y &= 15) && (d += z[n++] << p, (p += 8) < y && (d += z[n++] << p, p += 8)), h < (k += d & (1 << y) - 1)) {
                      e2.msg = "invalid distance too far back", r2.mode = 30;
                      break e;
                    }
                    if (d >>>= y, p -= y, (y = s - a) < k) {
                      if (l < (y = k - y) && r2.sane) {
                        e2.msg = "invalid distance too far back", r2.mode = 30;
                        break e;
                      }
                      if (S = c, (x = 0) === f) {
                        if (x += u - y, y < w) {
                          for (w -= y; C[s++] = c[x++], --y; ) ;
                          x = s - k, S = C;
                        }
                      } else if (f < y) {
                        if (x += u + f - y, (y -= f) < w) {
                          for (w -= y; C[s++] = c[x++], --y; ) ;
                          if (x = 0, f < w) {
                            for (w -= y = f; C[s++] = c[x++], --y; ) ;
                            x = s - k, S = C;
                          }
                        }
                      } else if (x += f - y, y < w) {
                        for (w -= y; C[s++] = c[x++], --y; ) ;
                        x = s - k, S = C;
                      }
                      for (; 2 < w; ) C[s++] = S[x++], C[s++] = S[x++], C[s++] = S[x++], w -= 3;
                      w && (C[s++] = S[x++], 1 < w && (C[s++] = S[x++]));
                    } else {
                      for (x = s - k; C[s++] = C[x++], C[s++] = C[x++], C[s++] = C[x++], 2 < (w -= 3); ) ;
                      w && (C[s++] = C[x++], 1 < w && (C[s++] = C[x++]));
                    }
                    break;
                  }
                }
                break;
              }
            } while (n < i && s < o);
            n -= w = p >> 3, d &= (1 << (p -= w << 3)) - 1, e2.next_in = n, e2.next_out = s, e2.avail_in = n < i ? i - n + 5 : 5 - (n - i), e2.avail_out = s < o ? o - s + 257 : 257 - (s - o), r2.hold = d, r2.bits = p;
          };
        }, {}], 49: [function(e, t, r) {
          "use strict";
          var I = e("../utils/common"), O = e("./adler32"), B = e("./crc32"), R = e("./inffast"), T = e("./inftrees"), D = 1, F = 2, N = 0, U = -2, P = 1, n = 852, i = 592;
          function L(e2) {
            return (e2 >>> 24 & 255) + (e2 >>> 8 & 65280) + ((65280 & e2) << 8) + ((255 & e2) << 24);
          }
          function s() {
            this.mode = 0, this.last = false, this.wrap = 0, this.havedict = false, this.flags = 0, this.dmax = 0, this.check = 0, this.total = 0, this.head = null, this.wbits = 0, this.wsize = 0, this.whave = 0, this.wnext = 0, this.window = null, this.hold = 0, this.bits = 0, this.length = 0, this.offset = 0, this.extra = 0, this.lencode = null, this.distcode = null, this.lenbits = 0, this.distbits = 0, this.ncode = 0, this.nlen = 0, this.ndist = 0, this.have = 0, this.next = null, this.lens = new I.Buf16(320), this.work = new I.Buf16(288), this.lendyn = null, this.distdyn = null, this.sane = 0, this.back = 0, this.was = 0;
          }
          function a(e2) {
            var t2;
            return e2 && e2.state ? (t2 = e2.state, e2.total_in = e2.total_out = t2.total = 0, e2.msg = "", t2.wrap && (e2.adler = 1 & t2.wrap), t2.mode = P, t2.last = 0, t2.havedict = 0, t2.dmax = 32768, t2.head = null, t2.hold = 0, t2.bits = 0, t2.lencode = t2.lendyn = new I.Buf32(n), t2.distcode = t2.distdyn = new I.Buf32(i), t2.sane = 1, t2.back = -1, N) : U;
          }
          function o(e2) {
            var t2;
            return e2 && e2.state ? ((t2 = e2.state).wsize = 0, t2.whave = 0, t2.wnext = 0, a(e2)) : U;
          }
          function h(e2, t2) {
            var r2, n2;
            return e2 && e2.state ? (n2 = e2.state, t2 < 0 ? (r2 = 0, t2 = -t2) : (r2 = 1 + (t2 >> 4), t2 < 48 && (t2 &= 15)), t2 && (t2 < 8 || 15 < t2) ? U : (null !== n2.window && n2.wbits !== t2 && (n2.window = null), n2.wrap = r2, n2.wbits = t2, o(e2))) : U;
          }
          function u(e2, t2) {
            var r2, n2;
            return e2 ? (n2 = new s(), (e2.state = n2).window = null, (r2 = h(e2, t2)) !== N && (e2.state = null), r2) : U;
          }
          var l, f, c = true;
          function j(e2) {
            if (c) {
              var t2;
              for (l = new I.Buf32(512), f = new I.Buf32(32), t2 = 0; t2 < 144; ) e2.lens[t2++] = 8;
              for (; t2 < 256; ) e2.lens[t2++] = 9;
              for (; t2 < 280; ) e2.lens[t2++] = 7;
              for (; t2 < 288; ) e2.lens[t2++] = 8;
              for (T(D, e2.lens, 0, 288, l, 0, e2.work, { bits: 9 }), t2 = 0; t2 < 32; ) e2.lens[t2++] = 5;
              T(F, e2.lens, 0, 32, f, 0, e2.work, { bits: 5 }), c = false;
            }
            e2.lencode = l, e2.lenbits = 9, e2.distcode = f, e2.distbits = 5;
          }
          function Z(e2, t2, r2, n2) {
            var i2, s2 = e2.state;
            return null === s2.window && (s2.wsize = 1 << s2.wbits, s2.wnext = 0, s2.whave = 0, s2.window = new I.Buf8(s2.wsize)), n2 >= s2.wsize ? (I.arraySet(s2.window, t2, r2 - s2.wsize, s2.wsize, 0), s2.wnext = 0, s2.whave = s2.wsize) : (n2 < (i2 = s2.wsize - s2.wnext) && (i2 = n2), I.arraySet(s2.window, t2, r2 - n2, i2, s2.wnext), (n2 -= i2) ? (I.arraySet(s2.window, t2, r2 - n2, n2, 0), s2.wnext = n2, s2.whave = s2.wsize) : (s2.wnext += i2, s2.wnext === s2.wsize && (s2.wnext = 0), s2.whave < s2.wsize && (s2.whave += i2))), 0;
          }
          r.inflateReset = o, r.inflateReset2 = h, r.inflateResetKeep = a, r.inflateInit = function(e2) {
            return u(e2, 15);
          }, r.inflateInit2 = u, r.inflate = function(e2, t2) {
            var r2, n2, i2, s2, a2, o2, h2, u2, l2, f2, c2, d, p, m, _, g, b, v, y, w, k, x, S, z, C = 0, E = new I.Buf8(4), A = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
            if (!e2 || !e2.state || !e2.output || !e2.input && 0 !== e2.avail_in) return U;
            12 === (r2 = e2.state).mode && (r2.mode = 13), a2 = e2.next_out, i2 = e2.output, h2 = e2.avail_out, s2 = e2.next_in, n2 = e2.input, o2 = e2.avail_in, u2 = r2.hold, l2 = r2.bits, f2 = o2, c2 = h2, x = N;
            e: for (; ; ) switch (r2.mode) {
              case P:
                if (0 === r2.wrap) {
                  r2.mode = 13;
                  break;
                }
                for (; l2 < 16; ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s2++] << l2, l2 += 8;
                }
                if (2 & r2.wrap && 35615 === u2) {
                  E[r2.check = 0] = 255 & u2, E[1] = u2 >>> 8 & 255, r2.check = B(r2.check, E, 2, 0), l2 = u2 = 0, r2.mode = 2;
                  break;
                }
                if (r2.flags = 0, r2.head && (r2.head.done = false), !(1 & r2.wrap) || (((255 & u2) << 8) + (u2 >> 8)) % 31) {
                  e2.msg = "incorrect header check", r2.mode = 30;
                  break;
                }
                if (8 != (15 & u2)) {
                  e2.msg = "unknown compression method", r2.mode = 30;
                  break;
                }
                if (l2 -= 4, k = 8 + (15 & (u2 >>>= 4)), 0 === r2.wbits) r2.wbits = k;
                else if (k > r2.wbits) {
                  e2.msg = "invalid window size", r2.mode = 30;
                  break;
                }
                r2.dmax = 1 << k, e2.adler = r2.check = 1, r2.mode = 512 & u2 ? 10 : 12, l2 = u2 = 0;
                break;
              case 2:
                for (; l2 < 16; ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s2++] << l2, l2 += 8;
                }
                if (r2.flags = u2, 8 != (255 & r2.flags)) {
                  e2.msg = "unknown compression method", r2.mode = 30;
                  break;
                }
                if (57344 & r2.flags) {
                  e2.msg = "unknown header flags set", r2.mode = 30;
                  break;
                }
                r2.head && (r2.head.text = u2 >> 8 & 1), 512 & r2.flags && (E[0] = 255 & u2, E[1] = u2 >>> 8 & 255, r2.check = B(r2.check, E, 2, 0)), l2 = u2 = 0, r2.mode = 3;
              case 3:
                for (; l2 < 32; ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s2++] << l2, l2 += 8;
                }
                r2.head && (r2.head.time = u2), 512 & r2.flags && (E[0] = 255 & u2, E[1] = u2 >>> 8 & 255, E[2] = u2 >>> 16 & 255, E[3] = u2 >>> 24 & 255, r2.check = B(r2.check, E, 4, 0)), l2 = u2 = 0, r2.mode = 4;
              case 4:
                for (; l2 < 16; ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s2++] << l2, l2 += 8;
                }
                r2.head && (r2.head.xflags = 255 & u2, r2.head.os = u2 >> 8), 512 & r2.flags && (E[0] = 255 & u2, E[1] = u2 >>> 8 & 255, r2.check = B(r2.check, E, 2, 0)), l2 = u2 = 0, r2.mode = 5;
              case 5:
                if (1024 & r2.flags) {
                  for (; l2 < 16; ) {
                    if (0 === o2) break e;
                    o2--, u2 += n2[s2++] << l2, l2 += 8;
                  }
                  r2.length = u2, r2.head && (r2.head.extra_len = u2), 512 & r2.flags && (E[0] = 255 & u2, E[1] = u2 >>> 8 & 255, r2.check = B(r2.check, E, 2, 0)), l2 = u2 = 0;
                } else r2.head && (r2.head.extra = null);
                r2.mode = 6;
              case 6:
                if (1024 & r2.flags && (o2 < (d = r2.length) && (d = o2), d && (r2.head && (k = r2.head.extra_len - r2.length, r2.head.extra || (r2.head.extra = new Array(r2.head.extra_len)), I.arraySet(r2.head.extra, n2, s2, d, k)), 512 & r2.flags && (r2.check = B(r2.check, n2, d, s2)), o2 -= d, s2 += d, r2.length -= d), r2.length)) break e;
                r2.length = 0, r2.mode = 7;
              case 7:
                if (2048 & r2.flags) {
                  if (0 === o2) break e;
                  for (d = 0; k = n2[s2 + d++], r2.head && k && r2.length < 65536 && (r2.head.name += String.fromCharCode(k)), k && d < o2; ) ;
                  if (512 & r2.flags && (r2.check = B(r2.check, n2, d, s2)), o2 -= d, s2 += d, k) break e;
                } else r2.head && (r2.head.name = null);
                r2.length = 0, r2.mode = 8;
              case 8:
                if (4096 & r2.flags) {
                  if (0 === o2) break e;
                  for (d = 0; k = n2[s2 + d++], r2.head && k && r2.length < 65536 && (r2.head.comment += String.fromCharCode(k)), k && d < o2; ) ;
                  if (512 & r2.flags && (r2.check = B(r2.check, n2, d, s2)), o2 -= d, s2 += d, k) break e;
                } else r2.head && (r2.head.comment = null);
                r2.mode = 9;
              case 9:
                if (512 & r2.flags) {
                  for (; l2 < 16; ) {
                    if (0 === o2) break e;
                    o2--, u2 += n2[s2++] << l2, l2 += 8;
                  }
                  if (u2 !== (65535 & r2.check)) {
                    e2.msg = "header crc mismatch", r2.mode = 30;
                    break;
                  }
                  l2 = u2 = 0;
                }
                r2.head && (r2.head.hcrc = r2.flags >> 9 & 1, r2.head.done = true), e2.adler = r2.check = 0, r2.mode = 12;
                break;
              case 10:
                for (; l2 < 32; ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s2++] << l2, l2 += 8;
                }
                e2.adler = r2.check = L(u2), l2 = u2 = 0, r2.mode = 11;
              case 11:
                if (0 === r2.havedict) return e2.next_out = a2, e2.avail_out = h2, e2.next_in = s2, e2.avail_in = o2, r2.hold = u2, r2.bits = l2, 2;
                e2.adler = r2.check = 1, r2.mode = 12;
              case 12:
                if (5 === t2 || 6 === t2) break e;
              case 13:
                if (r2.last) {
                  u2 >>>= 7 & l2, l2 -= 7 & l2, r2.mode = 27;
                  break;
                }
                for (; l2 < 3; ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s2++] << l2, l2 += 8;
                }
                switch (r2.last = 1 & u2, l2 -= 1, 3 & (u2 >>>= 1)) {
                  case 0:
                    r2.mode = 14;
                    break;
                  case 1:
                    if (j(r2), r2.mode = 20, 6 !== t2) break;
                    u2 >>>= 2, l2 -= 2;
                    break e;
                  case 2:
                    r2.mode = 17;
                    break;
                  case 3:
                    e2.msg = "invalid block type", r2.mode = 30;
                }
                u2 >>>= 2, l2 -= 2;
                break;
              case 14:
                for (u2 >>>= 7 & l2, l2 -= 7 & l2; l2 < 32; ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s2++] << l2, l2 += 8;
                }
                if ((65535 & u2) != (u2 >>> 16 ^ 65535)) {
                  e2.msg = "invalid stored block lengths", r2.mode = 30;
                  break;
                }
                if (r2.length = 65535 & u2, l2 = u2 = 0, r2.mode = 15, 6 === t2) break e;
              case 15:
                r2.mode = 16;
              case 16:
                if (d = r2.length) {
                  if (o2 < d && (d = o2), h2 < d && (d = h2), 0 === d) break e;
                  I.arraySet(i2, n2, s2, d, a2), o2 -= d, s2 += d, h2 -= d, a2 += d, r2.length -= d;
                  break;
                }
                r2.mode = 12;
                break;
              case 17:
                for (; l2 < 14; ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s2++] << l2, l2 += 8;
                }
                if (r2.nlen = 257 + (31 & u2), u2 >>>= 5, l2 -= 5, r2.ndist = 1 + (31 & u2), u2 >>>= 5, l2 -= 5, r2.ncode = 4 + (15 & u2), u2 >>>= 4, l2 -= 4, 286 < r2.nlen || 30 < r2.ndist) {
                  e2.msg = "too many length or distance symbols", r2.mode = 30;
                  break;
                }
                r2.have = 0, r2.mode = 18;
              case 18:
                for (; r2.have < r2.ncode; ) {
                  for (; l2 < 3; ) {
                    if (0 === o2) break e;
                    o2--, u2 += n2[s2++] << l2, l2 += 8;
                  }
                  r2.lens[A[r2.have++]] = 7 & u2, u2 >>>= 3, l2 -= 3;
                }
                for (; r2.have < 19; ) r2.lens[A[r2.have++]] = 0;
                if (r2.lencode = r2.lendyn, r2.lenbits = 7, S = { bits: r2.lenbits }, x = T(0, r2.lens, 0, 19, r2.lencode, 0, r2.work, S), r2.lenbits = S.bits, x) {
                  e2.msg = "invalid code lengths set", r2.mode = 30;
                  break;
                }
                r2.have = 0, r2.mode = 19;
              case 19:
                for (; r2.have < r2.nlen + r2.ndist; ) {
                  for (; g = (C = r2.lencode[u2 & (1 << r2.lenbits) - 1]) >>> 16 & 255, b = 65535 & C, !((_ = C >>> 24) <= l2); ) {
                    if (0 === o2) break e;
                    o2--, u2 += n2[s2++] << l2, l2 += 8;
                  }
                  if (b < 16) u2 >>>= _, l2 -= _, r2.lens[r2.have++] = b;
                  else {
                    if (16 === b) {
                      for (z = _ + 2; l2 < z; ) {
                        if (0 === o2) break e;
                        o2--, u2 += n2[s2++] << l2, l2 += 8;
                      }
                      if (u2 >>>= _, l2 -= _, 0 === r2.have) {
                        e2.msg = "invalid bit length repeat", r2.mode = 30;
                        break;
                      }
                      k = r2.lens[r2.have - 1], d = 3 + (3 & u2), u2 >>>= 2, l2 -= 2;
                    } else if (17 === b) {
                      for (z = _ + 3; l2 < z; ) {
                        if (0 === o2) break e;
                        o2--, u2 += n2[s2++] << l2, l2 += 8;
                      }
                      l2 -= _, k = 0, d = 3 + (7 & (u2 >>>= _)), u2 >>>= 3, l2 -= 3;
                    } else {
                      for (z = _ + 7; l2 < z; ) {
                        if (0 === o2) break e;
                        o2--, u2 += n2[s2++] << l2, l2 += 8;
                      }
                      l2 -= _, k = 0, d = 11 + (127 & (u2 >>>= _)), u2 >>>= 7, l2 -= 7;
                    }
                    if (r2.have + d > r2.nlen + r2.ndist) {
                      e2.msg = "invalid bit length repeat", r2.mode = 30;
                      break;
                    }
                    for (; d--; ) r2.lens[r2.have++] = k;
                  }
                }
                if (30 === r2.mode) break;
                if (0 === r2.lens[256]) {
                  e2.msg = "invalid code -- missing end-of-block", r2.mode = 30;
                  break;
                }
                if (r2.lenbits = 9, S = { bits: r2.lenbits }, x = T(D, r2.lens, 0, r2.nlen, r2.lencode, 0, r2.work, S), r2.lenbits = S.bits, x) {
                  e2.msg = "invalid literal/lengths set", r2.mode = 30;
                  break;
                }
                if (r2.distbits = 6, r2.distcode = r2.distdyn, S = { bits: r2.distbits }, x = T(F, r2.lens, r2.nlen, r2.ndist, r2.distcode, 0, r2.work, S), r2.distbits = S.bits, x) {
                  e2.msg = "invalid distances set", r2.mode = 30;
                  break;
                }
                if (r2.mode = 20, 6 === t2) break e;
              case 20:
                r2.mode = 21;
              case 21:
                if (6 <= o2 && 258 <= h2) {
                  e2.next_out = a2, e2.avail_out = h2, e2.next_in = s2, e2.avail_in = o2, r2.hold = u2, r2.bits = l2, R(e2, c2), a2 = e2.next_out, i2 = e2.output, h2 = e2.avail_out, s2 = e2.next_in, n2 = e2.input, o2 = e2.avail_in, u2 = r2.hold, l2 = r2.bits, 12 === r2.mode && (r2.back = -1);
                  break;
                }
                for (r2.back = 0; g = (C = r2.lencode[u2 & (1 << r2.lenbits) - 1]) >>> 16 & 255, b = 65535 & C, !((_ = C >>> 24) <= l2); ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s2++] << l2, l2 += 8;
                }
                if (g && 0 == (240 & g)) {
                  for (v = _, y = g, w = b; g = (C = r2.lencode[w + ((u2 & (1 << v + y) - 1) >> v)]) >>> 16 & 255, b = 65535 & C, !(v + (_ = C >>> 24) <= l2); ) {
                    if (0 === o2) break e;
                    o2--, u2 += n2[s2++] << l2, l2 += 8;
                  }
                  u2 >>>= v, l2 -= v, r2.back += v;
                }
                if (u2 >>>= _, l2 -= _, r2.back += _, r2.length = b, 0 === g) {
                  r2.mode = 26;
                  break;
                }
                if (32 & g) {
                  r2.back = -1, r2.mode = 12;
                  break;
                }
                if (64 & g) {
                  e2.msg = "invalid literal/length code", r2.mode = 30;
                  break;
                }
                r2.extra = 15 & g, r2.mode = 22;
              case 22:
                if (r2.extra) {
                  for (z = r2.extra; l2 < z; ) {
                    if (0 === o2) break e;
                    o2--, u2 += n2[s2++] << l2, l2 += 8;
                  }
                  r2.length += u2 & (1 << r2.extra) - 1, u2 >>>= r2.extra, l2 -= r2.extra, r2.back += r2.extra;
                }
                r2.was = r2.length, r2.mode = 23;
              case 23:
                for (; g = (C = r2.distcode[u2 & (1 << r2.distbits) - 1]) >>> 16 & 255, b = 65535 & C, !((_ = C >>> 24) <= l2); ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s2++] << l2, l2 += 8;
                }
                if (0 == (240 & g)) {
                  for (v = _, y = g, w = b; g = (C = r2.distcode[w + ((u2 & (1 << v + y) - 1) >> v)]) >>> 16 & 255, b = 65535 & C, !(v + (_ = C >>> 24) <= l2); ) {
                    if (0 === o2) break e;
                    o2--, u2 += n2[s2++] << l2, l2 += 8;
                  }
                  u2 >>>= v, l2 -= v, r2.back += v;
                }
                if (u2 >>>= _, l2 -= _, r2.back += _, 64 & g) {
                  e2.msg = "invalid distance code", r2.mode = 30;
                  break;
                }
                r2.offset = b, r2.extra = 15 & g, r2.mode = 24;
              case 24:
                if (r2.extra) {
                  for (z = r2.extra; l2 < z; ) {
                    if (0 === o2) break e;
                    o2--, u2 += n2[s2++] << l2, l2 += 8;
                  }
                  r2.offset += u2 & (1 << r2.extra) - 1, u2 >>>= r2.extra, l2 -= r2.extra, r2.back += r2.extra;
                }
                if (r2.offset > r2.dmax) {
                  e2.msg = "invalid distance too far back", r2.mode = 30;
                  break;
                }
                r2.mode = 25;
              case 25:
                if (0 === h2) break e;
                if (d = c2 - h2, r2.offset > d) {
                  if ((d = r2.offset - d) > r2.whave && r2.sane) {
                    e2.msg = "invalid distance too far back", r2.mode = 30;
                    break;
                  }
                  p = d > r2.wnext ? (d -= r2.wnext, r2.wsize - d) : r2.wnext - d, d > r2.length && (d = r2.length), m = r2.window;
                } else m = i2, p = a2 - r2.offset, d = r2.length;
                for (h2 < d && (d = h2), h2 -= d, r2.length -= d; i2[a2++] = m[p++], --d; ) ;
                0 === r2.length && (r2.mode = 21);
                break;
              case 26:
                if (0 === h2) break e;
                i2[a2++] = r2.length, h2--, r2.mode = 21;
                break;
              case 27:
                if (r2.wrap) {
                  for (; l2 < 32; ) {
                    if (0 === o2) break e;
                    o2--, u2 |= n2[s2++] << l2, l2 += 8;
                  }
                  if (c2 -= h2, e2.total_out += c2, r2.total += c2, c2 && (e2.adler = r2.check = r2.flags ? B(r2.check, i2, c2, a2 - c2) : O(r2.check, i2, c2, a2 - c2)), c2 = h2, (r2.flags ? u2 : L(u2)) !== r2.check) {
                    e2.msg = "incorrect data check", r2.mode = 30;
                    break;
                  }
                  l2 = u2 = 0;
                }
                r2.mode = 28;
              case 28:
                if (r2.wrap && r2.flags) {
                  for (; l2 < 32; ) {
                    if (0 === o2) break e;
                    o2--, u2 += n2[s2++] << l2, l2 += 8;
                  }
                  if (u2 !== (4294967295 & r2.total)) {
                    e2.msg = "incorrect length check", r2.mode = 30;
                    break;
                  }
                  l2 = u2 = 0;
                }
                r2.mode = 29;
              case 29:
                x = 1;
                break e;
              case 30:
                x = -3;
                break e;
              case 31:
                return -4;
              case 32:
              default:
                return U;
            }
            return e2.next_out = a2, e2.avail_out = h2, e2.next_in = s2, e2.avail_in = o2, r2.hold = u2, r2.bits = l2, (r2.wsize || c2 !== e2.avail_out && r2.mode < 30 && (r2.mode < 27 || 4 !== t2)) && Z(e2, e2.output, e2.next_out, c2 - e2.avail_out) ? (r2.mode = 31, -4) : (f2 -= e2.avail_in, c2 -= e2.avail_out, e2.total_in += f2, e2.total_out += c2, r2.total += c2, r2.wrap && c2 && (e2.adler = r2.check = r2.flags ? B(r2.check, i2, c2, e2.next_out - c2) : O(r2.check, i2, c2, e2.next_out - c2)), e2.data_type = r2.bits + (r2.last ? 64 : 0) + (12 === r2.mode ? 128 : 0) + (20 === r2.mode || 15 === r2.mode ? 256 : 0), (0 == f2 && 0 === c2 || 4 === t2) && x === N && (x = -5), x);
          }, r.inflateEnd = function(e2) {
            if (!e2 || !e2.state) return U;
            var t2 = e2.state;
            return t2.window && (t2.window = null), e2.state = null, N;
          }, r.inflateGetHeader = function(e2, t2) {
            var r2;
            return e2 && e2.state ? 0 == (2 & (r2 = e2.state).wrap) ? U : ((r2.head = t2).done = false, N) : U;
          }, r.inflateSetDictionary = function(e2, t2) {
            var r2, n2 = t2.length;
            return e2 && e2.state ? 0 !== (r2 = e2.state).wrap && 11 !== r2.mode ? U : 11 === r2.mode && O(1, t2, n2, 0) !== r2.check ? -3 : Z(e2, t2, n2, n2) ? (r2.mode = 31, -4) : (r2.havedict = 1, N) : U;
          }, r.inflateInfo = "pako inflate (from Nodeca project)";
        }, { "../utils/common": 41, "./adler32": 43, "./crc32": 45, "./inffast": 48, "./inftrees": 50 }], 50: [function(e, t, r) {
          "use strict";
          var D = e("../utils/common"), F = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258, 0, 0], N = [16, 16, 16, 16, 16, 16, 16, 16, 17, 17, 17, 17, 18, 18, 18, 18, 19, 19, 19, 19, 20, 20, 20, 20, 21, 21, 21, 21, 16, 72, 78], U = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577, 0, 0], P = [16, 16, 16, 16, 17, 17, 18, 18, 19, 19, 20, 20, 21, 21, 22, 22, 23, 23, 24, 24, 25, 25, 26, 26, 27, 27, 28, 28, 29, 29, 64, 64];
          t.exports = function(e2, t2, r2, n, i, s, a, o) {
            var h, u, l, f, c, d, p, m, _, g = o.bits, b = 0, v = 0, y = 0, w = 0, k = 0, x = 0, S = 0, z = 0, C = 0, E = 0, A = null, I = 0, O = new D.Buf16(16), B = new D.Buf16(16), R = null, T = 0;
            for (b = 0; b <= 15; b++) O[b] = 0;
            for (v = 0; v < n; v++) O[t2[r2 + v]]++;
            for (k = g, w = 15; 1 <= w && 0 === O[w]; w--) ;
            if (w < k && (k = w), 0 === w) return i[s++] = 20971520, i[s++] = 20971520, o.bits = 1, 0;
            for (y = 1; y < w && 0 === O[y]; y++) ;
            for (k < y && (k = y), b = z = 1; b <= 15; b++) if (z <<= 1, (z -= O[b]) < 0) return -1;
            if (0 < z && (0 === e2 || 1 !== w)) return -1;
            for (B[1] = 0, b = 1; b < 15; b++) B[b + 1] = B[b] + O[b];
            for (v = 0; v < n; v++) 0 !== t2[r2 + v] && (a[B[t2[r2 + v]]++] = v);
            if (d = 0 === e2 ? (A = R = a, 19) : 1 === e2 ? (A = F, I -= 257, R = N, T -= 257, 256) : (A = U, R = P, -1), b = y, c = s, S = v = E = 0, l = -1, f = (C = 1 << (x = k)) - 1, 1 === e2 && 852 < C || 2 === e2 && 592 < C) return 1;
            for (; ; ) {
              for (p = b - S, _ = a[v] < d ? (m = 0, a[v]) : a[v] > d ? (m = R[T + a[v]], A[I + a[v]]) : (m = 96, 0), h = 1 << b - S, y = u = 1 << x; i[c + (E >> S) + (u -= h)] = p << 24 | m << 16 | _ | 0, 0 !== u; ) ;
              for (h = 1 << b - 1; E & h; ) h >>= 1;
              if (0 !== h ? (E &= h - 1, E += h) : E = 0, v++, 0 == --O[b]) {
                if (b === w) break;
                b = t2[r2 + a[v]];
              }
              if (k < b && (E & f) !== l) {
                for (0 === S && (S = k), c += y, z = 1 << (x = b - S); x + S < w && !((z -= O[x + S]) <= 0); ) x++, z <<= 1;
                if (C += 1 << x, 1 === e2 && 852 < C || 2 === e2 && 592 < C) return 1;
                i[l = E & f] = k << 24 | x << 16 | c - s | 0;
              }
            }
            return 0 !== E && (i[c + E] = b - S << 24 | 64 << 16 | 0), o.bits = k, 0;
          };
        }, { "../utils/common": 41 }], 51: [function(e, t, r) {
          "use strict";
          t.exports = { 2: "need dictionary", 1: "stream end", 0: "", "-1": "file error", "-2": "stream error", "-3": "data error", "-4": "insufficient memory", "-5": "buffer error", "-6": "incompatible version" };
        }, {}], 52: [function(e, t, r) {
          "use strict";
          var i = e("../utils/common"), o = 0, h = 1;
          function n(e2) {
            for (var t2 = e2.length; 0 <= --t2; ) e2[t2] = 0;
          }
          var s = 0, a = 29, u = 256, l = u + 1 + a, f = 30, c = 19, _ = 2 * l + 1, g = 15, d = 16, p = 7, m = 256, b = 16, v = 17, y = 18, w = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0], k = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13], x = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 7], S = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15], z = new Array(2 * (l + 2));
          n(z);
          var C = new Array(2 * f);
          n(C);
          var E = new Array(512);
          n(E);
          var A = new Array(256);
          n(A);
          var I = new Array(a);
          n(I);
          var O, B, R, T = new Array(f);
          function D(e2, t2, r2, n2, i2) {
            this.static_tree = e2, this.extra_bits = t2, this.extra_base = r2, this.elems = n2, this.max_length = i2, this.has_stree = e2 && e2.length;
          }
          function F(e2, t2) {
            this.dyn_tree = e2, this.max_code = 0, this.stat_desc = t2;
          }
          function N(e2) {
            return e2 < 256 ? E[e2] : E[256 + (e2 >>> 7)];
          }
          function U(e2, t2) {
            e2.pending_buf[e2.pending++] = 255 & t2, e2.pending_buf[e2.pending++] = t2 >>> 8 & 255;
          }
          function P(e2, t2, r2) {
            e2.bi_valid > d - r2 ? (e2.bi_buf |= t2 << e2.bi_valid & 65535, U(e2, e2.bi_buf), e2.bi_buf = t2 >> d - e2.bi_valid, e2.bi_valid += r2 - d) : (e2.bi_buf |= t2 << e2.bi_valid & 65535, e2.bi_valid += r2);
          }
          function L(e2, t2, r2) {
            P(e2, r2[2 * t2], r2[2 * t2 + 1]);
          }
          function j(e2, t2) {
            for (var r2 = 0; r2 |= 1 & e2, e2 >>>= 1, r2 <<= 1, 0 < --t2; ) ;
            return r2 >>> 1;
          }
          function Z(e2, t2, r2) {
            var n2, i2, s2 = new Array(g + 1), a2 = 0;
            for (n2 = 1; n2 <= g; n2++) s2[n2] = a2 = a2 + r2[n2 - 1] << 1;
            for (i2 = 0; i2 <= t2; i2++) {
              var o2 = e2[2 * i2 + 1];
              0 !== o2 && (e2[2 * i2] = j(s2[o2]++, o2));
            }
          }
          function W(e2) {
            var t2;
            for (t2 = 0; t2 < l; t2++) e2.dyn_ltree[2 * t2] = 0;
            for (t2 = 0; t2 < f; t2++) e2.dyn_dtree[2 * t2] = 0;
            for (t2 = 0; t2 < c; t2++) e2.bl_tree[2 * t2] = 0;
            e2.dyn_ltree[2 * m] = 1, e2.opt_len = e2.static_len = 0, e2.last_lit = e2.matches = 0;
          }
          function M(e2) {
            8 < e2.bi_valid ? U(e2, e2.bi_buf) : 0 < e2.bi_valid && (e2.pending_buf[e2.pending++] = e2.bi_buf), e2.bi_buf = 0, e2.bi_valid = 0;
          }
          function H(e2, t2, r2, n2) {
            var i2 = 2 * t2, s2 = 2 * r2;
            return e2[i2] < e2[s2] || e2[i2] === e2[s2] && n2[t2] <= n2[r2];
          }
          function G(e2, t2, r2) {
            for (var n2 = e2.heap[r2], i2 = r2 << 1; i2 <= e2.heap_len && (i2 < e2.heap_len && H(t2, e2.heap[i2 + 1], e2.heap[i2], e2.depth) && i2++, !H(t2, n2, e2.heap[i2], e2.depth)); ) e2.heap[r2] = e2.heap[i2], r2 = i2, i2 <<= 1;
            e2.heap[r2] = n2;
          }
          function K(e2, t2, r2) {
            var n2, i2, s2, a2, o2 = 0;
            if (0 !== e2.last_lit) for (; n2 = e2.pending_buf[e2.d_buf + 2 * o2] << 8 | e2.pending_buf[e2.d_buf + 2 * o2 + 1], i2 = e2.pending_buf[e2.l_buf + o2], o2++, 0 === n2 ? L(e2, i2, t2) : (L(e2, (s2 = A[i2]) + u + 1, t2), 0 !== (a2 = w[s2]) && P(e2, i2 -= I[s2], a2), L(e2, s2 = N(--n2), r2), 0 !== (a2 = k[s2]) && P(e2, n2 -= T[s2], a2)), o2 < e2.last_lit; ) ;
            L(e2, m, t2);
          }
          function Y(e2, t2) {
            var r2, n2, i2, s2 = t2.dyn_tree, a2 = t2.stat_desc.static_tree, o2 = t2.stat_desc.has_stree, h2 = t2.stat_desc.elems, u2 = -1;
            for (e2.heap_len = 0, e2.heap_max = _, r2 = 0; r2 < h2; r2++) 0 !== s2[2 * r2] ? (e2.heap[++e2.heap_len] = u2 = r2, e2.depth[r2] = 0) : s2[2 * r2 + 1] = 0;
            for (; e2.heap_len < 2; ) s2[2 * (i2 = e2.heap[++e2.heap_len] = u2 < 2 ? ++u2 : 0)] = 1, e2.depth[i2] = 0, e2.opt_len--, o2 && (e2.static_len -= a2[2 * i2 + 1]);
            for (t2.max_code = u2, r2 = e2.heap_len >> 1; 1 <= r2; r2--) G(e2, s2, r2);
            for (i2 = h2; r2 = e2.heap[1], e2.heap[1] = e2.heap[e2.heap_len--], G(e2, s2, 1), n2 = e2.heap[1], e2.heap[--e2.heap_max] = r2, e2.heap[--e2.heap_max] = n2, s2[2 * i2] = s2[2 * r2] + s2[2 * n2], e2.depth[i2] = (e2.depth[r2] >= e2.depth[n2] ? e2.depth[r2] : e2.depth[n2]) + 1, s2[2 * r2 + 1] = s2[2 * n2 + 1] = i2, e2.heap[1] = i2++, G(e2, s2, 1), 2 <= e2.heap_len; ) ;
            e2.heap[--e2.heap_max] = e2.heap[1], (function(e3, t3) {
              var r3, n3, i3, s3, a3, o3, h3 = t3.dyn_tree, u3 = t3.max_code, l2 = t3.stat_desc.static_tree, f2 = t3.stat_desc.has_stree, c2 = t3.stat_desc.extra_bits, d2 = t3.stat_desc.extra_base, p2 = t3.stat_desc.max_length, m2 = 0;
              for (s3 = 0; s3 <= g; s3++) e3.bl_count[s3] = 0;
              for (h3[2 * e3.heap[e3.heap_max] + 1] = 0, r3 = e3.heap_max + 1; r3 < _; r3++) p2 < (s3 = h3[2 * h3[2 * (n3 = e3.heap[r3]) + 1] + 1] + 1) && (s3 = p2, m2++), h3[2 * n3 + 1] = s3, u3 < n3 || (e3.bl_count[s3]++, a3 = 0, d2 <= n3 && (a3 = c2[n3 - d2]), o3 = h3[2 * n3], e3.opt_len += o3 * (s3 + a3), f2 && (e3.static_len += o3 * (l2[2 * n3 + 1] + a3)));
              if (0 !== m2) {
                do {
                  for (s3 = p2 - 1; 0 === e3.bl_count[s3]; ) s3--;
                  e3.bl_count[s3]--, e3.bl_count[s3 + 1] += 2, e3.bl_count[p2]--, m2 -= 2;
                } while (0 < m2);
                for (s3 = p2; 0 !== s3; s3--) for (n3 = e3.bl_count[s3]; 0 !== n3; ) u3 < (i3 = e3.heap[--r3]) || (h3[2 * i3 + 1] !== s3 && (e3.opt_len += (s3 - h3[2 * i3 + 1]) * h3[2 * i3], h3[2 * i3 + 1] = s3), n3--);
              }
            })(e2, t2), Z(s2, u2, e2.bl_count);
          }
          function X(e2, t2, r2) {
            var n2, i2, s2 = -1, a2 = t2[1], o2 = 0, h2 = 7, u2 = 4;
            for (0 === a2 && (h2 = 138, u2 = 3), t2[2 * (r2 + 1) + 1] = 65535, n2 = 0; n2 <= r2; n2++) i2 = a2, a2 = t2[2 * (n2 + 1) + 1], ++o2 < h2 && i2 === a2 || (o2 < u2 ? e2.bl_tree[2 * i2] += o2 : 0 !== i2 ? (i2 !== s2 && e2.bl_tree[2 * i2]++, e2.bl_tree[2 * b]++) : o2 <= 10 ? e2.bl_tree[2 * v]++ : e2.bl_tree[2 * y]++, s2 = i2, u2 = (o2 = 0) === a2 ? (h2 = 138, 3) : i2 === a2 ? (h2 = 6, 3) : (h2 = 7, 4));
          }
          function V(e2, t2, r2) {
            var n2, i2, s2 = -1, a2 = t2[1], o2 = 0, h2 = 7, u2 = 4;
            for (0 === a2 && (h2 = 138, u2 = 3), n2 = 0; n2 <= r2; n2++) if (i2 = a2, a2 = t2[2 * (n2 + 1) + 1], !(++o2 < h2 && i2 === a2)) {
              if (o2 < u2) for (; L(e2, i2, e2.bl_tree), 0 != --o2; ) ;
              else 0 !== i2 ? (i2 !== s2 && (L(e2, i2, e2.bl_tree), o2--), L(e2, b, e2.bl_tree), P(e2, o2 - 3, 2)) : o2 <= 10 ? (L(e2, v, e2.bl_tree), P(e2, o2 - 3, 3)) : (L(e2, y, e2.bl_tree), P(e2, o2 - 11, 7));
              s2 = i2, u2 = (o2 = 0) === a2 ? (h2 = 138, 3) : i2 === a2 ? (h2 = 6, 3) : (h2 = 7, 4);
            }
          }
          n(T);
          var q = false;
          function J(e2, t2, r2, n2) {
            P(e2, (s << 1) + (n2 ? 1 : 0), 3), (function(e3, t3, r3, n3) {
              M(e3), n3 && (U(e3, r3), U(e3, ~r3)), i.arraySet(e3.pending_buf, e3.window, t3, r3, e3.pending), e3.pending += r3;
            })(e2, t2, r2, true);
          }
          r._tr_init = function(e2) {
            q || ((function() {
              var e3, t2, r2, n2, i2, s2 = new Array(g + 1);
              for (n2 = r2 = 0; n2 < a - 1; n2++) for (I[n2] = r2, e3 = 0; e3 < 1 << w[n2]; e3++) A[r2++] = n2;
              for (A[r2 - 1] = n2, n2 = i2 = 0; n2 < 16; n2++) for (T[n2] = i2, e3 = 0; e3 < 1 << k[n2]; e3++) E[i2++] = n2;
              for (i2 >>= 7; n2 < f; n2++) for (T[n2] = i2 << 7, e3 = 0; e3 < 1 << k[n2] - 7; e3++) E[256 + i2++] = n2;
              for (t2 = 0; t2 <= g; t2++) s2[t2] = 0;
              for (e3 = 0; e3 <= 143; ) z[2 * e3 + 1] = 8, e3++, s2[8]++;
              for (; e3 <= 255; ) z[2 * e3 + 1] = 9, e3++, s2[9]++;
              for (; e3 <= 279; ) z[2 * e3 + 1] = 7, e3++, s2[7]++;
              for (; e3 <= 287; ) z[2 * e3 + 1] = 8, e3++, s2[8]++;
              for (Z(z, l + 1, s2), e3 = 0; e3 < f; e3++) C[2 * e3 + 1] = 5, C[2 * e3] = j(e3, 5);
              O = new D(z, w, u + 1, l, g), B = new D(C, k, 0, f, g), R = new D(new Array(0), x, 0, c, p);
            })(), q = true), e2.l_desc = new F(e2.dyn_ltree, O), e2.d_desc = new F(e2.dyn_dtree, B), e2.bl_desc = new F(e2.bl_tree, R), e2.bi_buf = 0, e2.bi_valid = 0, W(e2);
          }, r._tr_stored_block = J, r._tr_flush_block = function(e2, t2, r2, n2) {
            var i2, s2, a2 = 0;
            0 < e2.level ? (2 === e2.strm.data_type && (e2.strm.data_type = (function(e3) {
              var t3, r3 = 4093624447;
              for (t3 = 0; t3 <= 31; t3++, r3 >>>= 1) if (1 & r3 && 0 !== e3.dyn_ltree[2 * t3]) return o;
              if (0 !== e3.dyn_ltree[18] || 0 !== e3.dyn_ltree[20] || 0 !== e3.dyn_ltree[26]) return h;
              for (t3 = 32; t3 < u; t3++) if (0 !== e3.dyn_ltree[2 * t3]) return h;
              return o;
            })(e2)), Y(e2, e2.l_desc), Y(e2, e2.d_desc), a2 = (function(e3) {
              var t3;
              for (X(e3, e3.dyn_ltree, e3.l_desc.max_code), X(e3, e3.dyn_dtree, e3.d_desc.max_code), Y(e3, e3.bl_desc), t3 = c - 1; 3 <= t3 && 0 === e3.bl_tree[2 * S[t3] + 1]; t3--) ;
              return e3.opt_len += 3 * (t3 + 1) + 5 + 5 + 4, t3;
            })(e2), i2 = e2.opt_len + 3 + 7 >>> 3, (s2 = e2.static_len + 3 + 7 >>> 3) <= i2 && (i2 = s2)) : i2 = s2 = r2 + 5, r2 + 4 <= i2 && -1 !== t2 ? J(e2, t2, r2, n2) : 4 === e2.strategy || s2 === i2 ? (P(e2, 2 + (n2 ? 1 : 0), 3), K(e2, z, C)) : (P(e2, 4 + (n2 ? 1 : 0), 3), (function(e3, t3, r3, n3) {
              var i3;
              for (P(e3, t3 - 257, 5), P(e3, r3 - 1, 5), P(e3, n3 - 4, 4), i3 = 0; i3 < n3; i3++) P(e3, e3.bl_tree[2 * S[i3] + 1], 3);
              V(e3, e3.dyn_ltree, t3 - 1), V(e3, e3.dyn_dtree, r3 - 1);
            })(e2, e2.l_desc.max_code + 1, e2.d_desc.max_code + 1, a2 + 1), K(e2, e2.dyn_ltree, e2.dyn_dtree)), W(e2), n2 && M(e2);
          }, r._tr_tally = function(e2, t2, r2) {
            return e2.pending_buf[e2.d_buf + 2 * e2.last_lit] = t2 >>> 8 & 255, e2.pending_buf[e2.d_buf + 2 * e2.last_lit + 1] = 255 & t2, e2.pending_buf[e2.l_buf + e2.last_lit] = 255 & r2, e2.last_lit++, 0 === t2 ? e2.dyn_ltree[2 * r2]++ : (e2.matches++, t2--, e2.dyn_ltree[2 * (A[r2] + u + 1)]++, e2.dyn_dtree[2 * N(t2)]++), e2.last_lit === e2.lit_bufsize - 1;
          }, r._tr_align = function(e2) {
            P(e2, 2, 3), L(e2, m, z), (function(e3) {
              16 === e3.bi_valid ? (U(e3, e3.bi_buf), e3.bi_buf = 0, e3.bi_valid = 0) : 8 <= e3.bi_valid && (e3.pending_buf[e3.pending++] = 255 & e3.bi_buf, e3.bi_buf >>= 8, e3.bi_valid -= 8);
            })(e2);
          };
        }, { "../utils/common": 41 }], 53: [function(e, t, r) {
          "use strict";
          t.exports = function() {
            this.input = null, this.next_in = 0, this.avail_in = 0, this.total_in = 0, this.output = null, this.next_out = 0, this.avail_out = 0, this.total_out = 0, this.msg = "", this.state = null, this.data_type = 2, this.adler = 0;
          };
        }, {}], 54: [function(e, t, r) {
          (function(e2) {
            !(function(r2, n) {
              "use strict";
              if (!r2.setImmediate) {
                var i, s, t2, a, o = 1, h = {}, u = false, l = r2.document, e3 = Object.getPrototypeOf && Object.getPrototypeOf(r2);
                e3 = e3 && e3.setTimeout ? e3 : r2, i = "[object process]" === {}.toString.call(r2.process) ? function(e4) {
                  process.nextTick(function() {
                    c(e4);
                  });
                } : (function() {
                  if (r2.postMessage && !r2.importScripts) {
                    var e4 = true, t3 = r2.onmessage;
                    return r2.onmessage = function() {
                      e4 = false;
                    }, r2.postMessage("", "*"), r2.onmessage = t3, e4;
                  }
                })() ? (a = "setImmediate$" + Math.random() + "$", r2.addEventListener ? r2.addEventListener("message", d, false) : r2.attachEvent("onmessage", d), function(e4) {
                  r2.postMessage(a + e4, "*");
                }) : r2.MessageChannel ? ((t2 = new MessageChannel()).port1.onmessage = function(e4) {
                  c(e4.data);
                }, function(e4) {
                  t2.port2.postMessage(e4);
                }) : l && "onreadystatechange" in l.createElement("script") ? (s = l.documentElement, function(e4) {
                  var t3 = l.createElement("script");
                  t3.onreadystatechange = function() {
                    c(e4), t3.onreadystatechange = null, s.removeChild(t3), t3 = null;
                  }, s.appendChild(t3);
                }) : function(e4) {
                  setTimeout(c, 0, e4);
                }, e3.setImmediate = function(e4) {
                  "function" != typeof e4 && (e4 = new Function("" + e4));
                  for (var t3 = new Array(arguments.length - 1), r3 = 0; r3 < t3.length; r3++) t3[r3] = arguments[r3 + 1];
                  var n2 = { callback: e4, args: t3 };
                  return h[o] = n2, i(o), o++;
                }, e3.clearImmediate = f;
              }
              function f(e4) {
                delete h[e4];
              }
              function c(e4) {
                if (u) setTimeout(c, 0, e4);
                else {
                  var t3 = h[e4];
                  if (t3) {
                    u = true;
                    try {
                      !(function(e5) {
                        var t4 = e5.callback, r3 = e5.args;
                        switch (r3.length) {
                          case 0:
                            t4();
                            break;
                          case 1:
                            t4(r3[0]);
                            break;
                          case 2:
                            t4(r3[0], r3[1]);
                            break;
                          case 3:
                            t4(r3[0], r3[1], r3[2]);
                            break;
                          default:
                            t4.apply(n, r3);
                        }
                      })(t3);
                    } finally {
                      f(e4), u = false;
                    }
                  }
                }
              }
              function d(e4) {
                e4.source === r2 && "string" == typeof e4.data && 0 === e4.data.indexOf(a) && c(+e4.data.slice(a.length));
              }
            })("undefined" == typeof self ? void 0 === e2 ? this : e2 : self);
          }).call(this, "undefined" != typeof global ? global : "undefined" != typeof self ? self : "undefined" != typeof window ? window : {});
        }, {}] }, {}, [10])(10);
      });
    }
  });

  // src/import/browser-entry.ts
  var browser_entry_exports = {};
  __export(browser_entry_exports, {
    DEFAULT_TRIGGER_CONFIG: () => DEFAULT_TRIGGER_CONFIG,
    analyzeDataZip: () => analyzeDataZip,
    buildRpJsonContent: () => buildRpJsonContent,
    buildStV2Json: () => buildStV2Json,
    bytesToBase64: () => bytesToBase64,
    cardPromptPersona: () => cardPromptPersona,
    chatSessionId: () => chatSessionId,
    convertChatFile: () => convertChatFile,
    dshSlug: () => dshSlug,
    encodeSegment: () => encodeSegment,
    exportCardBundleFiles: () => exportCardBundleFiles,
    exportLoreBookSkill: () => exportLoreBookSkill,
    exportSingleCardFiles: () => exportSingleCardFiles,
    exportToDshFiles: () => exportToDshFiles,
    fetchImportCheckpoint: () => fetchImportCheckpoint,
    fetchImportPreview: () => fetchImportPreview,
    fetchImportProgress: () => fetchImportProgress,
    importCharacterJson: () => importCharacterJson,
    importCharacterPng: () => importCharacterPng,
    importLoreBook: () => importLoreBook,
    kickoffImport: () => kickoffImport,
    lastDataImport: () => lastDataImport,
    makePlaceholderPng: () => makePlaceholderPng,
    sessionFilePath: () => sessionFilePath,
    summarizeBundle: () => summarizeBundle,
    triggerWorldInfo: () => triggerWorldInfo,
    writeCardTextChunks: () => writeCardTextChunks
  });
  init_character_card();
  init_entry();

  // src/lore/trigger.ts
  function isTimedActive(effects, entryId, type, cursor) {
    return effects.some((e) => e.entryId === entryId && e.type === type && cursor >= e.start && cursor < e.end);
  }
  var DEFAULT_TRIGGER_CONFIG = {
    scanDepth: 2,
    maxRecursionSteps: 5,
    caseSensitive: false,
    matchWholeWords: true,
    budgetPercent: 25,
    budgetCap: 0,
    contextTokenLimit: 65536,
    cursor: 0,
    timedEffects: []
  };
  function keyToPattern(key, cfg) {
    const regexMatch = key.match(/^\/(.+)\/(\w*)$/);
    if (regexMatch) {
      const flags = regexMatch[2].includes("i") || !cfg.caseSensitive ? "i" : "";
      return new RegExp(regexMatch[1], flags);
    }
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const whole = cfg.matchWholeWords && !/\s/.test(key) ? `(?:^|\\W)(${escaped})(?:$|\\W)` : escaped;
    return new RegExp(whole, cfg.caseSensitive ? "" : "i");
  }
  function matchPrimary(entry, text, cfg) {
    for (const key of entry.keys) {
      try {
        if (keyToPattern(key, cfg).test(text)) return key;
      } catch {
      }
    }
    return null;
  }
  function matchSecondary(entry, text, cfg) {
    if (entry.secondaryKeys.length === 0) return true;
    const hits = entry.secondaryKeys.filter((k) => {
      try {
        return keyToPattern(k, cfg).test(text);
      } catch {
        return false;
      }
    });
    switch (entry.selectiveLogic) {
      case 0:
        return hits.length > 0;
      // AND_ANY：任一命中即可
      case 1:
        return hits.length === entry.secondaryKeys.length;
      // NOT_ALL：全部命中才否（此处表示"必须全不命中"→false 语义见下）
      case 2:
        return hits.length === 0;
      // NOT_ANY：任一命中即否
      case 3:
        return hits.length === entry.secondaryKeys.length;
      // AND_ALL：全部命中
      default:
        return hits.length > 0;
    }
  }
  function buildScanText(messages, scanDepth, entryOverride) {
    const depth = entryOverride != null && entryOverride > 0 ? entryOverride : scanDepth;
    return messages.slice(-depth).join("\n");
  }
  function dedupeGroups(items) {
    const self2 = /* @__PURE__ */ new Set();
    const groups = /* @__PURE__ */ new Map();
    for (const a of items) {
      const g = a.entry.group;
      if (!g || a.entry.groupOverride) {
        self2.add(a.entry.id);
        continue;
      }
      for (const name of String(g).split(",").map((s) => s.trim()).filter(Boolean)) {
        const list = groups.get(name) ?? [];
        list.push(a);
        groups.set(name, list);
      }
    }
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const a of items) {
      if (self2.has(a.entry.id) && !seen.has(a.entry.id)) {
        seen.add(a.entry.id);
        out.push(a);
      }
    }
    for (const list of groups.values()) {
      const winner = [...list].sort((x, y) => y.entry.insertionOrder - x.entry.insertionOrder)[0];
      if (winner && !seen.has(winner.entry.id)) {
        seen.add(winner.entry.id);
        out.push(winner);
      }
    }
    return out;
  }
  function triggerWorldInfo(entries, recentMessages, config = {}) {
    const cfg = { ...DEFAULT_TRIGGER_CONFIG, ...config };
    const activated = /* @__PURE__ */ new Map();
    const trace = [];
    const budgetDropped = [];
    const cursor = cfg.cursor;
    const priorEffects = (cfg.timedEffects ?? []).filter((e) => e.end > cursor);
    const newEffects = [];
    const stickyActive = (id) => isTimedActive(priorEffects, id, "sticky", cursor);
    const cooldownActive = (id) => isTimedActive(priorEffects, id, "cooldown", cursor);
    const activate = (entry, reason, round, key) => {
      activated.set(entry.id, { entry, reason });
      trace.push({ round, entryId: entry.id, key });
      if ((entry.sticky ?? 0) > 0 && !stickyActive(entry.id)) {
        newEffects.push({ entryId: entry.id, type: "sticky", start: cursor, end: cursor + entry.sticky });
      }
      if ((entry.cooldown ?? 0) > 0 && !cooldownActive(entry.id)) {
        newEffects.push({ entryId: entry.id, type: "cooldown", start: cursor, end: cursor + entry.cooldown });
      }
    };
    const delayBlocked = (entry) => (entry.delay ?? 0) > 0 && cursor < entry.delay;
    const scanText = buildScanText(recentMessages, cfg.scanDepth);
    for (const entry of entries) {
      if (!entry.enabled) continue;
      if (delayBlocked(entry)) continue;
      const isSticky = stickyActive(entry.id);
      if (!isSticky && cooldownActive(entry.id)) continue;
      if (isSticky) {
        activate(entry, "sticky", 0, "(sticky)");
        continue;
      }
      if (entry.constant) {
        activate(entry, "constant", 0, "(constant)");
        continue;
      }
      if (entry.keys.length === 0) continue;
      const hitKey = matchPrimary(entry, scanText, cfg);
      if (hitKey !== null && matchSecondary(entry, scanText, cfg)) {
        activate(entry, "primary", 0, hitKey);
      }
    }
    let recursionRounds = 0;
    for (let round = 1; round <= cfg.maxRecursionSteps; round++) {
      const activatedText = [...activated.values()].filter((a) => !a.entry.preventRecursion).map((a) => a.entry.content).join("\n");
      if (activatedText === "") break;
      let newHits = false;
      for (const entry of entries) {
        if (!entry.enabled || activated.has(entry.id)) continue;
        if (delayBlocked(entry)) continue;
        if (cooldownActive(entry.id)) continue;
        if (entry.excludeRecursion) continue;
        const hitKey = matchPrimary(entry, activatedText, cfg);
        if (hitKey !== null && matchSecondary(entry, activatedText, cfg)) {
          activate(entry, "recursion", round, hitKey);
          newHits = true;
        }
      }
      recursionRounds = round;
      if (!newHits) break;
    }
    const deduped = dedupeGroups([...activated.values()]);
    const estimateTokens = (s) => Math.ceil(s.length / 4);
    const budgetTokens = Math.floor(
      cfg.budgetPercent / 100 * cfg.contextTokenLimit
    );
    const cap = cfg.budgetCap > 0 ? Math.min(budgetTokens, cfg.budgetCap) : budgetTokens;
    const sorted = deduped.sort((a, b) => {
      if (a.entry.constant !== b.entry.constant) return a.entry.constant ? -1 : 1;
      return b.entry.insertionOrder - a.entry.insertionOrder;
    });
    let used = 0;
    const kept = [];
    for (const a of sorted) {
      const cost = estimateTokens(a.entry.content);
      if (used + cost > cap) {
        budgetDropped.push(a.entry);
        continue;
      }
      kept.push(a);
      used += cost;
    }
    return {
      activated: kept,
      recursionRounds,
      trace,
      estimatedTokens: used,
      budgetDropped,
      timedEffects: [...priorEffects, ...newEffects]
    };
  }

  // src/import/data-zip.ts
  var import_jszip = __toESM(require_jszip_min());
  init_entry();
  init_character_card();
  var _lastImport = null;
  function lastDataImport() {
    return _lastImport;
  }
  function norm(p) {
    return p.replace(/\\/g, "/");
  }
  function listDir(files, dirPrefix) {
    const prefix = dirPrefix.endsWith("/") ? dirPrefix : dirPrefix + "/";
    return files.map(norm).filter((f) => {
      if (!f.startsWith(prefix) || f.endsWith("/")) return false;
      return f.slice(prefix.length).indexOf("/") === -1;
    });
  }
  function listCharacterFiles(files, dirPrefix) {
    const prefix = dirPrefix.endsWith("/") ? dirPrefix : dirPrefix + "/";
    const out = [];
    for (const raw of files) {
      const f = norm(raw);
      if (!f.startsWith(prefix) || f.endsWith("/")) continue;
      const rel = f.slice(prefix.length);
      const lastSeg = rel.split("/").pop() ?? "";
      if (rel.indexOf("/") === -1) {
        if (/\.(png|json)$/i.test(rel)) out.push(f);
      } else if (/^character\.(png|json)$/i.test(lastSeg)) {
        out.push(f);
      }
    }
    return out;
  }
  var ST_MARKERS = ["worlds", "characters", "chats", "settings.json", "OpenAI Settings", "QuickReplies"];
  function detectRoot(files) {
    const normed = files.map(norm);
    const candidates = /* @__PURE__ */ new Set([""]);
    for (const f of normed) {
      const parts = f.split("/");
      if (parts.length >= 1 && parts[0]) candidates.add(parts[0]);
      if (parts.length >= 2) candidates.add(parts.slice(0, 2).join("/"));
    }
    let best = "";
    let bestScore = 0;
    for (const c of candidates) {
      const prefix = c === "" ? "" : c + "/";
      const score = ST_MARKERS.filter(
        (m) => normed.some((f) => f === prefix + m || f.startsWith(prefix + m + "/"))
      ).length;
      if (score >= 2 && (score > bestScore || score === bestScore && c.length > best.length)) {
        best = c;
        bestScore = score;
      }
    }
    return best;
  }
  function extractPersonas(sj) {
    const pu = sj.power_user && typeof sj.power_user === "object" ? sj.power_user : {};
    const avatarToName = pu.personas && typeof pu.personas === "object" ? pu.personas : {};
    const descMap = pu.persona_descriptions && typeof pu.persona_descriptions === "object" ? pu.persona_descriptions : {};
    const descOf = (name) => {
      const d = descMap[name];
      if (typeof d === "string") return d.trim();
      if (d && typeof d === "object") {
        const inner = d.description;
        if (typeof inner === "string") return inner.trim();
      }
      return "";
    };
    let defaultName = null;
    const dp = pu.default_persona;
    if (typeof dp === "string" && dp.trim()) {
      const key = dp.trim();
      const mapped = avatarToName[key];
      defaultName = typeof mapped === "string" && mapped.trim() ? mapped.trim() : key;
    }
    const personas = [];
    const seen = /* @__PURE__ */ new Set();
    for (const [avatar, raw] of Object.entries(avatarToName)) {
      if (typeof raw !== "string" || !raw.trim()) continue;
      const name = raw.trim();
      if (seen.has(name)) continue;
      seen.add(name);
      personas.push({ name, description: descOf(name), isDefault: name === defaultName, avatar });
    }
    if (defaultName && !seen.has(defaultName)) {
      personas.push({ name: defaultName, description: descOf(defaultName), isDefault: true, avatar: null });
      seen.add(defaultName);
    }
    if (defaultName === null && personas.length > 0) personas[0].isDefault = true;
    if (personas.length === 0) {
      const topDesc = sj.persona_descriptions && typeof sj.persona_descriptions === "object" ? sj.persona_descriptions : {};
      const legacy = typeof sj.persona_id === "string" ? topDesc[sj.persona_id] : void 0;
      if (legacy && typeof legacy === "object") {
        const l = legacy;
        const name = typeof l.name === "string" && l.name.trim() ? l.name.trim() : null;
        const desc = typeof l.description === "string" ? l.description.trim() : "";
        if (name) personas.push({ name, description: desc, isDefault: true, avatar: null });
      }
    }
    return personas;
  }
  async function analyzeDataZip(zipData, onProgress) {
    const report = {
      rootPath: "",
      stats: {
        characters: 0,
        charactersFailed: 0,
        worldBooks: 0,
        loreEntries: 0,
        presets: 0,
        chats: 0,
        chatFilesAnalyzed: 0,
        quickReplies: 0,
        themes: 0,
        backgrounds: 0,
        skippedFiles: 0
      },
      relations: {
        cardWorldPairs: [],
        cardWorldMissing: [],
        chatOwnerPairs: [],
        chatOrphans: [],
        globalSelectedBooks: [],
        globalSelectedMissing: [],
        pairingRate: 0
      },
      settings: {
        scanDepth: null,
        budgetPercent: null,
        caseSensitive: null,
        matchWholeWords: null,
        personaName: null,
        personaDescription: null,
        personas: []
      },
      compositeCards: [],
      warnings: []
    };
    onProgress?.(0, "\u89E3\u5305\u4E2D\u2026");
    const zip = await import_jszip.default.loadAsync(zipData);
    const allFiles = Object.keys(zip.files).filter((f) => !zip.files[f].dir);
    report.rootPath = detectRoot(allFiles);
    const root = report.rootPath ? report.rootPath + "/" : "";
    onProgress?.(0, `\u7ED3\u6784\u8BC6\u522B\uFF1A${report.rootPath || "\uFF08zip \u6839\uFF09"}\uFF0C\u5171 ${allFiles.length} \u4E2A\u6587\u4EF6`);
    const ttCount = allFiles.filter((f) => norm(f).startsWith("data/_tauritavern/") || norm(f).startsWith("_tauritavern/")).length;
    if (ttCount > 0) {
      report.warnings.push(`\u68C0\u6D4B\u5230 TauriTavern \u8FD0\u884C\u65F6\u6570\u636E\uFF08_tauritavern/\uFF0C${ttCount} \u4E2A\u6587\u4EF6\uFF0C\u542B agent-workspaces/checkpoints\uFF09\uFF1A\u4E0D\u5C5E\u4E8E ST \u751F\u6001\u5185\u5BB9\uFF0C\u5DF2\u8DF3\u8FC7\uFF08TT \u804A\u5929\u8BB0\u5F55\u8FC1\u79FB\u5728 M2 \u8BC4\u4F30\uFF09`);
    }
    const worlds = /* @__PURE__ */ new Map();
    const characters = [];
    const zipKey = (n) => Object.keys(zip.files).find((k) => norm(k) === n) ?? n;
    const worldFiles = listDir(allFiles, root + "worlds").filter((f) => f.endsWith(".json"));
    for (let i = 0; i < worldFiles.length; i++) {
      const f = worldFiles[i];
      onProgress?.(1, `\u89E3\u6790\u4E16\u754C\u4E66\uFF08${i + 1}/${worldFiles.length}\uFF09\u2026`, 15 + Math.round(i / Math.max(1, worldFiles.length) * 30));
      try {
        const text = await zip.files[zipKey(f)].async("string");
        const name = f.split("/").pop().replace(/\.json$/, "");
        const book = importLoreBook(name, JSON.parse(text));
        worlds.set(name, book);
        report.stats.worldBooks++;
        report.stats.loreEntries += book.entries.length;
        for (const w of book.importWarnings.slice(0, 3)) report.warnings.push(`\u300C${name}\u300D${w}`);
      } catch {
        report.stats.skippedFiles++;
        report.warnings.push(`\u4E16\u754C\u4E66\u89E3\u6790\u5931\u8D25\uFF1A${f}`);
      }
    }
    const charFiles = listCharacterFiles(allFiles, root + "characters");
    const avatarCandidates = listDir(allFiles, root + "characters").filter((f) => /\.png$/i.test(f));
    const avatarByDir = /* @__PURE__ */ new Map();
    for (const a of avatarCandidates) {
      const dir = a.split("/").slice(0, -1).join("/");
      if (!avatarByDir.has(dir)) avatarByDir.set(dir, a);
    }
    let charDone = 0;
    for (const f of charFiles) {
      if (/\.(png|json)$/i.test(f)) {
        onProgress?.(1, `\u89E3\u6790\u89D2\u8272\u5361\uFF08${charDone}/${charFiles.filter((x) => /\.(png|json)$/i.test(x)).length}\uFF09\u2026`, 45 + Math.round(charDone / Math.max(1, charFiles.length) * 25));
        try {
          let name = f.split("/").pop().replace(/\.(png|json)$/i, "");
          if (name.toLowerCase() === "character") {
            const parent = norm(f).split("/").slice(-2, -1)[0];
            if (parent) name = parent;
          }
          let card = null;
          if (/\.png$/i.test(f)) {
            const buf = await zip.files[zipKey(f)].async("uint8array");
            card = importCharacterPng(buf, name);
          } else {
            const text = await zip.files[zipKey(f)].async("string");
            card = (await Promise.resolve().then(() => (init_character_card(), character_card_exports))).importCharacterJson(text, name);
            if (card) {
              const dir = norm(f).split("/").slice(0, -1).join("/");
              const avatar = avatarByDir.get(dir);
              if (avatar) {
                try {
                  card.avatar = await zip.files[zipKey(avatar)].async("uint8array");
                } catch {
                }
              }
            }
          }
          if (card) {
            card.sourceFileName = name;
            characters.push(card);
            report.stats.characters++;
            report.compositeCards.push({
              name: card.name,
              embeddedBookEntries: card.embeddedBook?.entries.length ?? 0,
              embeddedRegexCount: card.embeddedRegex.length,
              hasDepthPrompt: card.depthPrompt !== null,
              externalWorldRef: card.externalWorldRef
            });
          } else {
            report.stats.charactersFailed++;
          }
        } catch {
          report.stats.charactersFailed++;
        }
        charDone++;
      }
    }
    report.stats.presets = listDir(allFiles, root + "OpenAI Settings").filter((f) => f.endsWith(".json")).length;
    report.stats.quickReplies = listDir(allFiles, root + "QuickReplies").filter((f) => f.endsWith(".json")).length;
    report.stats.themes = listDir(allFiles, root + "themes").filter((f) => f.endsWith(".json")).length;
    report.stats.backgrounds = listDir(allFiles, root + "backgrounds").length;
    onProgress?.(2, "\u91CD\u5EFA\u4EA4\u53C9\u5F15\u7528\u2026", 75);
    for (const card of characters) {
      if (card.externalWorldRef) {
        if (worlds.has(card.externalWorldRef)) {
          report.relations.cardWorldPairs.push({ card: card.name, world: card.externalWorldRef });
        } else {
          report.relations.cardWorldMissing.push({ card: card.name, world: card.externalWorldRef });
        }
      }
    }
    const chatDirs = /* @__PURE__ */ new Map();
    for (const f of allFiles) {
      const rel = norm(f).startsWith(root) ? norm(f).slice(root.length) : norm(f);
      const m = rel.match(/^chats\/([^/]+)\/.+\.jsonl$/);
      if (m) {
        report.stats.chats++;
        chatDirs.set(decodeURIComponent(m[1]), (chatDirs.get(decodeURIComponent(m[1])) ?? 0) + 1);
      }
    }
    const normNameKey = (s) => s.replace(/\s+/g, "").toLowerCase();
    const cardByKey = /* @__PURE__ */ new Map();
    for (const c of characters) {
      for (const k of [c.name, c.sourceFileName ?? "", normNameKey(c.name)]) {
        if (k && !cardByKey.has(k)) cardByKey.set(k, c);
      }
    }
    for (const [dir, count] of chatDirs) {
      const hit = cardByKey.get(dir) ?? cardByKey.get(normNameKey(dir));
      if (hit) {
        report.relations.chatOwnerPairs.push({ character: hit.name, chatCount: count });
      } else {
        report.relations.chatOrphans.push({ dir, chatCount: count });
      }
    }
    let analyzed = 0;
    const chatJsonlFiles = allFiles.filter((f) => norm(f).startsWith(root + "chats/") && f.endsWith(".jsonl"));
    for (let i = 0; i < Math.min(50, chatJsonlFiles.length); i++) {
      const f = chatJsonlFiles[i];
      onProgress?.(4, `\u5206\u6790\u804A\u5929\u5143\u6570\u636E\uFF08${i + 1}/${Math.min(50, chatJsonlFiles.length)}\uFF09\u2026`, 80 + Math.round(i / Math.max(1, Math.min(50, chatJsonlFiles.length)) * 15));
      try {
        const text = await zip.files[f].async("string");
        const firstLine = text.split("\n")[0];
        const meta = JSON.parse(firstLine);
        if (meta && typeof meta === "object" && ("user_name" in meta || "chat_metadata" in meta)) {
          analyzed++;
        }
      } catch {
      }
    }
    report.stats.chatFilesAnalyzed = analyzed;
    onProgress?.(5, "\u63D0\u53D6\u5168\u5C40\u8BBE\u7F6E\u2026", 96);
    const settingsFile = zip.files[zipKey(root + "settings.json")];
    if (settingsFile) {
      try {
        const text = await settingsFile.async("string");
        const sj = JSON.parse(text);
        const wi = sj.world_info_settings ?? {};
        report.settings.scanDepth = typeof wi.world_info_depth === "number" ? wi.world_info_depth : null;
        report.settings.budgetPercent = typeof wi.world_info_budget === "number" ? wi.world_info_budget : null;
        report.settings.caseSensitive = typeof wi.world_info_case_sensitive === "boolean" ? wi.world_info_case_sensitive : null;
        report.settings.matchWholeWords = typeof wi.world_info_match_whole_words === "boolean" ? wi.world_info_match_whole_words : null;
        const personas = extractPersonas(sj);
        report.settings.personas = personas;
        const def = personas.find((p) => p.isDefault) ?? null;
        report.settings.personaName = def?.name ?? null;
        report.settings.personaDescription = def?.description || null;
        const gs = wi.world_info?.globalSelect;
        const gsNames = Array.isArray(gs) ? gs.map(String) : gs && typeof gs === "object" ? Object.keys(gs) : [];
        report.relations.globalSelectedBooks = gsNames;
        for (const n of gsNames) if (!worlds.has(n)) report.relations.globalSelectedMissing.push(n);
      } catch {
        report.warnings.push("settings.json \u89E3\u6790\u5931\u8D25\uFF08\u53EF\u80FD\u8FC7\u5927\u6216\u635F\u574F\uFF09");
      }
    }
    onProgress?.(6, "\u751F\u6210\u62A5\u544A\u2026", 99);
    const totalRefs = report.relations.cardWorldPairs.length + report.relations.cardWorldMissing.length + report.relations.globalSelectedBooks.length;
    const matched = report.relations.cardWorldPairs.length + (report.relations.globalSelectedBooks.length - report.relations.globalSelectedMissing.length);
    report.relations.pairingRate = totalRefs === 0 ? 100 : Math.round(matched / totalRefs * 100);
    _lastImport = {
      zip,
      root,
      worlds,
      characters,
      chatFiles: chatJsonlFiles.map((p) => {
        const rel = norm(p).startsWith(root) ? norm(p).slice(root.length) : norm(p);
        const ownerDir = decodeURIComponent(rel.split("/")[1] ?? "");
        return { path: p, ownerDir };
      }),
      report
    };
    onProgress?.(6, "\u5B8C\u6210", 100);
    return report;
  }

  // src/preset/schema.ts
  var DEFAULT_BUDGET = {
    maxToolRounds: 2,
    maxCallsPerRun: 8,
    delegationMaxPerRun: 8,
    delegationResultBudgetTokens: 8e3,
    modelRetry: { maxRetries: 3, intervalMs: 3e3 }
  };

  // src/preset/st-import.ts
  var MARKER_MAP = {
    chatHistory: "chatHistory",
    charDescription: "charDesc",
    charPersonality: "charPersonality",
    scenario: "scenario",
    personaDescription: "persona",
    worldInfoBefore: "worldBefore",
    worldInfoAfter: "worldAfter"
  };
  function hash36(input) {
    let h = 2166136261;
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }
  function nameSlug(name) {
    return name.trim().slice(0, 40);
  }
  var HEADER_BRACKET_RE = /^[〖【〔「『〈]/;
  var HEADER_DECOR_RE = /^(?:={2,}|-{3,}|#{1,3}\s)/;
  function isGroupHeader(p) {
    if (p.marker === true) return false;
    const name = typeof p.name === "string" ? p.name.trim() : "";
    if (!name) return false;
    const content = typeof p.content === "string" ? p.content.trim() : "";
    if (HEADER_BRACKET_RE.test(name)) return true;
    if (HEADER_DECOR_RE.test(name) && content.length <= 200) return true;
    return content.length <= 4 && name.length <= 30;
  }
  function groupLabel(raw) {
    const cleaned = raw.replace(/^[〖【〔「『〈\s=>\-#*～·]+/, "").replace(/[〗】〕」』〉\s=<\-*#～·]+$/, "").trim();
    return cleaned || raw.trim();
  }
  var SKILL_REF_PATH_RE = /[\w一-鿿-]+\/references\/[\w一-鿿./-]+\.md/i;
  var SKILL_HEADER_RE = /^#\s*\S*SKILL[：:]/m;
  function unwrapMacroWrappers(content) {
    let s = content.replace(/\{\{\/\/[^{}]*\}\}/g, "");
    s = s.replace(/\{\{setvar::([^{}]*)\}\}/g, (_m, inner) => {
      const at = inner.indexOf("::");
      return at >= 0 ? inner.slice(at + 2) : "";
    });
    return s.trim();
  }
  function dirSafe(raw, maxLen) {
    const safe = raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, maxLen).replace(/^-+|-+$/g, "");
    const base = safe === "" ? "block" : safe;
    const head = /^[a-z0-9]/.test(base) ? base : `b-${base}`;
    return `${head}-${hash36(raw).slice(0, 6)}`;
  }
  function extractSkillBlocks(presetId, prompts) {
    const out = [];
    const usedDirs = /* @__PURE__ */ new Set();
    for (const p of prompts) {
      if (p.marker === true) continue;
      if (isGroupHeader(p)) continue;
      const raw = typeof p.content === "string" ? p.content : "";
      if (!raw.trim()) continue;
      const body = unwrapMacroWrappers(raw);
      if (!SKILL_REF_PATH_RE.test(body) && !SKILL_HEADER_RE.test(body)) continue;
      const label = typeof p.name === "string" && p.name.trim() ? p.name.trim() : p.identifier ?? "block";
      let blockSlug = dirSafe(label, 24);
      let dir = `skills/preset-${dirSafe(presetId, 32)}/${blockSlug}`;
      while (usedDirs.has(dir)) {
        blockSlug = `${blockSlug}-${hash36(p.identifier ?? label).slice(0, 4)}`;
        dir = `skills/preset-${dirSafe(presetId, 32)}/${blockSlug}`;
      }
      usedDirs.add(dir);
      out.push({ dir, name: blockSlug, label, content: body });
    }
    return out;
  }
  var AGENT_NAME_RE = /[\[【]agent[\]】]|[\[【]代理[\]】]/i;
  var AGENT_CONTENT_RE = /subagent|sub-agent|multi-?agent|子代理|多\s*agent\s*编排/i;
  function isAgentPreset(displayName, prompts) {
    if (AGENT_NAME_RE.test(displayName)) return true;
    return prompts.some((p) => typeof p.content === "string" && AGENT_CONTENT_RE.test(p.content));
  }
  var CONFIG_NAME_RE = /自查|格式自检|检查格式|格式检查|输出前确认|输出前自查|输出前检查|输出规则确认|rules?\s*check|self[-\s]?check|preflight|配置/i;
  var CONFIG_CONTENT_RE = /自查|格式自检|检查格式|格式检查|输出前确认|输出前自查|输出规则确认|rules?\s*check|self[-\s]?check/i;
  var TIER_CONTENT_MAX = 4e3;
  var INNER_OS_NAME_RE = /内心|思维|思考链|\bthink|\bos\b/i;
  var INNER_OS_CONTENT_RE = /思维链|内心\s*os|思考链/i;
  var SUBAGENT_NAME_RE = /\bplanner\b|\bwriter\b|\breviewer\b|\bsubagent\b|\bsub-agent\b|子代理|多代理|剧情分工|角色分工|角色扮演分工/i;
  var SUBAGENT_CONTENT_RE = /\bplanner\b|\bwriter\b|\breviewer\b|\bsubagent\b|\bsub-agent\b|子代理|剧情分工|角色分工|角色扮演分工/gi;
  var SUBAGENT_CONTENT_MIN_HITS = 2;
  function classifyStAgentEntry(p) {
    const label = `${typeof p.name === "string" ? p.name : ""}
${typeof p.identifier === "string" ? p.identifier : ""}`;
    const body = unwrapMacroWrappers(typeof p.content === "string" ? p.content : "");
    if (CONFIG_NAME_RE.test(label)) return "config";
    if (body.length <= TIER_CONTENT_MAX && CONFIG_CONTENT_RE.test(body)) return "config";
    if (SUBAGENT_NAME_RE.test(label)) return "subagent";
    if ((body.match(SUBAGENT_CONTENT_RE)?.length ?? 0) >= SUBAGENT_CONTENT_MIN_HITS) return "subagent";
    if (INNER_OS_NAME_RE.test(label)) return "innerOs";
    if (body.length <= TIER_CONTENT_MAX && INNER_OS_CONTENT_RE.test(body)) return "innerOs";
    return null;
  }
  function detectAgentComposition(displayName, prompts) {
    if (isAgentPreset(displayName, prompts)) return true;
    for (const p of prompts) {
      const label = `${typeof p.name === "string" ? p.name : ""}
${typeof p.identifier === "string" ? p.identifier : ""}`;
      if (SUBAGENT_NAME_RE.test(label)) return true;
      const body = unwrapMacroWrappers(typeof p.content === "string" ? p.content : "");
      if ((body.match(SUBAGENT_CONTENT_RE)?.length ?? 0) >= SUBAGENT_CONTENT_MIN_HITS) return true;
    }
    return false;
  }
  function sanitizeSkillName(raw) {
    const s = raw.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60).trim();
    return s || `skill-${hash36(raw).slice(0, 6)}`;
  }
  function pendingSkillDir(skillName) {
    return `skills/${dirSafe(skillName, 48)}`;
  }
  function parseStStopSequences(raw) {
    let arr = raw;
    if (typeof raw === "string") {
      const t = raw.trim();
      if (!t) return void 0;
      try {
        arr = JSON.parse(t);
      } catch {
        return [t];
      }
    }
    if (!Array.isArray(arr)) return void 0;
    const seqs = arr.filter((s) => typeof s === "string" && s.length > 0);
    return seqs.length > 0 ? seqs : void 0;
  }
  function parseStLogitBias(raw) {
    if (!Array.isArray(raw)) return void 0;
    const out = [];
    for (const e of raw) {
      if (e === null || typeof e !== "object") continue;
      const text = e.text;
      const value = e.value;
      if (typeof text === "string" && typeof value === "number" && Number.isFinite(value)) {
        out.push({ text, value });
      }
    }
    return out.length > 0 ? out : void 0;
  }
  var MACRO_KEY = "A-Za-z0-9_.\u4E00-\u9FFF-";
  var SETVAR_RE = new RegExp(`\\{\\{setvar::([${MACRO_KEY}]+)::([^}]*)\\}\\}`, "g");
  var GETVAR_RE = new RegExp(`\\{\\{getvar::([${MACRO_KEY}]+)(?:::([^}]*))?\\}\\}`, "g");
  var BARE_MACRO_RE = new RegExp(`\\{\\{([${MACRO_KEY}]+)\\}\\}`, "g");
  var KNOWN_MACROS = /* @__PURE__ */ new Set([
    "user",
    "char",
    "persona",
    "group",
    "model",
    "cwd",
    "trim",
    "noop",
    "input",
    "lastusermessage",
    "lastcharmessage",
    "charifnotgroup"
  ]);
  function registerStMacros(contents) {
    const macros = {};
    const knownLower = /* @__PURE__ */ new Set();
    const has = (k) => knownLower.has(k.toLowerCase()) || Object.prototype.hasOwnProperty.call(macros, k);
    for (const text of contents) {
      SETVAR_RE.lastIndex = 0;
      for (const m of text.matchAll(SETVAR_RE)) {
        const key = m[1];
        macros[key] = m[2];
        knownLower.add(key.toLowerCase());
      }
    }
    for (const text of contents) {
      GETVAR_RE.lastIndex = 0;
      for (const m of text.matchAll(GETVAR_RE)) {
        const key = m[1];
        if (has(key)) continue;
        const fallback = typeof m[2] === "string" ? m[2] : "";
        macros[key] = fallback;
        knownLower.add(key.toLowerCase());
      }
      BARE_MACRO_RE.lastIndex = 0;
      for (const m of text.matchAll(BARE_MACRO_RE)) {
        const key = m[1];
        if (KNOWN_MACROS.has(key.toLowerCase()) || has(key)) continue;
        macros[key] = "";
        knownLower.add(key.toLowerCase());
      }
    }
    return Object.keys(macros).length > 0 ? macros : null;
  }
  function importStPreset(json, displayName) {
    const o = JSON.parse(json);
    const prompts = Array.isArray(o.prompts) ? o.prompts : [];
    const byId = /* @__PURE__ */ new Map();
    for (const p of prompts) {
      if (typeof p?.identifier === "string") byId.set(p.identifier, p);
    }
    const orders = (o.prompt_order ?? []).filter((po) => Array.isArray(po.order)).sort((a, b) => (a.character_id ?? Infinity) - (b.character_id ?? Infinity));
    const order = orders[0]?.order ?? [];
    const agent = detectAgentComposition(displayName, prompts);
    const configExtraParts = [];
    const pendingSkills = [];
    const subagentHints = [];
    const usedSkillNames = /* @__PURE__ */ new Set();
    let configSummaryPlaced = false;
    const slots = [];
    const usedIds = /* @__PURE__ */ new Set();
    let skipped = 0;
    const groups = [];
    let currentGroup = null;
    let sawHeader = false;
    const allOptions = [];
    for (const item of order) {
      const p = item?.identifier !== void 0 ? byId.get(item.identifier) : void 0;
      if (!p) {
        skipped++;
        continue;
      }
      const enabled = item.enabled === true;
      const name = typeof p.name === "string" && p.name.trim() ? p.name.trim() : p.identifier ?? "entry";
      if (p.marker === true) {
        const markerId = p.identifier !== void 0 ? MARKER_MAP[p.identifier] : void 0;
        if (!markerId) {
          skipped++;
          continue;
        }
        if (usedIds.has(markerId)) continue;
        usedIds.add(markerId);
        slots.push({ id: markerId, type: "marker", enabled });
        continue;
      }
      let id = nameSlug(name);
      if (usedIds.has(id)) id = `${id}-${hash36(p.identifier ?? name).slice(0, 4)}`;
      usedIds.add(id);
      const role = p.role === "user" || p.role === "assistant" ? p.role : "system";
      const rawContent = typeof p.content === "string" ? p.content : "";
      if (agent && !isGroupHeader(p)) {
        const tier = classifyStAgentEntry(p);
        if (tier === "config") {
          if (!configSummaryPlaced && !usedIds.has("configSummary")) {
            configSummaryPlaced = true;
            slots.push({ id: "configSummary", type: "configSummary", enabled: true });
          }
          const body = unwrapMacroWrappers(rawContent).trim();
          if (body) configExtraParts.push(body);
          continue;
        }
        if (tier === "subagent") {
          subagentHints.push(name);
          continue;
        }
        if (tier === "innerOs") {
          const body = unwrapMacroWrappers(rawContent).trim();
          if (!body) {
            skipped++;
            continue;
          }
          let skillName = sanitizeSkillName(id);
          if (usedSkillNames.has(skillName)) {
            skillName = sanitizeSkillName(`${id}-${hash36(p.identifier ?? name).slice(0, 4)}`);
          }
          usedSkillNames.add(skillName);
          pendingSkills.push({ name: skillName, content: body });
          slots.push({
            id,
            type: "skillRef",
            skill: skillName,
            content: `\u300C${name}\u300D\u5DF2\u5F52\u4F4D\u4E3A skill\u300C${skillName}\u300D\uFF08${pendingSkillDir(skillName)}/SKILL.md\uFF09\uFF1A\u9700\u8981\u8BE5\u5185\u5FC3 OS/\u601D\u7EF4\u94FE\u89C4\u5219\u65F6\u6309 skill \u673A\u5236\u8C03\u7528`,
            enabled,
            role
          });
          continue;
        }
      }
      const slot = {
        id,
        type: "system",
        content: rawContent,
        enabled,
        role
      };
      if (p.injection_position === 1 && typeof p.injection_depth === "number") slot.depth = p.injection_depth;
      slots.push(slot);
      if (isGroupHeader(p)) {
        sawHeader = true;
        currentGroup = { label: groupLabel(name), options: [] };
        groups.push(currentGroup);
      } else {
        const option = { id, label: name, content: slot.content ?? "", selected: enabled };
        allOptions.push(option);
        if (currentGroup === null) {
          currentGroup = { label: "\u672A\u5206\u7EC4", options: [] };
          groups.push(currentGroup);
        }
        currentGroup.options.push(option);
      }
    }
    let toggles = [];
    if (sawHeader) {
      toggles = groups.filter((g) => g.options.length > 0).map((g, i) => ({ group: `g${i + 1}-${hash36(g.label).slice(0, 6)}`, label: g.label, multi: true, options: g.options }));
    }
    if (toggles.length === 0 && allOptions.length > 0) {
      const on = allOptions.filter((o2) => o2.selected);
      const off = allOptions.filter((o2) => !o2.selected);
      toggles = on.length > 0 && off.length > 0 ? [
        { group: "st-enabled", label: "\u5DF2\u542F\u7528\u6761\u76EE", multi: true, options: on },
        { group: "st-disabled", label: "\u5DF2\u505C\u7528\u6761\u76EE", multi: true, options: off }
      ] : [{ group: "st-all", label: "\u5168\u90E8\u6761\u76EE", multi: true, options: allOptions }];
    }
    const sampling = { temperature: 1, topP: 0.95 };
    if (typeof o.temperature === "number") sampling.temperature = o.temperature;
    if (typeof o.top_p === "number") sampling.topP = o.top_p;
    if (typeof o.top_k === "number") sampling.topK = o.top_k;
    if (typeof o.frequency_penalty === "number") sampling.frequencyPenalty = o.frequency_penalty;
    if (typeof o.presence_penalty === "number") sampling.presencePenalty = o.presence_penalty;
    if (typeof o.openai_max_tokens === "number") sampling.maxTokens = o.openai_max_tokens;
    if (typeof o.min_p === "number") sampling.minP = o.min_p;
    if (typeof o.top_a === "number") sampling.topA = o.top_a;
    if (typeof o.repetition_penalty === "number") sampling.repetitionPenalty = o.repetition_penalty;
    if (typeof o.seed === "number" && o.seed >= 0) sampling.seed = o.seed;
    if (typeof o.openai_max_context === "number") sampling.maxContext = o.openai_max_context;
    if (typeof o.stream_openai === "boolean") sampling.stream = o.stream_openai;
    const stopSequences = parseStStopSequences(o.custom_stopping_strings);
    if (stopSequences !== void 0) sampling.stopSequences = stopSequences;
    const logitBias = parseStLogitBias(o.logit_bias);
    if (logitBias !== void 0) sampling.logitBias = logitBias;
    if (typeof o.reasoning_effort === "string" && o.reasoning_effort.trim()) {
      sampling.reasoningEffort = o.reasoning_effort.trim();
    }
    const macros = registerStMacros(
      prompts.map((p) => typeof p.content === "string" ? p.content : "")
    );
    const regex = [];
    const rs = o.extensions?.regex_scripts;
    if (Array.isArray(rs)) {
      for (let i = 0; i < rs.length; i++) {
        const s = rs[i];
        const find = typeof s.findRegex === "string" ? s.findRegex : "";
        const scriptName = typeof s.scriptName === "string" ? s.scriptName : `regex-${i}`;
        if (!find.trim()) {
          skipped++;
          continue;
        }
        regex.push({
          id: `rs-${i}-${hash36(scriptName).slice(0, 6)}`,
          scriptName,
          findRegex: find,
          replaceString: typeof s.replaceString === "string" ? s.replaceString : "",
          trimStrings: Array.isArray(s.trimStrings) ? s.trimStrings.filter((t) => typeof t === "string") : [],
          placement: Array.isArray(s.placement) ? s.placement.filter((n) => typeof n === "number") : [2],
          disabled: s.disabled === true,
          markdownOnly: s.markdownOnly === true,
          promptOnly: s.promptOnly === true,
          runOnEdit: s.runOnEdit !== false,
          substituteRegex: typeof s.substituteRegex === "number" ? s.substituteRegex : 0,
          minDepth: typeof s.minDepth === "number" ? s.minDepth : null,
          maxDepth: typeof s.maxDepth === "number" ? s.maxDepth : null
        });
      }
    }
    const presetId = `st-${nameSlug(displayName)}-${hash36(displayName).slice(0, 6)}`;
    const skills = agent ? extractSkillBlocks(presetId, prompts) : [];
    const tierNote = configExtraParts.length + pendingSkills.length + subagentHints.length > 0 ? `\uFF1B\u4E09\u6863\u5F52\u4F4D\uFF1A\u914D\u7F6E\u81EA\u67E5 ${configExtraParts.length} \u6761\u6298\u53E0\u8FDB configSummary \u8865\u5145\u6587\u672C\uFF08configSummaryExtra\uFF09\u3001\u5185\u5FC3 OS/\u601D\u7EF4\u94FE ${pendingSkills.length} \u6761\u8F6C skillRef+\u5F85\u843D\u76D8 skill\uFF08skills/<slug>/SKILL.md\uFF09\u3001subagent \u7F16\u6392 ${subagentHints.length} \u6761\u767B\u8BB0 subagentHints\uFF08\u4EC5\u91CD agent \u8DEF\u5F84\u6D88\u8D39\uFF0C\u7F16\u8BD1\u671F\u5FFD\u7565\uFF09` : "";
    const preset = {
      schemaVersion: 1,
      id: presetId,
      displayName,
      description: agent ? `SillyTavern \u9884\u8BBE\u8FC1\u79FB\uFF08\u7C7B\u578B\uFF1Aagent \u7F16\u6392\u578B\u2014\u2014\u9002\u914D TT agent \u6A21\u5F0F\uFF0C\u542B ${skills.length} \u4E2A\u6280\u80FD\u5757\u5DF2\u8F6C DSH skills\uFF08skills/preset-*/<\u5757\u540D>/SKILL.md\uFF1BP1#6 \u53CC\u8F74\u5206\u79BB\uFF1A\u7ECF\u540C\u6B65\u7684 DSH agent \u9884\u8BBE preset-capability \u7EC4\u6302\u8F7D\u4E3A\u6A21\u578B\u53EF\u8C03\u7528\uFF0C\u4E0E\u5185\u5BB9\u7F16\u6392\u8F74\u72EC\u7ACB\u9009\u62E9\u3001\u7EC4\u5408\u751F\u6548\uFF09\uFF0C\u7F16\u6392\u6307\u4EE4\u4FDD\u7559\u5728\u9884\u8BBE\u7F16\u8BD1\u6587\u672C\uFF1B\u6761\u76EE\u5F00\u5173 = ST \u9884\u8BBE\u5F00\u5173\uFF0C\u6309 ST \u6CE8\u91CA\u6761\u76EE\u91CD\u5EFA\u5F00\u5173\u7EC4\uFF1B\u5185\u5D4C\u6B63\u5219\u5DF2\u5BFC\u5165\u9884\u8BBE\u4F5C\u7528\u57DF${tierNote}\uFF09` : "SillyTavern \u9884\u8BBE\u8FC1\u79FB\uFF08\u7C7B\u578B\uFF1Aoneshot \u5355\u8F6E\u76F4\u51FA\uFF1B\u6761\u76EE\u5F00\u5173 = ST \u9884\u8BBE\u5F00\u5173\uFF0C\u6309 ST \u6CE8\u91CA\u6761\u76EE\u91CD\u5EFA\u5F00\u5173\u7EC4\uFF1B\u5185\u5D4C\u6B63\u5219\u5DF2\u5BFC\u5165\u9884\u8BBE\u4F5C\u7528\u57DF\uFF09",
      model: {},
      path: agent ? "agent" : "direct",
      toggles,
      slots,
      knowledge: { books: [], scanDepth: 2, budgetPercent: 25 },
      budget: { ...DEFAULT_BUDGET },
      sampling,
      ...macros !== null ? { macros } : {},
      // T3.3 三档归位产物（仅 agent 型；无归位时不带字段，direct 预设零影响）
      ...configExtraParts.length > 0 ? { configSummaryExtra: configExtraParts.join("\n\n") } : {},
      ...pendingSkills.length > 0 ? { pendingSkills } : {},
      ...subagentHints.length > 0 ? { subagentHints } : {}
    };
    return { preset, regex, skipped, skills };
  }

  // src/preset/compiler.ts
  var DSH_KNOWN_VARS = /* @__PURE__ */ new Set(["model", "cwd"]);
  function neutralizePromptVariables(text) {
    return text.replace(/\{\{([^{}]*)\}\}/g, (m, name) => DSH_KNOWN_VARS.has(name) ? m : `\uFF5B\uFF5B${name}\uFF5D\uFF5D`);
  }

  // src/import/card-export.ts
  var CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();
  function crc32(bytes) {
    let crc = 4294967295;
    for (let i = 0; i < bytes.length; i++) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 255] ^ crc >>> 8;
    }
    return (crc ^ 4294967295) >>> 0;
  }
  function pngChunk(type, data) {
    const typeBytes = new TextEncoder().encode(type);
    const out = new Uint8Array(4 + 4 + data.length + 4);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    out.set(typeBytes, 4);
    out.set(data, 8);
    const crcInput = new Uint8Array(4 + data.length);
    crcInput.set(typeBytes, 0);
    crcInput.set(data, 4);
    dv.setUint32(4 + 4 + data.length, crc32(crcInput));
    return out;
  }
  function pngTextChunk(keyword, text) {
    const kwBytes = new TextEncoder().encode(keyword);
    const textBytes = new TextEncoder().encode(text);
    const data = new Uint8Array(kwBytes.length + 1 + textBytes.length);
    data.set(kwBytes, 0);
    data[kwBytes.length] = 0;
    data.set(textBytes, kwBytes.length + 1);
    return pngChunk("tEXt", data);
  }
  function writeCardTextChunks(png, jsonText) {
    if (png.length < 8) throw new Error("PNG \u5B57\u8282\u8FC7\u77ED\uFF08<8\uFF09\uFF0C\u975E\u5408\u6CD5 PNG");
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    for (let i = 0; i < 8; i++) {
      if (png[i] !== sig[i]) throw new Error("PNG \u7B7E\u540D\u4E0D\u5339\u914D\uFF08\u975E\u5408\u6CD5 PNG\uFF09");
    }
    const b64 = uint8ToBase64(new TextEncoder().encode(jsonText));
    let iendPos = -1;
    for (let p = png.length - 8; p >= 8; p--) {
      if (png[p] === 0 && png[p + 1] === 0 && png[p + 2] === 0 && png[p + 3] === 0 && png[p + 4] === 73 && png[p + 5] === 69 && png[p + 6] === 78 && png[p + 7] === 68) {
        iendPos = p;
        break;
      }
    }
    if (iendPos === -1) throw new Error("PNG \u65E0 IEND chunk\uFF0C\u65E0\u6CD5\u5199\u5165");
    const dropOffsets = [];
    let pos = 8;
    while (pos + 12 <= iendPos) {
      const length = png[pos] << 24 | png[pos + 1] << 16 | png[pos + 2] << 8 | png[pos + 3];
      const type = new TextDecoder("latin1").decode(png.subarray(pos + 4, pos + 8));
      if (type === "tEXt") {
        const dataStart = pos + 8;
        let kwEnd = dataStart;
        while (kwEnd < dataStart + length && png[kwEnd] !== 0) kwEnd++;
        const keyword = new TextDecoder("latin1").decode(png.subarray(dataStart, kwEnd));
        if (keyword === "char" || keyword === "ccv3") {
          dropOffsets.push({ start: pos, end: pos + 12 + length });
        }
      }
      pos += 12 + length;
    }
    const out = [
      png.subarray(0, 8),
      png.subarray(8, dropOffsets.length > 0 ? dropOffsets[0].start : iendPos)
    ];
    let cursor = dropOffsets.length > 0 ? dropOffsets[0].end : 8;
    for (let i = 0; i < dropOffsets.length; i++) {
      const next = i + 1 < dropOffsets.length ? dropOffsets[i + 1].start : iendPos;
      out.push(png.subarray(cursor, next));
      cursor = next;
    }
    out.push(pngTextChunk("char", b64));
    out.push(pngTextChunk("ccv3", b64));
    out.push(png.subarray(iendPos));
    return concatBytes(out);
  }
  function bytesToBase64(bytes) {
    return uint8ToBase64(bytes);
  }
  function exportCardBundleFiles(card, avatar) {
    const files = [];
    files.push({ path: "card.json", content: card.rawJson ?? buildStV2Json(card) });
    if (card.embeddedBook && card.embeddedBook.entries.length > 0) {
      files.push({ path: "worldbook.json", content: loreBookToStWorld(card.embeddedBook) });
    }
    if (card.embeddedRegex.length > 0) {
      files.push({ path: "regex.json", content: JSON.stringify(card.embeddedRegex, null, 1) });
    }
    if (card.depthPrompt) {
      files.push({ path: "depth.txt", content: card.depthPrompt.prompt });
    }
    const avatarBytes = avatar ?? makePlaceholderPng(card.name);
    files.push({ path: "avatar.png", content: bytesToBase64(avatarBytes), binary: true });
    return files;
  }
  function buildStV2Json(card) {
    const data = {
      name: card.name,
      description: card.description,
      personality: card.personality,
      scenario: card.scenario,
      first_mes: card.firstMes,
      mes_example: card.mesExample,
      creator_notes: card.creatorNotes,
      system_prompt: card.systemPrompt,
      post_history_instructions: card.postHistoryInstructions,
      alternate_greetings: card.alternateGreetings,
      tags: card.tags,
      creator: card.creator,
      character_version: card.characterVersion,
      extensions: {
        depth_prompt: card.depthPrompt ? { prompt: card.depthPrompt.prompt, depth: card.depthPrompt.depth, role: card.depthPrompt.role } : void 0,
        regex_scripts: card.embeddedRegex.length ? card.embeddedRegex : void 0,
        world: card.externalWorldRef ?? void 0
      }
    };
    if (card.embeddedBook && card.embeddedBook.entries.length > 0) {
      data.character_book = loreBookToStWorld(card.embeddedBook);
    }
    const root = {
      spec: "chara_card_v2",
      spec_version: "2.0",
      data
    };
    return JSON.stringify(root, null, 1);
  }
  function loreBookToStWorld(book) {
    return {
      name: book.name,
      scan_depth: 2,
      token_budget: 6e3,
      recursive_scanning: false,
      entries: book.entries.map((e, i) => ({
        uid: i,
        key: e.keys.length ? e.keys.join(", ") : e.constant ? void 0 : "",
        keysecondary: e.secondaryKeys.length ? e.secondaryKeys.join(", ") : void 0,
        comment: e.comment,
        content: e.content,
        constant: e.constant,
        selective: e.selective,
        selectiveLogic: e.selectiveLogic,
        order: e.insertionOrder,
        position: e.position,
        depth: e.depth,
        role: e.role,
        preventRecursion: e.preventRecursion,
        excludeRecursion: e.excludeRecursion,
        disable: !e.enabled,
        probability: 100
      }))
    };
  }
  function makePlaceholderPng(name) {
    const width = 1;
    const height = 1;
    const raw = new Uint8Array(1 + height * (1 + width * 4));
    raw[0] = 0;
    raw[1] = 44;
    raw[2] = 62;
    raw[3] = 96;
    raw[4] = 255;
    const idat = deflateRaw(raw);
    const ihdr = new Uint8Array(13);
    const dv = new DataView(ihdr.buffer);
    dv.setUint32(0, width);
    dv.setUint32(4, height);
    ihdr[8] = 8;
    ihdr[9] = 6;
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;
    const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const out = [sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", idat)];
    out.push(pngChunk("IEND", new Uint8Array(0)));
    return concatBytes(out);
  }
  function deflateRaw(input) {
    const chunks = [];
    chunks.push(new Uint8Array([120, 1]));
    const len = input.length;
    const block = new Uint8Array(5 + len);
    block[0] = 1;
    block[1] = len & 255;
    block[2] = len >>> 8 & 255;
    block[3] = ~len & 255;
    block[4] = ~len >>> 8 & 255;
    block.set(input, 5);
    chunks.push(block);
    const adler = adler32(input);
    const tail = new Uint8Array(4);
    new DataView(tail.buffer).setUint32(0, adler);
    chunks.push(tail);
    return concatBytes(chunks);
  }
  function adler32(data) {
    let a = 1;
    let b = 0;
    for (let i = 0; i < data.length; i++) {
      a = (a + data[i]) % 65521;
      b = (b + a) % 65521;
    }
    return (b << 16 | a) >>> 0;
  }
  function uint8ToBase64(bytes) {
    let bin = "";
    const chunk = 32768;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }
  function concatBytes(arrays) {
    let total = 0;
    for (const a of arrays) total += a.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const a of arrays) {
      out.set(a, off);
      off += a.length;
    }
    return out;
  }

  // src/import/dsh-export.ts
  function hash362(input) {
    let h = 2166136261;
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }
  function dshSlug(prefix, originalName) {
    const safe = originalName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24).replace(/^-+|-+$/g, "");
    const h = hash362(originalName);
    return safe ? `${prefix}-${safe}-${h}` : `${prefix}-${h}`;
  }
  function parseStDate(s) {
    if (typeof s !== "string" || !s.trim()) return null;
    const t = Date.parse(s);
    return Number.isSafeInteger(t) && t > 0 ? t : null;
  }
  function exportLoreBookSkill(book) {
    const slug = dshSlug("wb", book.name);
    const constant = book.entries.filter((e) => e.constant).length;
    const keyed = book.entries.filter((e) => !e.constant && e.keys.length > 0).length;
    const sampleKeys = book.entries.flatMap((e) => e.constant ? [] : e.keys.slice(0, 2)).slice(0, 24);
    const skillMd = `---
name: ${slug}
description: \u4E16\u754C\u4E66\u300A${book.name}\u300B\u8FC1\u79FB\u81EA SillyTavern\uFF08${book.entries.length} \u6761\u76EE\uFF1A\u5E38\u9A7B ${constant}\u3001\u5173\u952E\u8BCD ${keyed}\uFF09\u3002${sampleKeys.length ? "\u89E6\u53D1\u8BCD\u793A\u4F8B\uFF1A" + sampleKeys.join("\u3001") : ""}
whenToUse: \u89D2\u8272\u626E\u6F14\u6D89\u53CA\u300A${book.name}\u300B\u4E16\u754C\u89C2\u8BBE\u5B9A\u3001\u5730\u540D\u3001\u4EBA\u7269\u6216\u89C4\u5219\u65F6\uFF0C\u5148\u8BFB references/lore.json \u67E5\u76F8\u5173\u6761\u76EE\u3002
---

# \u4E16\u754C\u4E66\uFF1A${book.name}

\u7531 DSHTavern \u4ECE SillyTavern \u4E16\u754C\u4E66\u81EA\u52A8\u8FC1\u79FB\u3002\u5B8C\u6574\u7ED3\u6784\u5316\u6761\u76EE\uFF08\u5173\u952E\u8BCD\u3001\u4F4D\u7F6E\u3001\u6DF1\u5EA6\u3001\u9012\u5F52\u89C4\u5219\uFF09\u89C1 \`references/lore.json\`\u2014\u2014\u7528\u6587\u4EF6\u5DE5\u5177\u6309\u9700\u68C0\u7D22\uFF0C\u4E0D\u8981\u6574\u672C\u8BFB\u5165\u3002

## \u6761\u76EE\u901F\u89C8

${book.entries.slice(0, 60).map((e) => {
      const tag = e.constant ? "\u5E38\u9A7B" : e.keys.length ? `\u5173\u952E\u8BCD: ${e.keys.slice(0, 4).join(", ")}` : "\u65E0\u6761\u4EF6";
      const pos = e.position === 4 ? `\u6DF1\u5EA6${e.depth}` : e.position === 0 ? "\u9876\u90E8" : e.position === 1 ? "\u5E95\u90E8" : "";
      return `- [${tag}${pos ? `\xB7${pos}` : ""}] ${e.comment || "(\u672A\u547D\u540D)"}${e.enabled === false ? "\uFF08\u5DF2\u505C\u7528\uFF09" : ""}`;
    }).join("\n")}
${book.entries.length > 60 ? `
\u2026\u5171 ${book.entries.length} \u6761\uFF0C\u5176\u4F59\u89C1 references/lore.json` : ""}
`;
    return [
      { path: `skills/${slug}/SKILL.md`, content: skillMd },
      { path: `skills/${slug}/references/lore.json`, content: JSON.stringify(book, null, 1) }
    ];
  }
  function cardPromptPersona(card) {
    const sections = [];
    sections.push(`\u4F60\u6B63\u5728\u8FDB\u884C\u89D2\u8272\u626E\u6F14\u3002\u4F60\u626E\u6F14\u300C${card.name}\u300D\uFF0C\u7528\u6237\u626E\u6F14\u5BF9\u8BDD\u4E2D\u7684\u4E3B\u89D2\uFF08\u7528\u6237\u540D\u4EE5\u804A\u5929\u4E2D\u7684\u79F0\u8C13\u4E3A\u51C6\uFF09\u3002`);
    if (card.description.trim()) sections.push(`# \u89D2\u8272\u8BBE\u5B9A
${card.description.trim()}`);
    if (card.personality.trim()) sections.push(`# \u6027\u683C
${card.personality.trim()}`);
    if (card.scenario.trim()) sections.push(`# \u573A\u666F
${card.scenario.trim()}`);
    if (card.firstMes.trim()) sections.push(`# \u5F00\u573A\u767D\uFF08\u5BF9\u8BDD\u4ECE\u8FD9\u91CC\u5F00\u59CB\uFF09
${card.firstMes.trim()}`);
    if (card.alternateGreetings.length) {
      sections.push(`# \u5907\u9009\u5F00\u573A\u767D\uFF08\u7528\u6237\u53EF\u9009\u62E9\u7684\u5206\u652F\uFF09
${card.alternateGreetings.map((g, i) => `${i + 1}. ${g.trim()}`).join("\n")}`);
    }
    if (card.depthPrompt) sections.push(`# \u6DF1\u5EA6\u63D0\u793A\uFF08\u59CB\u7EC8\u6CE8\u5165\uFF09
${card.depthPrompt.prompt}`);
    const worldRef = card.externalWorldRef ? `\u672C\u89D2\u8272\u7684\u4E16\u754C\u8BBE\u5B9A\u4E66\u4E3A\u300A${card.externalWorldRef}\u300B\uFF08\u5982\u6280\u80FD\u5217\u8868\u4E2D\u6709\u5BF9\u5E94\u8FC1\u79FB skill\uFF0C\u9700\u8981\u8BBE\u5B9A\u65F6\u5148\u8BFB\u5B83\uFF09\u3002` : "";
    sections.push(
      `# \u884C\u4E3A\u51C6\u5219
- \u5168\u7A0B\u4FDD\u6301\u89D2\u8272\uFF0C\u4EE5\u300C${card.name}\u300D\u7684\u8EAB\u4EFD\u8BF4\u8BDD\u4E0E\u884C\u52A8\uFF0C\u4E0D\u8981\u8DF3\u51FA\u89D2\u8272\u3002
- \u7528\u5C0F\u8BF4\u5316\u7684\u53D9\u8FF0\u63A8\u8FDB\u5267\u60C5\uFF1A\u52A8\u4F5C\u3001\u795E\u6001\u3001\u5BF9\u767D\u4EA4\u7EC7\uFF1B\u4E0D\u8981\u603B\u7ED3\u5F0F\u56DE\u590D\u3002
- \u56DE\u590D\u957F\u5EA6\u4E0E\u7528\u6237\u5F53\u524D\u6587\u98CE\u4FDD\u6301\u4E00\u81F4\uFF1B\u7528\u6237\u63A8\u8FDB\u5267\u60C5\u65F6\u8DDF\u968F\uFF0C\u4E0D\u8981\u66FF\u7528\u6237\u505A\u51B3\u5B9A\u3002
${worldRef ? worldRef + "\n" : ""}- \u9700\u8981\u4E16\u754C\u89C2\u8BBE\u5B9A\uFF08\u5730\u540D/\u4EBA\u7269/\u89C4\u5219\uFF09\u800C\u4E0A\u4E0B\u6587\u6CA1\u6709\u65F6\uFF0C\u7528\u6280\u80FD/\u6587\u4EF6\u5DE5\u5177\u67E5\u8BE2\uFF0C\u4E0D\u8981\u7F16\u9020\u4E0E\u8BBE\u5B9A\u51B2\u7A81\u7684\u5185\u5BB9\u3002`
    );
    return sections.join("\n\n");
  }
  function chatSessionId(characterName, chatFile) {
    return `st-${hash362(characterName + "/" + chatFile)}`;
  }
  var RP_WORKSPACE_DIR = "rp";
  function encodeSegment(raw) {
    if (raw === ".") return "~002E";
    if (raw === "..") return "~002E~002E";
    let out = "";
    for (let i = 0; i < raw.length; i++) {
      const code = raw.charCodeAt(i);
      const ch = String.fromCharCode(code);
      if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) out += ch;
      else out += "~" + code.toString(16).toUpperCase().padStart(4, "0");
    }
    return out;
  }
  function projectKey(cwd) {
    let readable = "";
    let separatorRun = false;
    for (let i = 0; i < cwd.length; i++) {
      const code = cwd.charCodeAt(i);
      const ch = String.fromCharCode(code);
      if (ch === "/" || ch === "\\" || ch === ":") {
        if (!separatorRun) readable += "-";
        separatorRun = true;
      } else if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) {
        readable += ch;
        separatorRun = false;
      } else {
        readable += "~" + code.toString(16).toUpperCase().padStart(4, "0");
        separatorRun = false;
      }
    }
    const slug = readable.replace(/^-+/, "") || "root";
    return `--${slug.slice(0, 251)}--`;
  }
  function assertSessionLogEvents(events) {
    const fail = (i, msg) => {
      const ev = events[i];
      throw new Error(
        `session \u4E8B\u4EF6\u65E5\u5FD7\u6821\u9A8C\u5931\u8D25\uFF08\u7B2C ${i} \u6761\uFF0Ctype=${String(ev?.type)}\uFF0Cseq=${String(ev?.seq)}\uFF09\uFF1A${msg}`
      );
    };
    let openTurn = null;
    let openStep = null;
    let prevTurn = 0;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (typeof ev.seq !== "number" || ev.seq !== i) {
        fail(i, `seq \u4E0D\u8FDE\u7EED\uFF08\u671F\u671B ${i}\uFF0C\u5B9E\u9645 ${String(ev.seq)}\uFF09`);
      }
      const data = ev.data ?? {};
      switch (ev.type) {
        case "turn/start": {
          if (openTurn !== null) fail(i, `turn/start \u5D4C\u5957\uFF1Aturn ${openTurn} \u672A\u95ED\u5408`);
          const t = data.turn;
          if (t !== prevTurn + 1) fail(i, `turn \u7F16\u53F7\u4E0D\u8FDE\u7EED\uFF08\u671F\u671B ${prevTurn + 1}\uFF0C\u5B9E\u9645 ${String(t)}\uFF09`);
          openTurn = prevTurn = prevTurn + 1;
          break;
        }
        case "user/message":
        case "assistant/message":
          if (openTurn === null) fail(i, `${ev.type} \u51FA\u73B0\u5728 turn \u4E4B\u5916`);
          break;
        case "step/start": {
          if (openTurn === null) fail(i, "step/start \u51FA\u73B0\u5728 turn \u4E4B\u5916");
          if (openStep !== null) fail(i, `step/start \u5D4C\u5957\uFF1Astep ${openStep} \u672A\u95ED\u5408`);
          if (data.turn !== openTurn) fail(i, `step/start \u7684 turn=${String(data.turn)} \u4E0E\u5F53\u524D turn ${openTurn} \u4E0D\u7B26`);
          if (typeof data.step !== "number") fail(i, "step/start \u7F3A step \u7F16\u53F7");
          openStep = data.step;
          break;
        }
        case "step/end":
          if (openStep === null) fail(i, "step/end \u65E0\u914D\u5BF9 step/start");
          if (data.turn !== openTurn || data.step !== openStep) {
            fail(i, `step/end\uFF08turn=${String(data.turn)},step=${String(data.step)}\uFF09\u4E0E step/start\uFF08turn=${openTurn},step=${openStep}\uFF09\u4E0D\u914D\u5BF9`);
          }
          openStep = null;
          break;
        case "turn/end": {
          if (openTurn === null) fail(i, "turn/end \u65E0\u914D\u5BF9 turn/start");
          if (openStep !== null) fail(i, `turn ${openTurn} \u5185 step ${openStep} \u672A\u95ED\u5408`);
          if (data.turn !== openTurn) fail(i, `turn/end \u7684 turn=${String(data.turn)} \u4E0E\u5F53\u524D turn ${openTurn} \u4E0D\u7B26`);
          const reason = data.reason;
          if (reason === null || typeof reason !== "object" || reason.kind !== "completed") {
            fail(i, "turn/end reason.kind \u975E 'completed'");
          }
          openTurn = null;
          break;
        }
        default:
          break;
      }
    }
    if (openStep !== null) fail(events.length - 1, `\u65E5\u5FD7\u7ED3\u5C3E\u4ECD\u6709\u672A\u95ED\u5408\u7684 step ${openStep}`);
    if (openTurn !== null) fail(events.length - 1, `\u65E5\u5FD7\u7ED3\u5C3E\u4ECD\u6709\u672A\u95ED\u5408\u7684 turn ${openTurn}`);
  }
  function convertChatFile(jsonlText, opts) {
    const lines = [];
    let seq = 0;
    let time = opts.createdAt;
    let turn = 0;
    let step = 0;
    let turns = 0;
    let skipped = 0;
    let variantGroups = 0;
    let firstUserText = null;
    let trustSystemFlag = true;
    if (opts.systemHandling !== "skip") {
      for (const raw of jsonlText.split("\n")) {
        const trimmed = raw.trim();
        if (!trimmed) continue;
        try {
          const row = JSON.parse(trimmed);
          if (row.is_user === true && row.is_system === true && typeof row.mes === "string" && row.mes.trim()) {
            trustSystemFlag = false;
            break;
          }
        } catch {
        }
      }
    }
    const surfaceNodes = [];
    const emit = (type, data, surfaceOp, sourceEventSeqs) => {
      const ev = { type, seq, time, data };
      if (surfaceOp !== void 0) {
        ev.surfaceOp = surfaceOp;
        if (sourceEventSeqs !== void 0) ev.sourceEventSeqs = sourceEventSeqs;
        if (surfaceOp === "append") {
          surfaceNodes.push(seq);
        } else {
          const startIdx = surfaceNodes.indexOf(surfaceOp.start);
          const endIdx = surfaceNodes.indexOf(surfaceOp.end);
          surfaceNodes.splice(startIdx, endIdx - startIdx + 1, seq);
        }
      }
      lines.push(JSON.stringify(ev));
      seq++;
      time += 1;
    };
    lines.push(JSON.stringify({
      type: "session",
      version: 0,
      id: opts.sessionId,
      createdAt: opts.createdAt,
      ...opts.cwd !== void 0 ? { cwd: opts.cwd } : {},
      delegationDepth: 0
    }));
    const closeTurn = () => {
      emit("turn/end", { turn, reason: { kind: "completed" } });
      turns++;
      step = 0;
    };
    const emitAssistantStep = (text, op, sourceEventSeqs) => {
      step++;
      emit("step/start", { turn, step });
      emit("assistant/message", {
        turn,
        step,
        message: {
          id: `st-${opts.sessionId}-${seq}`,
          role: "assistant",
          content: [{ type: "text", text }],
          source: { kind: "model", provider: "sillytavern-import", model: "imported" }
        }
      }, op, sourceEventSeqs);
      emit("step/end", { turn, step });
      return surfaceNodes[surfaceNodes.length - 1];
    };
    for (const raw of jsonlText.split("\n")) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      let row;
      try {
        row = JSON.parse(trimmed);
      } catch {
        skipped++;
        continue;
      }
      const mes = typeof row.mes === "string" ? row.mes : "";
      if (!mes.trim()) {
        skipped++;
        continue;
      }
      if (trustSystemFlag && row.is_system === true) {
        skipped++;
        continue;
      }
      const t = parseStDate(row.send_date);
      if (t !== null && t >= time) time = t;
      else time += 1e3;
      if (row.is_user === true) {
        if (turn > 0) closeTurn();
        turn++;
        emit("turn/start", { turn });
        emit("user/message", {
          id: `st-${opts.sessionId}-${seq}`,
          role: "user",
          content: [{ type: "text", text: mes }],
          source: { kind: "user" }
        }, "append");
        if (firstUserText === null) firstUserText = mes.slice(0, 120);
      } else {
        if (turn === 0) {
          turn++;
          emit("turn/start", { turn });
        }
        const swipes = Array.isArray(row.swipes) ? row.swipes.filter((s) => typeof s === "string" && s.trim().length > 0) : [];
        const variants = swipes.length > 1 ? swipes : [mes];
        const activeIdx = typeof row.swipe_id === "number" && row.swipe_id >= 0 && row.swipe_id < variants.length ? row.swipe_id : variants.length - 1;
        if (variants.length > 1) variantGroups++;
        let activeSeq;
        for (let i = 0; i < variants.length; i++) {
          const text = variants[i];
          if (activeSeq === void 0) {
            activeSeq = emitAssistantStep(text, "append");
          } else {
            activeSeq = emitAssistantStep(
              text,
              { op: "replace", start: activeSeq, end: activeSeq },
              [activeSeq]
            );
          }
        }
        if (variants.length > 1 && activeIdx !== variants.length - 1) {
          activeSeq = emitAssistantStep(
            variants[activeIdx],
            { op: "replace", start: activeSeq, end: activeSeq },
            [activeSeq]
          );
        }
      }
    }
    if (turn > 0) closeTurn();
    try {
      assertSessionLogEvents(
        lines.slice(1).map((l) => JSON.parse(l))
      );
    } catch (e) {
      throw new Error(`convertChatFile(${opts.sessionId}) \u6784\u9020\u4EA7\u51FA\u672A\u901A\u8FC7\u81EA\u68C0\uFF1A${e.message}`);
    }
    return {
      content: lines.join("\n") + "\n",
      turns,
      skipped,
      firstUserText,
      variantGroups
    };
  }
  function sessionFilePath(sessionId, cwd) {
    const dir = cwd === void 0 ? "_no-cwd" : projectKey(cwd);
    return `sessions/${dir}/${encodeSegment(sessionId)}/session.jsonl`;
  }
  function buildRpJsonContent(card, books, opts = {}) {
    return JSON.stringify({
      schemaVersion: 1,
      characterName: card.name,
      books,
      trigger: { scanDepth: 2, matchWholeWords: false, budgetPercent: 25, budgetCap: 6e3 },
      macros: { char: card.name, user: opts.user ?? "" },
      firstMes: card.firstMes.slice(0, 4e3),
      // 第四轮：卡设定文本随 rp.json 走（promptPersona），运行期 pre-step 快照注入并过宏引擎；
      // 不再产出 .agent-presets/rp-*（agent 预设界面只留真预设）
      promptPersona: cardPromptPersona(card),
      // 正则脚本（§4.5 st-regex-scripts / T1.2）：内嵌正则随卡落盘，运行期由
      // dsht-rp-plugin 组装层按三时机消费（prompt 时机改批消息与 WI 内容，
      // display 时机由前端输出协议渲染层消费）
      regex: card.embeddedRegex,
      // T3.1b 导出对称：本工作区是否存了原始卡 JSON 与立绘（导出入口据此显示"
      // 保持无损"或"需补源数据"）。文件在 rp/<slug>/card.json + avatar.png。
      cardSource: { rawJson: !!card.rawJson, hasAvatar: !!card.avatar },
      outputProtocol: {
        actionTags: ["a", "selection"],
        wrapTags: ["content"],
        statusTags: ["status", "statusbar", "StatusBlock"],
        // T2.10 渲染补差：折叠块 / MVU 状态更新 / 思维链 / 伏笔登记册
        collapsibleTags: ["details"],
        stateUpdateTags: ["UpdateVariable"],
        reasoningTags: ["Analysis"],
        foreshadowingTags: ["foreshadowings"]
      }
    }, null, 1);
  }
  function buildFirstMesSession(card, opts = {}) {
    const firstMes = card.firstMes.trim();
    if (!firstMes) return null;
    const greetings = [firstMes];
    for (const g of card.alternateGreetings) {
      const t = g.trim();
      if (t && !greetings.includes(t)) greetings.push(t);
    }
    const sessionId = `st-${hash362(`firstmes/${card.name}`)}`;
    const cwd = opts.cwd ?? (opts.dshHome !== void 0 ? `${opts.dshHome}/${RP_WORKSPACE_DIR}/${dshSlug("rp", card.name)}` : `${RP_WORKSPACE_DIR}/${dshSlug("rp", card.name)}`);
    const createdAt = Date.now();
    const lines = [
      JSON.stringify({ type: "session", version: 0, id: sessionId, createdAt, cwd, delegationDepth: 0 })
    ];
    let seq = 0;
    const event = (type, data, surfaceOp, sourceEventSeqs) => {
      lines.push(JSON.stringify({
        type,
        seq,
        time: createdAt + seq,
        data,
        ...surfaceOp !== void 0 ? { surfaceOp } : {},
        ...sourceEventSeqs !== void 0 ? { sourceEventSeqs } : {}
      }));
      seq++;
    };
    const emitGreeting = (text, step, op, sources) => {
      event("step/start", { turn: 1, step });
      const msgSeq = seq;
      event("assistant/message", {
        turn: 1,
        step,
        message: {
          id: `st-${sessionId}-${step === 1 ? "first" : `swipe-${step}`}`,
          role: "assistant",
          content: [{ type: "text", text }],
          source: { kind: "model", provider: "sillytavern-import", model: "first-mes" }
        }
      }, op, sources);
      event("step/end", { turn: 1, step });
      return msgSeq;
    };
    event("turn/start", { turn: 1 });
    let activeSeq = emitGreeting(greetings[0], 1, "append");
    for (let i = 1; i < greetings.length; i++) {
      activeSeq = emitGreeting(greetings[i], i + 1, { op: "replace", start: activeSeq, end: activeSeq }, [activeSeq]);
    }
    if (greetings.length > 1) {
      emitGreeting(greetings[0], greetings.length + 1, { op: "replace", start: activeSeq, end: activeSeq }, [activeSeq]);
    }
    event("turn/end", { turn: 1, reason: { kind: "completed" } });
    return { path: `sessions/${projectKey(cwd)}/${encodeSegment(sessionId)}/session.jsonl`, content: lines.join("\n") + "\n" };
  }
  function exportSingleCardFiles(card, dshHome) {
    const files = [];
    const books = [];
    if (card.embeddedBook && card.embeddedBook.entries.length > 0) {
      const embedName = `${card.name}\xB7\u5185\u5D4C\u4E66`;
      files.push(...exportLoreBookSkill({ ...card.embeddedBook, name: embedName }));
      books.push({ name: embedName, lorePath: `skills/${dshSlug("wb", embedName)}/references/lore.json` });
    }
    files.push({ path: `${RP_WORKSPACE_DIR}/${dshSlug("rp", card.name)}/rp.json`, content: buildRpJsonContent(card, books) });
    files.push({
      path: `${RP_WORKSPACE_DIR}/${dshSlug("rp", card.name)}/README.md`,
      content: `# ${card.name}

SillyTavern \u5355\u6587\u4EF6\u5BFC\u5165\u7684\u89D2\u8272\u5DE5\u4F5C\u533A\u3002

- \u5361\u8BBE\u5B9A\u6587\u672C\uFF1A\`rp.json\` \u7684 \`promptPersona\` \u5B57\u6BB5\uFF08RP \u4F1A\u8BDD\u6BCF\u8F6E\u5FEB\u7167\u6CE8\u5165\uFF09
${books.length > 0 ? `- \u5185\u5D4C\u4E16\u754C\u4E66\uFF1A${books.map((b) => `\u300A${b.name}\u300B`).join("")}\uFF08skill \u5F62\u5F0F\u81EA\u52A8\u89E6\u53D1\uFF09
` : ""}
\u5728 RP \u804A\u5929\u5217\u8868\u70B9\u672C\u89D2\u8272\u5373\u53EF\u5F00\u804A\uFF1B\u4E16\u754C\u4E66\u6309\u5173\u952E\u8BCD\u81EA\u52A8\u6FC0\u6D3B\u3002
`
    });
    const slug = dshSlug("rp", card.name);
    if (card.rawJson) {
      files.push({ path: `${RP_WORKSPACE_DIR}/${slug}/card.json`, content: card.rawJson });
    }
    if (card.avatar) {
      files.push({ path: `${RP_WORKSPACE_DIR}/${slug}/avatar.png`, content: bytesToBase64(card.avatar), binary: true });
    }
    const firstMesSession = buildFirstMesSession(card, dshHome !== void 0 ? { dshHome } : {});
    if (firstMesSession) files.push(firstMesSession);
    return files;
  }
  async function exportToDshFiles(imp, sink, options = { worlds: true, cards: true, chats: true }, dshHome) {
    const result = { skills: 0, presets: 0, sessions: 0, files: [], warnings: [], workspaces: [] };
    const BATCH = 40;
    let batch = [];
    let percentBase = 0;
    let percentSpan = 0;
    const flush = async (p) => {
      if (batch.length === 0) return;
      await sink(batch, p);
      result.files.push(...batch);
      batch = [];
    };
    const personaPresetFiles = (id, label, name, desc, avatar) => {
      const personaText = neutralizePromptVariables([
        `# \u7528\u6237\u6863\u6848\uFF08persona\uFF09`,
        `\u7528\u6237\u5728\u89D2\u8272\u626E\u6F14\u4E2D\u626E\u6F14\u7684\u4E3B\u89D2\u3002`,
        name ? `- \u540D\u5B57\uFF1A${name}` : "",
        desc ? `- \u4EBA\u8BBE\uFF1A${desc}` : "",
        avatar ? `- \u5934\u50CF\uFF1A${avatar}` : "",
        `- \u884C\u4E3A\u7EA6\u675F\uFF1A\u4EE5\u8BE5\u8EAB\u4EFD\u884C\u52A8\uFF1B\u7528\u6237\u7684\u540D\u5B57\u5728\u53D9\u4E8B\u4E2D\u4EE5\u300C${name || "\u7528\u6237"}\u300D\u79F0\u8C13\u51FA\u73B0\u3002`
      ].filter(Boolean).join("\n"));
      return [
        {
          path: `.agent-presets/${id}/agent.cordis.yml`,
          content: [
            `# DSHTavern \u7528\u6237\u6863\u6848 preset\uFF08\u6E90\u81EA SillyTavern settings.json power_user persona \u5757\uFF09`,
            `- id: persona`,
            `  name: '@deepseek-ai/dsh-persona'`,
            `  config:`,
            `    text: |-`,
            ...personaText.split("\n").map((l) => l === "" ? "" : "      " + l),
            `    complete: true`,
            `    includeRuntimeContext: false`,
            ``
          ].join("\n")
        },
        {
          path: `.agent-presets/${id}/preset.yml`,
          content: `name: ${label}
description: ST \u8FC1\u79FB\u7684\u7528\u6237\u4EBA\u8BBE\u2014\u2014\u6309\u9700\u6302\u8F7D\u5230\u4EFB\u610F\u4F1A\u8BDD
order: 50

`
        }
      ];
    };
    const personas = imp.report?.settings?.personas;
    if (Array.isArray(personas) && personas.length > 0) {
      for (const p of personas) {
        const pName = typeof p.name === "string" && p.name.trim() ? p.name.trim() : null;
        const pDesc = typeof p.description === "string" && p.description.trim() ? p.description.trim() : null;
        if (!pName && !pDesc) continue;
        const pAvatar = typeof p.avatar === "string" && p.avatar.trim() ? p.avatar.trim() : null;
        const id = p.isDefault === true ? "dsht-user-persona" : `dsht-persona-${dshSlug("rp", pName ?? "persona").replace(/^rp-/, "")}`;
        batch.push(...personaPresetFiles(id, pName ? `\u7528\u6237\u6863\u6848\uFF08${pName}\uFF09` : "\u7528\u6237\u6863\u6848\uFF08persona\uFF09", pName, pDesc, pAvatar));
        result.presets += 1;
      }
    } else {
      const personaName = imp.report?.settings?.personaName?.trim() || null;
      const personaDesc = imp.report?.settings?.personaDescription?.trim() || null;
      if (personaName || personaDesc) {
        batch.push(...personaPresetFiles("dsht-user-persona", "\u7528\u6237\u6863\u6848\uFF08persona\uFF09", personaName, personaDesc, null));
        result.presets += 1;
      }
    }
    if (options.worlds !== false && imp.worlds.size > 0) {
      percentBase = 0;
      percentSpan = 40;
      const entries = [...imp.worlds.values()];
      for (let i = 0; i < entries.length; i++) {
        const files = exportLoreBookSkill(entries[i]);
        batch.push(...files);
        result.skills++;
        if (batch.length >= BATCH) {
          await flush({ percent: percentBase + Math.round((i + 1) / entries.length * percentSpan), desc: `\u4E16\u754C\u4E66 \u2192 skill\uFF08${i + 1}/${entries.length}\uFF09` });
        }
      }
      await flush({ percent: 40, desc: "\u4E16\u754C\u4E66\u8F6C\u6362\u5B8C\u6210" });
    }
    if (options.cards !== false && imp.characters.length > 0) {
      percentBase = 40;
      percentSpan = 30;
      await flush({ percent: 70, desc: `\u89D2\u8272\u5361\u5904\u7406\u5B8C\u6210\uFF08${imp.characters.length} \u5F20\uFF0C\u8BBE\u5B9A\u968F rp.json promptPersona \u843D\u76D8\uFF09` });
    }
    if (options.presets !== false) {
      const presetFiles = Object.keys(imp.zip.files).filter((f) => /OpenAI Settings\/.+\.json$/i.test(f) && !/\.luker-state\./.test(f));
      if (presetFiles.length > 0) {
        let done = 0;
        for (const pf of presetFiles) {
          try {
            const text = await imp.zip.files[pf].async("string");
            const name = decodeURIComponent(pf.split("/").pop().replace(/\.json$/i, ""));
            const { preset, regex } = importStPreset(text, name);
            batch.push({
              path: `rp-presets/${preset.id}/preset.json`,
              content: JSON.stringify(preset, null, 1)
            });
            if (regex.length > 0) {
              batch.push({
                path: `rp-presets/${preset.id}/regex.json`,
                content: JSON.stringify({ scripts: regex }, null, 1)
              });
            }
            result.presets++;
          } catch (e) {
            result.warnings.push(`ST \u9884\u8BBE\u5BFC\u5165\u5931\u8D25\uFF1A${pf}\uFF08${e.message}\uFF09`);
          }
          done++;
          if (batch.length >= BATCH) {
            await flush({ percent: 70 + Math.round(done / presetFiles.length * 5), desc: `ST \u9884\u8BBE \u2192 rp-preset\uFF08${done}/${presetFiles.length}\uFF09` });
          }
        }
        await flush({ percent: 75, desc: "ST \u9884\u8BBE\u8F6C\u6362\u5B8C\u6210" });
      }
    }
    const wantChats = options.chats !== false && imp.chatFiles.length > 0;
    const wantCardWorkspaces = (options.chats !== false || options.cards !== false) && imp.characters.length > 0;
    if (wantChats || wantCardWorkspaces) {
      percentBase = 70;
      percentSpan = 30;
      const normNameKey = (s) => s.replace(/\s+/g, "").toLowerCase();
      const cardByKey = /* @__PURE__ */ new Map();
      for (const c of imp.characters) {
        for (const k of [c.name, c.sourceFileName ?? "", normNameKey(c.name)]) {
          if (k && !cardByKey.has(k)) cardByKey.set(k, c);
        }
      }
      const lookupCard = (ownerDir) => cardByKey.get(ownerDir) ?? cardByKey.get(normNameKey(ownerDir)) ?? null;
      const ORPHAN_DIR = "_orphan";
      const globalBooks = [];
      for (const raw of imp.report?.relations?.globalSelectedBooks ?? []) {
        const name = String(raw).trim();
        if (!name) continue;
        const lorePath = `skills/${dshSlug("wb", name)}/references/lore.json`;
        if (globalBooks.some((b) => b.lorePath === lorePath)) continue;
        globalBooks.push({ name, lorePath });
      }
      if (globalBooks.length > 0) {
        batch.push({
          path: `${RP_WORKSPACE_DIR}/global-books.json`,
          content: JSON.stringify({ books: globalBooks }, null, 1)
        });
      }
      const emitCardRpJson = (card, extra) => {
        const books = [];
        const seen = /* @__PURE__ */ new Set();
        const pushBook = (b) => {
          if (!seen.has(b.lorePath)) {
            seen.add(b.lorePath);
            books.push(b);
          }
        };
        if (card.externalWorldRef && imp.worlds.has(card.externalWorldRef)) {
          pushBook({
            name: card.externalWorldRef,
            lorePath: `skills/${dshSlug("wb", card.externalWorldRef)}/references/lore.json`
          });
        }
        if (card.embeddedBook && card.embeddedBook.entries.length > 0) {
          const embedName = `${card.name}\xB7\u5185\u5D4C\u4E66`;
          batch.push(...exportLoreBookSkill({ ...card.embeddedBook, name: embedName }));
          pushBook({ name: embedName, lorePath: `skills/${dshSlug("wb", embedName)}/references/lore.json` });
        }
        for (const b of globalBooks) pushBook(b);
        for (const b of extra.books) pushBook(b);
        const slug = dshSlug("rp", card.name);
        if (card.rawJson) {
          batch.push({ path: `${RP_WORKSPACE_DIR}/${slug}/card.json`, content: card.rawJson });
        }
        if (card.avatar) {
          batch.push({ path: `${RP_WORKSPACE_DIR}/${slug}/avatar.png`, content: bytesToBase64(card.avatar), binary: true });
        }
        batch.push({
          path: `${RP_WORKSPACE_DIR}/${slug}/rp.json`,
          content: buildRpJsonContent(card, books, { user: extra.user })
        });
      };
      const workspaces = /* @__PURE__ */ new Map();
      const wsFor = (dir, card) => {
        let ws = workspaces.get(dir);
        if (!ws) {
          ws = { dir, card, chats: [], variantGroups: 0, extraBooks: /* @__PURE__ */ new Map(), userName: "" };
          workspaces.set(dir, ws);
        }
        return ws;
      };
      if (wantChats) {
        const orphanDirs = /* @__PURE__ */ new Map();
        for (let i = 0; i < imp.chatFiles.length; i++) {
          const cf = imp.chatFiles[i];
          try {
            const text = await imp.zip.files[cf.path].async("string");
            let createdAt = Date.now();
            const firstLine = text.split("\n")[0];
            let meta = null;
            try {
              const parsed = JSON.parse(firstLine);
              if (parsed && typeof parsed === "object") {
                meta = parsed;
                const cd = Date.parse(String(meta.create_date ?? ""));
                if (Number.isSafeInteger(cd) && cd > 0) createdAt = cd;
              }
            } catch {
            }
            const fileName = cf.path.split("/").pop() ?? String(i);
            const sessionId = chatSessionId(cf.ownerDir, fileName);
            const card = lookupCard(cf.ownerDir);
            const dir = card ? dshSlug("rp", card.name) : ORPHAN_DIR;
            const chatCwd = dshHome !== void 0 ? `${dshHome}/${RP_WORKSPACE_DIR}/${dir}` : void 0;
            const conv = convertChatFile(text, { sessionId, createdAt, cwd: chatCwd });
            const sessionPath = sessionFilePath(sessionId, chatCwd);
            batch.push({ path: sessionPath, content: conv.content });
            result.sessions++;
            if (!card) orphanDirs.set(cf.ownerDir, (orphanDirs.get(cf.ownerDir) ?? 0) + 1);
            const ws = wsFor(dir, card);
            ws.chats.push({ file: fileName, sessionPath });
            ws.variantGroups += conv.variantGroups;
            if (meta) {
              const cm = meta.chat_metadata && typeof meta.chat_metadata === "object" ? meta.chat_metadata : {};
              if (cm.variables && typeof cm.variables === "object" && !Array.isArray(cm.variables)) {
                batch.push({
                  path: `${RP_WORKSPACE_DIR}/state/${sessionId}.json`,
                  content: JSON.stringify(cm.variables)
                });
              }
              for (const k of ["world", "worldName", "boundWorld"]) {
                const v = cm[k] ?? meta[k];
                if (typeof v === "string" && v.trim() && imp.worlds.has(v.trim())) {
                  const bookName = v.trim();
                  const lorePath = `skills/${dshSlug("wb", bookName)}/references/lore.json`;
                  ws.extraBooks.set(lorePath, { name: bookName, lorePath });
                }
              }
              const lup = cm.last_user_persona ?? meta.last_user_persona;
              const lupName = typeof lup === "string" ? lup : lup && typeof lup === "object" ? lup.name : null;
              if (typeof lupName === "string" && lupName.trim() && !ws.userName) ws.userName = lupName.trim();
            }
            if (conv.skipped > 0 && conv.turns === 0) {
              result.warnings.push(`\u804A\u5929\u300C${cf.path}\u300D\u65E0\u53EF\u8F6C\u6D88\u606F\uFF08${conv.skipped} \u884C\u8DF3\u8FC7\uFF09`);
            }
          } catch {
            result.warnings.push(`\u804A\u5929\u8F6C\u6362\u5931\u8D25\uFF1A${cf.path}`);
          }
          if (batch.length >= BATCH) {
            await flush({ percent: percentBase + Math.round((i + 1) / imp.chatFiles.length * percentSpan), desc: `\u804A\u5929 \u2192 session\uFF08${i + 1}/${imp.chatFiles.length}\uFF09` });
          }
        }
        if (orphanDirs.size > 0) {
          result.warnings.push(
            `\u5B64\u513F\u804A\u5929\u76EE\u5F55\uFF08\u672A\u5339\u914D\u5230\u89D2\u8272\u5361\uFF0C\u5DF2\u6302 ${RP_WORKSPACE_DIR}/${ORPHAN_DIR} \u5F85\u8BA4\u9886\uFF09\uFF1A` + [...orphanDirs.entries()].map(([d, c]) => `${d}\uFF08${c} \u4E2A\u804A\u5929\uFF09`).join("\u3001")
          );
        }
      }
      for (const card of imp.characters) {
        const slug = dshSlug("rp", card.name);
        const ws = workspaces.get(slug);
        emitCardRpJson(card, {
          books: ws ? [...ws.extraBooks.values()] : [],
          user: ws?.userName ?? ""
        });
        result.workspaces.push({ slug, name: card.name, dir: `${RP_WORKSPACE_DIR}/${slug}` });
      }
      for (const card of imp.characters) {
        const slug = dshSlug("rp", card.name);
        const ws = workspaces.get(slug);
        const chats = ws?.chats ?? [];
        const variantGroups = ws?.variantGroups ?? 0;
        const lines = [
          `# ${card.name}`,
          "",
          chats.length > 0 ? `SillyTavern \u8FC1\u79FB\u7684\u89D2\u8272\u5DE5\u4F5C\u533A\uFF08${chats.length} \u4E2A\u804A\u5929${variantGroups > 0 ? `\uFF0C\u542B ${variantGroups} \u4E2A\u53D8\u4F53\u7EC4\uFF08swipe\uFF09` : ""}\uFF09\u3002` : `SillyTavern \u8FC1\u79FB\u7684\u89D2\u8272\u5DE5\u4F5C\u533A\uFF08\u6682\u65E0\u8FC1\u79FB\u804A\u5929\uFF09\u3002`,
          "",
          `- \u5361\u8BBE\u5B9A\u6587\u672C\uFF1A\`rp.json\` \u7684 \`promptPersona\` \u5B57\u6BB5\uFF08RP \u4F1A\u8BDD\u6BCF\u8F6E\u5FEB\u7167\u6CE8\u5165\uFF09`,
          card.externalWorldRef ? `- \u5173\u8054\u4E16\u754C\u4E66\uFF1A\u300A${card.externalWorldRef}\u300B\uFF08skill \u5F62\u5F0F\uFF0C\u9700\u8BBE\u5B9A\u65F6\u6A21\u578B\u81EA\u52A8\u67E5\uFF09` : "",
          "",
          ...chats.length > 0 ? ["## \u804A\u5929\u6587\u4EF6", ...chats.map((c) => `- ${c.file}`), ""] : []
        ].filter((l) => l !== "");
        batch.push({
          path: `${RP_WORKSPACE_DIR}/${slug}/README.md`,
          content: lines.join("\n")
        });
      }
      const orphanWs = workspaces.get(ORPHAN_DIR);
      if (orphanWs) {
        batch.push({
          path: `${RP_WORKSPACE_DIR}/${ORPHAN_DIR}/README.md`,
          content: [
            `# \u5F85\u8BA4\u9886\u804A\u5929`,
            "",
            `SillyTavern \u4E2D\u672A\u5339\u914D\u5230\u89D2\u8272\u5361\u7684 ${orphanWs.chats.length} \u4E2A\u804A\u5929\uFF08\u76EE\u5F55\u540D\u5BF9\u4E0D\u4E0A characters/\uFF09\u3002`,
            "",
            "## \u804A\u5929\u6587\u4EF6",
            ...orphanWs.chats.map((c) => `- ${c.file}`),
            ""
          ].join("\n")
        });
        result.workspaces.push({ slug: ORPHAN_DIR, name: "\u5F85\u8BA4\u9886\u804A\u5929", dir: `${RP_WORKSPACE_DIR}/${ORPHAN_DIR}` });
      }
      await flush({ percent: 100, desc: "\u804A\u5929\u8F6C\u6362\u5B8C\u6210" });
    }
    await flush({ percent: 100, desc: "\u5B8C\u6210" });
    return result;
  }

  // src/import/browser-entry.ts
  async function rpPost(path, body) {
    const resp = await fetch("/dsht-rp" + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || json.error) throw new Error(String(json.error ?? `HTTP ${resp.status}`));
    return json;
  }
  async function rpGet(path) {
    const resp = await fetch("/dsht-rp" + path);
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || json.error) throw new Error(String(json.error ?? `HTTP ${resp.status}`));
    return json;
  }
  async function fetchImportPreview(batchId) {
    return await rpPost("/rp/import-preview", { batchId });
  }
  async function fetchImportCheckpoint(batchId) {
    return await rpGet(`/rp/import-checkpoint?batchId=${encodeURIComponent(batchId)}`);
  }
  async function fetchImportProgress(batchId) {
    return await rpGet(`/rp/import-progress?batchId=${encodeURIComponent(batchId)}`);
  }
  async function kickoffImport(batchId, opts = {}) {
    return await rpPost("/rp/import-kickoff", { batchId, ...opts.resumeFrom ? { resumeFrom: true } : {} });
  }
  return __toCommonJS(browser_entry_exports);
})();
/*! Bundled license information:

jszip/dist/jszip.min.js:
  (*!
  
  JSZip v3.10.1 - A JavaScript class for generating and reading zip files
  <http://stuartk.com/jszip>
  
  (c) 2009-2016 Stuart Knightley <stuart [at] stuartk.com>
  Dual licenced under the MIT license or GPLv3. See https://raw.github.com/Stuk/jszip/main/LICENSE.markdown.
  
  JSZip uses the library pako released under the MIT license :
  https://github.com/nodeca/pako/blob/main/LICENSE
  *)
*/
