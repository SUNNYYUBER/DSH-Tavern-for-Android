// src/dsht-plugin-memory/index.ts
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir as readdir2, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join as join3 } from "node:path";

// node_modules/@deepseek-ai/cosmokit/lib/index.js
function isNullable(value) {
  return value === null || value === void 0;
}
function isPlainObject(data) {
  return data && typeof data === "object" && !Array.isArray(data);
}
function filterKeys(object, filter) {
  return Object.fromEntries(Object.entries(object).filter(([key, value]) => filter(key, value)));
}
function mapValues(object, transform) {
  return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, transform(value, key)]));
}
function pick(source, keys, forced) {
  if (!keys) return { ...source };
  const result = {};
  for (const key of keys) if (forced || source[key] !== void 0) result[key] = source[key];
  return result;
}
function is(type, value) {
  if (arguments.length === 1) return (value2) => is(type, value2);
  return type in globalThis && value instanceof globalThis[type] || Object.prototype.toString.call(value).slice(8, -1) === type;
}
function isArrayBufferLike(value) {
  return is("ArrayBuffer", value) || is("SharedArrayBuffer", value);
}
function isArrayBufferSource(value) {
  return isArrayBufferLike(value) || ArrayBuffer.isView(value);
}
var Binary;
(function(Binary2) {
  Binary2.is = isArrayBufferLike;
  Binary2.isSource = isArrayBufferSource;
  function fromSource(source) {
    if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    else return source;
  }
  Binary2.fromSource = fromSource;
  function toBase64(source) {
    source = fromSource(source);
    if (typeof Buffer !== "undefined") return Buffer.from(source).toString("base64");
    let binary = "";
    const bytes = new Uint8Array(source);
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  Binary2.toBase64 = toBase64;
  function fromBase64(source) {
    if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "base64"));
    return Uint8Array.from(atob(source), (c) => c.charCodeAt(0));
  }
  Binary2.fromBase64 = fromBase64;
  function toHex(source) {
    source = fromSource(source);
    if (typeof Buffer !== "undefined") return Buffer.from(source).toString("hex");
    return Array.from(new Uint8Array(source), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  Binary2.toHex = toHex;
  function fromHex(source) {
    if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "hex"));
    const hex = source.length % 2 === 0 ? source : source.slice(0, source.length - 1);
    const buffer = [];
    for (let i = 0; i < hex.length; i += 2) buffer.push(parseInt(`${hex[i]}${hex[i + 1]}`, 16));
    return Uint8Array.from(buffer).buffer;
  }
  Binary2.fromHex = fromHex;
})(Binary || (Binary = {}));
var base64ToArrayBuffer = Binary.fromBase64;
var arrayBufferToBase64 = Binary.toBase64;
var hexToArrayBuffer = Binary.fromHex;
var arrayBufferToHex = Binary.toHex;
function clone(source, refs = /* @__PURE__ */ new Map()) {
  if (!source || typeof source !== "object") return source;
  if (is("Date", source)) return new Date(source.valueOf());
  if (is("RegExp", source)) return new RegExp(source.source, source.flags);
  if (isArrayBufferLike(source)) return source.slice(0);
  if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
  const cached = refs.get(source);
  if (cached) return cached;
  if (Array.isArray(source)) {
    const result2 = [];
    refs.set(source, result2);
    source.forEach((value, index) => {
      result2[index] = Reflect.apply(clone, null, [value, refs]);
    });
    return result2;
  }
  const result = Object.create(Object.getPrototypeOf(source));
  refs.set(source, result);
  for (const key of Reflect.ownKeys(source)) {
    const descriptor = { ...Reflect.getOwnPropertyDescriptor(source, key) };
    if ("value" in descriptor) descriptor.value = Reflect.apply(clone, null, [descriptor.value, refs]);
    Reflect.defineProperty(result, key, descriptor);
  }
  return result;
}
function deepEqual(a, b, strict) {
  if (a === b) return true;
  if (!strict && isNullable(a) && isNullable(b)) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  if (!a || !b) return false;
  function check(test, then) {
    return test(a) ? test(b) ? then(a, b) : false : test(b) ? false : void 0;
  }
  return check(Array.isArray, (a2, b2) => a2.length === b2.length && a2.every((item, index) => deepEqual(item, b2[index]))) ?? check(is("Date"), (a2, b2) => a2.valueOf() === b2.valueOf()) ?? check(is("RegExp"), (a2, b2) => a2.source === b2.source && a2.flags === b2.flags) ?? check(isArrayBufferLike, (a2, b2) => {
    if (a2.byteLength !== b2.byteLength) return false;
    const viewA = new Uint8Array(a2);
    const viewB = new Uint8Array(b2);
    for (let i = 0; i < viewA.length; i++) if (viewA[i] !== viewB[i]) return false;
    return true;
  }) ?? Object.keys({
    ...a,
    ...b
  }).every((key) => deepEqual(a[key], b[key], strict));
}
var Time;
(function(Time2) {
  Time2.millisecond = 1;
  Time2.second = 1e3;
  Time2.minute = Time2.second * 60;
  Time2.hour = Time2.minute * 60;
  Time2.day = Time2.hour * 24;
  Time2.week = Time2.day * 7;
  let timezoneOffset = (/* @__PURE__ */ new Date()).getTimezoneOffset();
  function setTimezoneOffset(offset) {
    timezoneOffset = offset;
  }
  Time2.setTimezoneOffset = setTimezoneOffset;
  function getTimezoneOffset() {
    return timezoneOffset;
  }
  Time2.getTimezoneOffset = getTimezoneOffset;
  function getDateNumber(date2 = /* @__PURE__ */ new Date(), offset) {
    if (typeof date2 === "number") date2 = new Date(date2);
    if (offset === void 0) offset = timezoneOffset;
    return Math.floor((date2.valueOf() / Time2.minute - offset) / 1440);
  }
  Time2.getDateNumber = getDateNumber;
  function fromDateNumber(value, offset) {
    const date2 = new Date(value * Time2.day);
    if (offset === void 0) offset = timezoneOffset;
    return new Date(+date2 + offset * Time2.minute);
  }
  Time2.fromDateNumber = fromDateNumber;
  const numeric = /\d+(?:\.\d+)?/.source;
  const timeRegExp = new RegExp(`^${[
    "w(?:eek(?:s)?)?",
    "d(?:ay(?:s)?)?",
    "h(?:our(?:s)?)?",
    "m(?:in(?:ute)?(?:s)?)?",
    "s(?:ec(?:ond)?(?:s)?)?"
  ].map((unit) => `(${numeric}${unit})?`).join("")}$`);
  function parseTime(source) {
    const capture = timeRegExp.exec(source);
    if (!capture) return 0;
    return (parseFloat(capture[1]) * Time2.week || 0) + (parseFloat(capture[2]) * Time2.day || 0) + (parseFloat(capture[3]) * Time2.hour || 0) + (parseFloat(capture[4]) * Time2.minute || 0) + (parseFloat(capture[5]) * Time2.second || 0);
  }
  Time2.parseTime = parseTime;
  function parseDate(date2) {
    const parsed = parseTime(date2);
    if (parsed) date2 = Date.now() + parsed;
    else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date2)) date2 = `${(/* @__PURE__ */ new Date()).toLocaleDateString()}-${date2}`;
    else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date2)) date2 = `${(/* @__PURE__ */ new Date()).getFullYear()}-${date2}`;
    return date2 ? new Date(date2) : /* @__PURE__ */ new Date();
  }
  Time2.parseDate = parseDate;
  function format(ms) {
    const abs = Math.abs(ms);
    if (abs >= Time2.day - Time2.hour / 2) return Math.round(ms / Time2.day) + "d";
    else if (abs >= Time2.hour - Time2.minute / 2) return Math.round(ms / Time2.hour) + "h";
    else if (abs >= Time2.minute - Time2.second / 2) return Math.round(ms / Time2.minute) + "m";
    else if (abs >= Time2.second) return Math.round(ms / Time2.second) + "s";
    return ms + "ms";
  }
  Time2.format = format;
  function toDigits(source, length = 2) {
    return source.toString().padStart(length, "0");
  }
  Time2.toDigits = toDigits;
  function template(template2, time = /* @__PURE__ */ new Date()) {
    return template2.replace("yyyy", time.getFullYear().toString()).replace("yy", time.getFullYear().toString().slice(2)).replace("MM", toDigits(time.getMonth() + 1)).replace("dd", toDigits(time.getDate())).replace("hh", toDigits(time.getHours())).replace("mm", toDigits(time.getMinutes())).replace("ss", toDigits(time.getSeconds())).replace("SSS", toDigits(time.getMilliseconds(), 3));
  }
  Time2.template = template;
})(Time || (Time = {}));

// node_modules/@deepseek-ai/schemastery/lib/index.mjs
var kSchema = /* @__PURE__ */ Symbol.for("schemastery");
var kValidationError = /* @__PURE__ */ Symbol.for("ValidationError");
globalThis.__schemastery_index__ ??= 0;
globalThis.__schemastery_refs__ = void 0;
var ValidationError = class extends TypeError {
  options;
  name = "ValidationError";
  constructor(message, options) {
    let prefix = "$";
    for (const segment of options.path || []) if (typeof segment === "string") prefix += "." + segment;
    else if (typeof segment === "number") prefix += "[" + segment + "]";
    else if (typeof segment === "symbol") prefix += `[Symbol(${segment.toString()})]`;
    if (prefix.startsWith(".")) prefix = prefix.slice(1);
    super((prefix === "$" ? "" : `${prefix} `) + message);
    this.options = options;
  }
  static is(error) {
    return !!error?.[kValidationError];
  }
};
Object.defineProperty(ValidationError.prototype, kValidationError, { value: true });
var Schema = function(options) {
  const schema = function(data, options2 = {}) {
    return Schema.resolve(data, schema, options2)[0];
  };
  if (options.refs) {
    const refs = mapValues(options.refs, (options2) => new Schema(options2));
    const getRef = (uid) => refs[uid];
    for (const key in refs) {
      const options2 = refs[key];
      options2.sKey = getRef(options2.sKey);
      options2.inner = getRef(options2.inner);
      options2.list = options2.list && options2.list.map(getRef);
      options2.dict = options2.dict && mapValues(options2.dict, getRef);
    }
    return refs[options.uid];
  }
  Object.assign(schema, options);
  if (typeof schema.callback === "string") try {
    schema.callback = new Function("return " + schema.callback)();
  } catch {
  }
  Object.defineProperty(schema, "uid", { value: globalThis.__schemastery_index__++ });
  Object.setPrototypeOf(schema, Schema.prototype);
  schema.meta ||= {};
  schema.toString = schema.toString.bind(schema);
  return schema;
};
Schema.prototype = Object.create(Function.prototype);
Schema.prototype[kSchema] = true;
Object.defineProperty(Schema.prototype, "~standard", { get() {
  return {
    version: 1,
    vendor: "schemastery",
    validate: (value) => {
      try {
        return { value: Schema.resolve(value, this, {})[0] };
      } catch (error) {
        if (ValidationError.is(error)) return { issues: [{
          message: error.message,
          path: error.options.path
        }] };
        throw error;
      }
    }
  };
} });
Schema.ValidationError = ValidationError;
Schema.prototype.toJSON = function toJSON() {
  if (globalThis.__schemastery_refs__) {
    globalThis.__schemastery_refs__[this.uid] ??= JSON.parse(JSON.stringify({ ...this }));
    return this.uid;
  }
  globalThis.__schemastery_refs__ = { [this.uid]: { ...this } };
  globalThis.__schemastery_refs__[this.uid] = JSON.parse(JSON.stringify({ ...this }));
  const result = {
    uid: this.uid,
    refs: globalThis.__schemastery_refs__
  };
  globalThis.__schemastery_refs__ = void 0;
  return result;
};
Schema.prototype.set = function set(key, value) {
  this.dict[key] = value;
  return this;
};
Schema.prototype.push = function push(value) {
  this.list.push(value);
  return this;
};
function mergeDesc(original, messages) {
  const result = typeof original === "string" ? { "": original } : { ...original };
  for (const locale in messages) {
    const value = messages[locale];
    if (value?.$description || value?.$desc) result[locale] = value.$description || value.$desc;
    else if (typeof value === "string") result[locale] = value;
  }
  return result;
}
function getInner(value) {
  return value?.$value ?? value?.$inner;
}
function extractKeys(data) {
  return filterKeys(data ?? {}, (key) => !key.startsWith("$"));
}
Schema.prototype.i18n = function i18n(messages) {
  const schema = Schema(this);
  const desc = mergeDesc(schema.meta.description, messages);
  if (Object.keys(desc).length) schema.meta.description = desc;
  if (schema.dict) schema.dict = mapValues(schema.dict, (inner, key) => {
    return inner.i18n(mapValues(messages, (data) => getInner(data)?.[key] ?? data?.[key]));
  });
  if (schema.list) schema.list = schema.list.map((inner, index) => {
    return inner.i18n(mapValues(messages, (data = {}) => {
      if (Array.isArray(getInner(data))) return getInner(data)[index];
      if (Array.isArray(data)) return data[index];
      return extractKeys(data);
    }));
  });
  if (schema.inner) schema.inner = schema.inner.i18n(mapValues(messages, (data) => {
    if (getInner(data)) return getInner(data);
    return extractKeys(data);
  }));
  if (schema.sKey) schema.sKey = schema.sKey.i18n(mapValues(messages, (data) => data?.$key));
  return schema;
};
Schema.prototype.extra = function extra(key, value) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    [key]: value
  };
  return schema;
};
for (const key of [
  "required",
  "disabled",
  "collapse",
  "hidden",
  "loose"
]) Object.assign(Schema.prototype, { [key](value = true) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    [key]: value
  };
  return schema;
} });
Schema.prototype.deprecated = function deprecated() {
  const schema = Schema(this);
  schema.meta.badges ||= [];
  schema.meta.badges.push({
    text: "deprecated",
    type: "danger"
  });
  return schema;
};
Schema.prototype.experimental = function experimental() {
  const schema = Schema(this);
  schema.meta.badges ||= [];
  schema.meta.badges.push({
    text: "experimental",
    type: "warning"
  });
  return schema;
};
Schema.prototype.pattern = function pattern(regexp) {
  const schema = Schema(this);
  const pattern2 = pick(regexp, ["source", "flags"]);
  schema.meta = {
    ...schema.meta,
    pattern: pattern2
  };
  return schema;
};
Schema.prototype.simplify = function simplify(value) {
  if (deepEqual(value, this.meta.default, this.type === "dict")) return null;
  if (isNullable(value)) return value;
  if (this.type === "object" || this.type === "dict") {
    const result = {};
    for (const key in value) {
      const item = (this.type === "object" ? this.dict[key] : this.inner)?.simplify(value[key]);
      if (this.type === "dict" || !isNullable(item)) result[key] = item;
    }
    if (deepEqual(result, this.meta.default, this.type === "dict")) return null;
    return result;
  } else if (this.type === "array" || this.type === "tuple") {
    const result = [];
    value.forEach((value2, index) => {
      const schema = this.type === "array" ? this.inner : this.list[index];
      const item = schema ? schema.simplify(value2) : value2;
      result.push(item);
    });
    return result;
  } else if (this.type === "intersect") {
    const result = {};
    for (const item of this.list) Object.assign(result, item.simplify(value));
    return result;
  } else if (this.type === "union") for (const schema of this.list) try {
    Schema.resolve(value, schema, {});
    return schema.simplify(value);
  } catch {
  }
  return value;
};
Schema.prototype.toString = function toString(inline) {
  return formatters[this.type]?.(this, inline) ?? `Schema<${this.type}>`;
};
Schema.prototype.role = function role(role, extra2) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    role,
    extra: extra2
  };
  return schema;
};
for (const key of [
  "default",
  "link",
  "comment",
  "description",
  "max",
  "min",
  "step"
]) Object.assign(Schema.prototype, { [key](value) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    [key]: value
  };
  return schema;
} });
var resolvers = {};
Schema.extend = function extend(type, resolve3) {
  resolvers[type] = resolve3;
};
Schema.resolve = function resolve(data, schema, options = {}, strict = false) {
  if (!schema) return [data];
  if (options.ignore?.(data, schema)) return [data];
  if (isNullable(data) && schema.type !== "lazy") {
    if (schema.meta.required) throw new ValidationError(`missing required value`, options);
    let current = schema;
    let fallback = schema.meta.default;
    while (current?.type === "intersect" && isNullable(fallback)) {
      current = current.list[0];
      fallback = current?.meta.default;
    }
    if (isNullable(fallback)) return [data];
    data = clone(fallback);
  }
  const callback = resolvers[schema.type];
  if (!callback) throw new ValidationError(`unsupported type "${schema.type}"`, options);
  try {
    return callback(data, schema, options, strict);
  } catch (error) {
    if (!schema.meta.loose) throw error;
    return [schema.meta.default];
  }
};
Schema.from = function from(source) {
  if (isNullable(source)) return Schema.any();
  else if ([
    "string",
    "number",
    "boolean"
  ].includes(typeof source)) return Schema.const(source).required();
  else if (source[kSchema]) return source;
  else if (typeof source === "function") switch (source) {
    case String:
      return Schema.string().required();
    case Number:
      return Schema.number().required();
    case Boolean:
      return Schema.boolean().required();
    case Function:
      return Schema.function().required();
    default:
      return Schema.is(source).required();
  }
  else throw new TypeError(`cannot infer schema from ${source}`);
};
Schema.lazy = function lazy(builder) {
  const toJSON2 = () => {
    if (!schema.inner[kSchema]) {
      schema.inner = schema.builder();
      schema.inner.meta = {
        ...schema.meta,
        ...schema.inner.meta
      };
    }
    return schema.inner.toJSON();
  };
  const schema = new Schema({
    type: "lazy",
    builder,
    inner: { toJSON: toJSON2 }
  });
  return schema;
};
Schema.natural = function natural() {
  return Schema.number().step(1).min(0);
};
Schema.percent = function percent() {
  return Schema.number().step(0.01).min(0).max(1).role("slider");
};
Schema.date = function date() {
  return Schema.union([Schema.is(Date), Schema.transform(Schema.string().role("datetime"), (value, options) => {
    const date2 = new Date(value);
    if (isNaN(+date2)) throw new ValidationError(`invalid date "${value}"`, options);
    return date2;
  }, true)]);
};
Schema.regExp = function regExp(flag = "") {
  return Schema.union([Schema.is(RegExp), Schema.transform(Schema.string().role("regexp", { flag }), (value, options) => {
    try {
      return new RegExp(value, flag);
    } catch (e) {
      throw new ValidationError(e.message, options);
    }
  }, true)]);
};
Schema.arrayBuffer = function arrayBuffer(encoding) {
  return Schema.union([
    Schema.is(ArrayBuffer),
    Schema.is(SharedArrayBuffer),
    Schema.transform(Schema.any(), (value, options) => {
      if (Binary.isSource(value)) return Binary.fromSource(value);
      throw new ValidationError(`expected ArrayBufferSource but got ${value}`, options);
    }, true),
    ...encoding ? [Schema.transform(Schema.string(), (value, options) => {
      try {
        return encoding === "base64" ? Binary.fromBase64(value) : Binary.fromHex(value);
      } catch (e) {
        throw new ValidationError(e.message, options);
      }
    }, true)] : []
  ]);
};
Schema.extend("lazy", (data, schema, options, strict) => {
  if (!schema.inner[kSchema]) {
    schema.inner = schema.builder();
    schema.inner.meta = {
      ...schema.meta,
      ...schema.inner.meta
    };
  }
  return Schema.resolve(data, schema.inner, options, strict);
});
Schema.extend("any", (data) => {
  return [data];
});
Schema.extend("never", (data, _, options) => {
  throw new ValidationError(`expected nullable but got ${data}`, options);
});
Schema.extend("const", (data, { value }, options) => {
  if (deepEqual(data, value)) return [value];
  throw new ValidationError(`expected ${value} but got ${data}`, options);
});
function checkWithinRange(data, meta, description, options, skipMin = false) {
  const { max = Infinity, min = -Infinity } = meta;
  if (data > max) throw new ValidationError(`expected ${description} <= ${max} but got ${data}`, options);
  if (data < min && !skipMin) throw new ValidationError(`expected ${description} >= ${min} but got ${data}`, options);
}
Schema.extend("string", (data, { meta }, options) => {
  if (typeof data !== "string") throw new ValidationError(`expected string but got ${data}`, options);
  if (meta.pattern) {
    const regexp = new RegExp(meta.pattern.source, meta.pattern.flags);
    if (!regexp.test(data)) throw new ValidationError(`expect string to match regexp ${regexp}`, options);
  }
  checkWithinRange(data.length, meta, "string length", options);
  return [data];
});
function decimalShift(data, digits) {
  const str = data.toString();
  if (str.includes("e")) return data * Math.pow(10, digits);
  const index = str.indexOf(".");
  if (index === -1) return data * Math.pow(10, digits);
  const frac = str.slice(index + 1);
  const integer = str.slice(0, index);
  if (frac.length <= digits) return +(integer + frac.padEnd(digits, "0"));
  return +(integer + frac.slice(0, digits) + "." + frac.slice(digits));
}
function isMultipleOf(data, min, step) {
  step = Math.abs(step);
  if (!/^\d+\.\d+$/.test(step.toString())) return (data - min) % step === 0;
  const index = step.toString().indexOf(".");
  const digits = step.toString().slice(index + 1).length;
  return Math.abs(decimalShift(data, digits) - decimalShift(min, digits)) % decimalShift(step, digits) === 0;
}
Schema.extend("number", (data, { meta }, options) => {
  if (typeof data !== "number") throw new ValidationError(`expected number but got ${data}`, options);
  checkWithinRange(data, meta, "number", options);
  const { step } = meta;
  if (step && !isMultipleOf(data, meta.min ?? 0, step)) throw new ValidationError(`expected number multiple of ${step} but got ${data}`, options);
  return [data];
});
Schema.extend("boolean", (data, _, options) => {
  if (typeof data === "boolean") return [data];
  throw new ValidationError(`expected boolean but got ${data}`, options);
});
Schema.extend("bitset", (data, { bits, meta }, options) => {
  let value = 0, keys = [];
  if (typeof data === "number") {
    value = data;
    for (const key in bits) if (data & bits[key]) keys.push(key);
  } else if (Array.isArray(data)) {
    keys = data;
    for (const key of keys) {
      if (typeof key !== "string") throw new ValidationError(`expected string but got ${key}`, options);
      if (key in bits) value |= bits[key];
    }
  } else throw new ValidationError(`expected number or array but got ${data}`, options);
  if (value === meta.default) return [value];
  return [value, keys];
});
Schema.extend("function", (data, _, options) => {
  if (typeof data === "function") return [data];
  throw new ValidationError(`expected function but got ${data}`, options);
});
Schema.extend("is", (data, { constructor }, options) => {
  if (typeof constructor === "function") {
    if (data instanceof constructor) return [data];
    throw new ValidationError(`expected ${constructor.name} but got ${data}`, options);
  } else {
    if (isNullable(data)) throw new ValidationError(`expected ${constructor} but got ${data}`, options);
    let prototype = Object.getPrototypeOf(data);
    while (prototype) {
      if (prototype.constructor?.name === constructor) return [data];
      prototype = Object.getPrototypeOf(prototype);
    }
    throw new ValidationError(`expected ${constructor} but got ${data}`, options);
  }
});
function property(data, key, schema, options) {
  try {
    const [value, adapted] = Schema.resolve(data[key], schema, {
      ...options,
      path: [...options.path || [], key]
    });
    if (adapted !== void 0) data[key] = adapted;
    return value;
  } catch (e) {
    if (!options?.autofix) throw e;
    delete data[key];
    return schema.meta.default;
  }
}
Schema.extend("array", (data, { inner, meta }, options) => {
  if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
  checkWithinRange(data.length, meta, "array length", options, !isNullable(inner.meta.default));
  return [data.map((_, index) => property(data, index, inner, options))];
});
Schema.extend("dict", (data, { inner, sKey }, options, strict) => {
  if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
  const result = {};
  for (const key in data) {
    let rKey;
    try {
      rKey = Schema.resolve(key, sKey, options)[0];
    } catch (error) {
      if (strict) continue;
      throw error;
    }
    result[rKey] = property(data, key, inner, options);
    data[rKey] = data[key];
    if (key !== rKey) delete data[key];
  }
  return [result];
});
Schema.extend("tuple", (data, { list }, options, strict) => {
  if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
  const result = list.map((inner, index) => property(data, index, inner, options));
  if (strict) return [result];
  result.push(...data.slice(list.length));
  return [result];
});
function merge(result, data) {
  for (const key in data) {
    if (key in result) continue;
    result[key] = data[key];
  }
}
Schema.extend("object", (data, { dict }, options, strict) => {
  if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
  const result = {};
  for (const key in dict) {
    const value = property(data, key, dict[key], options);
    if (!isNullable(value) || key in data) result[key] = value;
  }
  if (!strict) merge(result, data);
  return [result];
});
Schema.extend("union", (data, { list, toString: toString2 }, options, strict) => {
  const messages = [];
  for (const inner of list) try {
    return Schema.resolve(data, inner, options, strict);
  } catch (error) {
    messages.push(error);
  }
  throw new ValidationError(`expected ${toString2()} but got ${JSON.stringify(data)}`, options);
});
Schema.extend("intersect", (data, { list, toString: toString2 }, options, strict) => {
  if (!list.length) return [data];
  let result;
  for (const inner of list) {
    const value = Schema.resolve(data, inner, options, true)[0];
    if (isNullable(value)) continue;
    if (isNullable(result)) result = value;
    else if (typeof result !== typeof value) throw new ValidationError(`expected ${toString2()} but got ${JSON.stringify(data)}`, options);
    else if (typeof value === "object") merge(result ??= {}, value);
    else if (result !== value) throw new ValidationError(`expected ${toString2()} but got ${JSON.stringify(data)}`, options);
  }
  if (!strict && isPlainObject(data)) merge(result, data);
  return [result];
});
Schema.extend("transform", (data, { inner, callback, preserve }, options) => {
  const [result, adapted = data] = Schema.resolve(data, inner, options, true);
  if (preserve) return [callback(result)];
  else return [callback(result), callback(adapted)];
});
var formatters = {};
function defineMethod(name2, keys, format) {
  formatters[name2] = format;
  Object.assign(Schema, { [name2](...args) {
    const schema = new Schema({ type: name2 });
    keys.forEach((key, index) => {
      switch (key) {
        case "sKey":
          schema.sKey = args[index] ?? Schema.string();
          break;
        case "inner":
          schema.inner = Schema.from(args[index]);
          break;
        case "list":
          schema.list = args[index].map(Schema.from);
          break;
        case "dict":
          schema.dict = mapValues(args[index], Schema.from);
          break;
        case "bits":
          schema.bits = {};
          for (const key2 in args[index]) {
            if (typeof args[index][key2] !== "number") continue;
            schema.bits[key2] = args[index][key2];
          }
          break;
        case "callback": {
          const callback = schema.callback = args[index];
          callback["toJSON"] ||= () => callback.toString();
          break;
        }
        case "constructor": {
          const constructor = schema.constructor = args[index];
          if (typeof constructor === "function") constructor["toJSON"] ||= () => constructor["name"];
          break;
        }
        default:
          schema[key] = args[index];
      }
    });
    if (name2 === "object" || name2 === "dict") schema.meta.default = {};
    else if (name2 === "array" || name2 === "tuple") schema.meta.default = [];
    else if (name2 === "bitset") schema.meta.default = 0;
    return schema;
  } });
}
defineMethod("is", ["constructor"], ({ constructor }) => {
  if (typeof constructor === "function") return constructor.name;
  else return constructor;
});
defineMethod("any", [], () => "any");
defineMethod("never", [], () => "never");
defineMethod("const", ["value"], ({ value }) => typeof value === "string" ? JSON.stringify(value) : value);
defineMethod("string", [], () => "string");
defineMethod("number", [], () => "number");
defineMethod("boolean", [], () => "boolean");
defineMethod("bitset", ["bits"], () => "bitset");
defineMethod("function", [], () => "function");
defineMethod("array", ["inner"], ({ inner }) => `${inner.toString(true)}[]`);
defineMethod("dict", ["inner", "sKey"], ({ inner, sKey }) => `{ [key: ${sKey.toString()}]: ${inner.toString()} }`);
defineMethod("tuple", ["list"], ({ list }) => `[${list.map((inner) => inner.toString()).join(", ")}]`);
defineMethod("object", ["dict"], ({ dict }) => {
  if (Object.keys(dict).length === 0) return "{}";
  return `{ ${Object.entries(dict).map(([key, inner]) => {
    return `${key}${inner.meta.required ? "" : "?"}: ${inner.toString()}`;
  }).join(", ")} }`;
});
defineMethod("union", ["list"], ({ list }, inline) => {
  const result = list.map(({ toString: format }) => format()).join(" | ");
  return inline ? `(${result})` : result;
});
defineMethod("intersect", ["list"], ({ list }) => {
  return `${list.map((inner) => inner.toString(true)).join(" & ")}`;
});
defineMethod("transform", [
  "inner",
  "callback",
  "preserve"
], ({ inner }, isInner) => inner.toString(isInner));

// src/lore/entry.ts
var WI_POSITION = {
  BEFORE: 0,
  AFTER: 1,
  AN_TOP: 2,
  AN_BOTTOM: 3,
  AT_DEPTH: 4,
  EM_TOP: 5,
  EM_BOTTOM: 6,
  OUTLET: 7
};

// src/dsht-plugin-shared/http.ts
import { homedir } from "node:os";
import { resolve as resolve2, join } from "node:path";
function resolveDshHome() {
  const envHome = process.env.DSH_HOME?.trim();
  return envHome ? resolve2(envHome) : join(homedir(), ".dsh");
}
function isTrusted(req, webServer) {
  const host = String(req.headers.host ?? "").toLowerCase();
  const hostname = host.replace(/:\d+$/, "").replace(/^\[/, "").replace(/\]$/, "");
  const lanMode = webServer?.host === "0.0.0.0";
  if (!lanMode && !["127.0.0.1", "localhost", "::1"].includes(hostname)) return false;
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin !== "null" && !origin.endsWith(host)) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  return true;
}
function sendJson(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
async function readJsonBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
function queryOf(url) {
  const q = (url ?? "").split("?")[1] ?? "";
  return new URLSearchParams(q);
}
function subPath(url, prefix) {
  const p = (url ?? "").split("?")[0];
  return decodeURIComponent(p.replace(new RegExp(`^${prefix}`), "")) || "/";
}
function registerPrefix(ctx, prefix, logTag, handler) {
  if (!ctx.webServer) return;
  const webServer = ctx.webServer;
  const dispose = webServer.register({
    kind: "prefix",
    path: prefix,
    handler: (rawReq, rawRes) => {
      void (async () => {
        const req = rawReq;
        const res = rawRes;
        if (!isTrusted(req, webServer)) return sendJson(res, 403, { error: "forbidden" });
        try {
          await handler(subPath(req.url, prefix), req, res);
        } catch (e) {
          sendJson(res, 500, { error: e.message });
        }
      })();
    }
  });
  console.log(`[${logTag}] data plane on webServer route ${prefix}/*`);
  if (typeof ctx.effect === "function") {
    ctx.effect(() => () => {
      dispose();
    });
  }
}

// src/dsht-plugin-shared/session-surgery.ts
import { open, readdir } from "node:fs/promises";
import { join as join2 } from "node:path";
async function readFirstLine(path) {
  let handle = null;
  try {
    handle = await open(path, "r");
    const buf = Buffer.alloc(8192);
    const { bytesRead } = await handle.read(buf, 0, 8192, 0);
    if (bytesRead === 0) return null;
    const chunk = buf.subarray(0, bytesRead).toString("utf8");
    const nl = chunk.indexOf("\n");
    return nl === -1 ? chunk : chunk.slice(0, nl);
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {
    });
  }
}
async function scanSessionHeaders(dshHome) {
  const root = join2(dshHome, "sessions");
  const out = [];
  let projects = [];
  try {
    projects = await readdir(root);
  } catch {
    return out;
  }
  for (const project of projects) {
    let sdirs = [];
    try {
      sdirs = await readdir(join2(root, project));
    } catch {
      continue;
    }
    for (const sdir of sdirs) {
      const firstLine = await readFirstLine(join2(root, project, sdir, "session.jsonl"));
      if (firstLine === null) continue;
      try {
        const header = JSON.parse(firstLine);
        if (header?.type !== "session" || typeof header.id !== "string") continue;
        out.push({
          sessionId: header.id,
          cwd: typeof header.cwd === "string" ? header.cwd : void 0,
          project,
          sdir,
          firstLine
        });
      } catch {
      }
    }
  }
  return out;
}

// src/dsht-plugin-memory/index.ts
var name = "dsht-plugin-memory";
var inject = ["webServer", "settings", "llm", "agentDefaultModel"];
var CONFIG_DEFAULTS = { enabled: true, everyN: 11, keepNearFloors: 30, charBudget: 6e4, foldOldFloors: true, summaryMaxChars: 600 };
var CONFIG_SCHEMA = Schema.object({
  \u603B\u5F00\u5173: Schema.boolean().default(true),
  \u6BCFN\u697C\u603B\u7ED3: Schema.number().default(11),
  \u4FDD\u7559\u8FD1M\u697C\u539F\u6587: Schema.number().default(30),
  \u8FD1\u7A97\u5B57\u7B26\u9884\u7B97: Schema.number().default(6e4),
  \u6298\u53E0\u8001\u697C\u5C42: Schema.boolean().default(true),
  \u6458\u8981\u5B57\u6570\u4E0A\u9650: Schema.number().default(600)
});
var CONFIG_NS = "dsht-plugin-memory";
function configFromSchemaValue(v) {
  const o = v ?? {};
  const num = (x, def, min) => typeof x === "number" && Number.isFinite(x) && x >= min ? Math.floor(x) : def;
  return {
    enabled: o["\u603B\u5F00\u5173"] !== false,
    everyN: num(o["\u6BCFN\u697C\u603B\u7ED3"], 11, 5),
    keepNearFloors: num(o["\u4FDD\u7559\u8FD1M\u697C\u539F\u6587"], 30, 0),
    charBudget: num(o["\u8FD1\u7A97\u5B57\u7B26\u9884\u7B97"], 6e4, 5e3),
    foldOldFloors: o["\u6298\u53E0\u8001\u697C\u5C42"] !== false,
    summaryMaxChars: num(o["\u6458\u8981\u5B57\u6570\u4E0A\u9650"], 600, 100)
  };
}
function readConfig(raw) {
  try {
    return configFromSchemaValue(CONFIG_SCHEMA(raw ?? {}));
  } catch {
    return { ...CONFIG_DEFAULTS };
  }
}
function eventText(data) {
  const d = data;
  const blocks = d?.content ?? d?.message?.content ?? [];
  return blocks.filter((b) => b && b.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n");
}
function extractFloorsFromEvents(events) {
  const floors = [];
  let cursor = 0;
  let lastAssistantTurn = null;
  for (const e of events) {
    if (!e || typeof e.type !== "string") continue;
    if (e.type === "user/message") {
      const source = e.data?.source;
      if (source?.kind !== "user") continue;
      cursor++;
      lastAssistantTurn = null;
      floors.push({ floor: cursor, role: "user", text: eventText(e.data) });
    } else if (e.type === "assistant/message") {
      const d = e.data;
      const turn = typeof d?.turn === "number" ? d.turn : typeof d?.message?.turn === "number" ? d.message.turn : null;
      if (typeof turn === "number" && turn === lastAssistantTurn) {
        const cur = floors[floors.length - 1];
        if (cur !== void 0 && cur.role === "assistant") {
          const t = eventText(e.data);
          if (t) cur.text = cur.text ? `${cur.text}

${t}` : t;
        }
        continue;
      }
      cursor++;
      lastAssistantTurn = typeof turn === "number" ? turn : null;
      floors.push({ floor: cursor, role: "assistant", text: eventText(e.data) });
    }
  }
  return { floors, cursor };
}
function nextChunk(lastFloor, cursor, everyN) {
  if (!Number.isFinite(lastFloor) || !Number.isFinite(cursor) || everyN < 1) return null;
  if (cursor < 0 || cursor <= lastFloor) return null;
  const from2 = lastFloor + 1;
  if (cursor - lastFloor < everyN) return null;
  return { from: from2, to: Math.min(cursor, from2 + everyN - 1) };
}
function parseMemoryRange(comment) {
  const m = /^记忆#(\d+)-(\d+)$/.exec(String(comment ?? "").trim());
  return m ? { start: Number(m[1]), end: Number(m[2]) } : null;
}
function planShadowOps(nodes, opts) {
  const { keepNearFloors, charBudget, memoryMaxFloor, foldFloors, cursor, freshSigs, windowKeepSeq } = opts;
  const charsBefore = nodes.reduce((s, n) => s + n.chars, 0);
  const ops = [];
  if (nodes.length === 0) return { ops, charsBefore, charsAfter: charsBefore, flooredUpTo: 0 };
  const floorGroups = [];
  {
    let g = null;
    let gTurn = null;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (!n.isFloor) continue;
      if (g !== null && n.turn !== null && gTurn !== null && n.turn === gTurn) {
        g.endIdx = i;
        g.chars += n.chars;
      } else {
        if (g !== null) floorGroups.push(g);
        g = { startIdx: i, endIdx: i, chars: n.chars };
        gTurn = n.turn;
      }
    }
    if (g !== null) floorGroups.push(g);
  }
  const nFloors = floorGroups.length;
  const lastFloorAbs = cursor > 0 ? cursor : nFloors;
  const absOf = (j) => lastFloorAbs - (nFloors - 1 - j);
  let keptFromJ = nFloors;
  if (foldFloors && nFloors > 0) {
    let count = 0;
    let chars = 0;
    let j = nFloors - 1;
    while (j >= 0) {
      const c = floorGroups[j].chars;
      if (count >= keepNearFloors || chars + c > charBudget) break;
      chars += c;
      count++;
      keptFromJ = j;
      j--;
    }
  }
  let boundaryJ = -1;
  for (let j = 0; j < nFloors; j++) {
    if (absOf(j) <= memoryMaxFloor) boundaryJ = j;
    else break;
  }
  const prefixEndJ = foldFloors ? Math.min(boundaryJ, keptFromJ - 1) : -1;
  let prefixEndIdx = -1;
  if (prefixEndJ >= 0) {
    prefixEndIdx = floorGroups[prefixEndJ].endIdx;
  }
  if (prefixEndIdx >= 0) {
    ops.push({ start: nodes[0].seq, end: nodes[prefixEndIdx].seq, kind: "history" });
  }
  const winFrom = prefixEndIdx + 1;
  const lastOfSig = /* @__PURE__ */ new Map();
  for (let i = winFrom; i < nodes.length; i++) {
    if (nodes[i].isSnapshot) lastOfSig.set(nodes[i].sig, i);
  }
  const shadowRuns = [];
  let runStart = -1;
  for (let i = winFrom; i < nodes.length; i++) {
    const n = nodes[i];
    const supersededByFresh = freshSigs !== void 0 && freshSigs.has(n.sig);
    const exempt = windowKeepSeq !== void 0 && n.windowCopy === true && n.seq === windowKeepSeq;
    const shadowable = n.isSnapshot && !exempt && (supersededByFresh || lastOfSig.get(n.sig) !== i || n.oneshot === true || n.windowCopy === true && windowKeepSeq !== void 0 && n.seq !== windowKeepSeq);
    if (shadowable) {
      if (runStart < 0) runStart = i;
      continue;
    }
    if (runStart >= 0) {
      shadowRuns.push([runStart, i - 1]);
      runStart = -1;
    }
  }
  if (runStart >= 0) shadowRuns.push([runStart, nodes.length - 1]);
  for (const [a, b] of shadowRuns) {
    ops.push({ start: nodes[a].seq, end: nodes[b].seq, kind: "snapshot" });
  }
  const charsOf = (from2, to) => nodes.slice(from2, to + 1).reduce((s, n) => s + n.chars, 0);
  const shadowed = ops.reduce((s, op) => {
    const a = nodes.findIndex((n) => n.seq === op.start);
    const b = nodes.findIndex((n) => n.seq === op.end);
    return s + charsOf(a, b);
  }, 0);
  const markers = ops.length * 30;
  const prefixOp = ops.find((o) => o.kind === "history");
  const flooredUpTo = prefixOp ? absOf(prefixEndJ) : 0;
  return { ops, charsBefore, charsAfter: charsBefore - shadowed + markers, flooredUpTo };
}
function buildMemoryEntry(bookName, from2, to, summary) {
  return {
    id: `lore-mem-${bookName}-${from2}-${to}`,
    comment: `\u8BB0\u5FC6#${from2}-${to}`,
    content: String(summary ?? "").trim(),
    keys: [],
    secondaryKeys: [],
    selectiveLogic: 0,
    constant: true,
    selective: false,
    position: WI_POSITION.BEFORE,
    depth: 4,
    role: "system",
    scanDepth: null,
    preventRecursion: false,
    excludeRecursion: false,
    insertionOrder: 3,
    sticky: 0,
    cooldown: 0,
    delay: 0,
    group: "",
    groupOverride: false,
    enabled: true,
    book: bookName
  };
}
function rollbackMemoryBook(entries, cursor) {
  const kept = entries.filter((e) => {
    const r = parseMemoryRange(e.comment);
    return r === null || r.end <= cursor;
  });
  const lastFloor = kept.reduce((m, e) => {
    const r = parseMemoryRange(e.comment);
    return r ? Math.max(m, r.end) : m;
  }, 0);
  return { entries: kept, lastFloor, dropped: entries.length - kept.length };
}
var FLOOR_TEXT_CAP = 2e3;
var PROMPT_BODY_CAP = 6e4;
function buildSummarizePrompt(from2, to, floors, summaryMaxChars = 600) {
  const cap = Number.isFinite(summaryMaxChars) && summaryMaxChars >= 100 ? Math.floor(summaryMaxChars) : 600;
  const system = [
    "\u4F60\u662F\u5267\u60C5\u8BB0\u5FC6\u538B\u7F29\u5668\u3002\u628A\u7ED9\u5B9A\u7684 RP \u5267\u60C5\u539F\u6587\u538B\u7F29\u6210\u4E00\u4EFD\u5267\u60C5\u8BB0\u5FC6\uFF0C\u4F9B AI \u5728\u540E\u7EED\u697C\u5C42\u56DE\u770B\u3002",
    "\u8F93\u51FA markdown\uFF08\u4E0D\u8981\u4EFB\u4F55\u524D\u540E\u7F00\u8BC4\u8BBA\uFF09\uFF0C\u5206\u8282\uFF1A",
    "## \u65F6\u95F4\u5730\u70B9 / ## \u4EBA\u7269\u72B6\u6001 / ## \u5173\u7CFB\u53D8\u5316 / ## \u4E8B\u4EF6\u4E0E\u4F0F\u7B14 / ## \u5173\u952E\u8BCD",
    "- \u53EA\u8BB0\u4E8B\u5B9E\u4E0E\u72B6\u6001\uFF0C\u4E0D\u5199\u611F\u60F3\uFF1B\u6570\u5B57\uFF08\u65F6\u95F4/\u697C\u5C42/\u6570\u91CF\uFF09\u539F\u6837\u4FDD\u7559\uFF1B",
    "- \u300C\u5173\u952E\u8BCD\u300D\u4E00\u884C\u5217 \u4EBA\u540D/\u7269\u54C1/\u5730\u540D\uFF08\u7A7A\u683C\u5206\u9694\uFF09\uFF0C\u4F9B\u4E16\u754C\u4E66\u68C0\u7D22\uFF1B",
    `- \u5168\u6587\u4E0D\u8D85\u8FC7 ${cap} \u5B57\uFF1B\u539F\u6587\u672A\u63D0\u53CA\u7684\u5206\u8282\u5199\u300C\uFF08\u65E0\uFF09\u300D\u3002`
  ].join("\n");
  let body = floors.map((f) => `[\u7B2C${f.floor}\u697C\xB7${f.role === "user" ? "\u7528\u6237" : "\u89D2\u8272"}]
${f.text.slice(0, FLOOR_TEXT_CAP)}`).join("\n\n");
  if (body.length > PROMPT_BODY_CAP) body = `\u2026\uFF08\u524D\u6587\u8FC7\u957F\u5DF2\u622A\uFF09
${body.slice(-PROMPT_BODY_CAP)}`;
  const user = `\u4EE5\u4E0B\u662F\u7B2C ${from2} \u5230 ${to} \u697C\u7684\u5267\u60C5\u539F\u6587\uFF0C\u8BF7\u6309\u534F\u8BAE\u8F93\u51FA\u5267\u60C5\u8BB0\u5FC6\uFF1A

${body}`;
  return { system, user };
}
function neutralizeMacros(text) {
  return text.includes("{{") ? text.split("{{").join("\uFF5B\uFF5B").split("}}").join("\uFF5D\uFF5D") : text;
}
function desiredWindow(cursor, keepNearFloors, foldedUpTo) {
  if (!Number.isFinite(cursor) || !Number.isFinite(keepNearFloors) || !Number.isFinite(foldedUpTo)) return null;
  if (foldedUpTo < 1 || keepNearFloors < 1 || cursor < 1) return null;
  const from2 = Math.max(1, cursor - keepNearFloors + 1);
  if (from2 > foldedUpTo) return null;
  return { from: from2, to: foldedUpTo };
}
function buildExpandSnapshot(kind, from2, to, floors, budget) {
  const inRange = floors.filter((f) => f.floor >= from2 && f.floor <= to && f.text.trim() !== "");
  if (inRange.length === 0) return null;
  const kept = [];
  let chars = 0;
  for (let i = inRange.length - 1; i >= 0; i--) {
    const f = inRange[i];
    const cost = f.text.length + 30;
    if (kept.length > 0 && chars + cost > budget) break;
    kept.unshift(f);
    chars += cost;
  }
  const first = kept[0];
  const last = kept[kept.length - 1];
  const capped = first.floor > inRange[0].floor;
  const capNote = capped ? "\uFF1B\u9884\u7B97\u6240\u9650\u4EC5\u542B\u6700\u8FD1\u90E8\u5206\uFF0C\u66F4\u65E9\u697C\u5C42\u672A\u542B" : "";
  const header = kind === "oneshot" ? `\u3010\u5C55\u5F00\u56DE\u663E\uFF08\u5355\u6B21\uFF09\u3011\u7B2C ${first.floor}-${last.floor} \u697C\u539F\u6587\uFF08\u5E94\u8BF7\u6C42\u4E34\u65F6\u8FD8\u7ED9\u6A21\u578B\uFF0C\u4E0B\u4E00\u8F6E\u8D77\u81EA\u52A8\u6536\u56DE${capNote}\uFF09` : `\u3010\u5C55\u5F00\u56DE\u7A97\u3011\u7B2C ${first.floor}-${last.floor} \u697C\u539F\u6587\uFF08AI \u53EF\u89C1\u7A97\u53E3\u6269\u5927\u540E\u6CE8\u56DE\uFF0C\u7A97\u53E3\u6536\u7F29\u65F6\u6536\u56DE${capNote}\uFF09`;
  const body = kept.map((f) => `[\u7B2C${f.floor}\u697C\xB7${f.role === "user" ? "\u7528\u6237" : "\u89D2\u8272"}]
${neutralizeMacros(f.text)}`).join("\n\n");
  return { text: `${header}

${body}`, effectiveFrom: first.floor, effectiveTo: last.floor, capped };
}
function parseFoldedFromMarker(text) {
  const m = /第 1-(\d+) 楼原文已折叠/.exec(String(text ?? ""));
  return m ? Number(m[1]) : 0;
}
function rangeCovers(copy, want, budget) {
  if (!Number.isFinite(copy?.from) || !Number.isFinite(copy?.to)) return false;
  if (copy.to < want.to) return false;
  if (copy.from <= want.from) return true;
  return copy.capped === true && (copy.budget ?? 0) >= budget;
}
function apply(ctx, _config) {
  const dshHome = resolveDshHome();
  const memoryBookName = "\u5267\u60C5\u8BB0\u5FC6";
  const retainedPlot = /* @__PURE__ */ new WeakMap();
  ctx.on("agent/pre-step", async (raw, next) => {
    const decision = await next();
    if (decision?.kind !== "enter") return decision;
    try {
      const agent = raw.agent;
      const session = agent?.session;
      if (!session) return decision;
      const slug = await slugFromCwd(session.header?.cwd);
      if (!slug) return decision;
      const cfg = readEffectiveConfig();
      const sid = String(session.id ?? "");
      const book = await loadMemoryBook(slug);
      const maxFloor = book.entries.reduce((m, e) => {
        const r = parseMemoryRange(e.comment);
        return r ? Math.max(m, r.end) : m;
      }, 0);
      const messages = decision.messages ?? [];
      let injected = false;
      let expandNote = "";
      const floorsCache = { v: null };
      const floorsOfSession = () => {
        if (floorsCache.v === null) {
          floorsCache.v = extractFloorsFromEvents(Object.values(session.events ?? {}));
        }
        return floorsCache.v.floors;
      };
      const floorCursorOfSession = () => {
        if (floorsCache.v === null) floorsOfSession();
        return floorsCache.v?.cursor ?? 0;
      };
      try {
        const pendingPath = join3(dshHome, "rp", "memory-expand", `${sid}.json`);
        const parsed = JSON.parse(await readFile(pendingPath, "utf8").catch(() => "null"));
        const reqs = Array.isArray(parsed?.requests) ? parsed.requests : [];
        if (reqs.length > 0) {
          const froms = reqs.map((r) => Number(r.from)).filter((n) => Number.isFinite(n) && n >= 1);
          const tos = reqs.map((r) => Number(r.to)).filter((n) => Number.isFinite(n) && n >= 1);
          const built = froms.length > 0 && tos.length > 0 ? buildExpandSnapshot("oneshot", Math.min(...froms), Math.max(...tos), floorsOfSession(), cfg.charBudget) : null;
          if (built) {
            messages.push({
              id: `dsht-memory-expand-${randomUUID()}`,
              role: "user",
              content: [{ type: "text", text: built.text }],
              source: { kind: "plugin", plugin: name, form: "snapshot", oneshot: true, sections: [{ name: "dsht-memory:oneshot", text: built.text }] }
            });
            injected = true;
            expandNote = `\uFF1B\u5355\u6B21\u5C55\u5F00 \u7B2C${built.effectiveFrom}-${built.effectiveTo} \u697C`;
          }
          await rm(pendingPath, { force: true });
        }
      } catch (e) {
        console.warn(`[dsht-memory] \u5355\u6B21\u5C55\u5F00\u6D88\u8D39\u5931\u8D25\uFF08\u4E0D\u5F71\u54CD\u672C turn\uFF09\uFF1A${e.message}`);
      }
      let windowKeepSeq;
      try {
        const folded = await foldedUpToOf(sid, session);
        const cursorW = floorCursorOfSession();
        const want = desiredWindow(cursorW, cfg.keepNearFloors, folded);
        if (want === null) {
          windowKeepSeq = null;
        } else {
          const copies = scanWindowCopies(session);
          const last = copies[copies.length - 1];
          if (last !== void 0 && rangeCovers(last.range, want, cfg.charBudget)) {
            windowKeepSeq = last.seq;
          } else {
            const built = buildExpandSnapshot("window", want.from, want.to, floorsOfSession(), cfg.charBudget);
            if (built) {
              messages.push({
                id: `dsht-memory-window-${randomUUID()}`,
                role: "user",
                content: [{ type: "text", text: built.text }],
                source: {
                  kind: "plugin",
                  plugin: name,
                  form: "snapshot",
                  windowRange: { from: built.effectiveFrom, to: built.effectiveTo, capped: built.capped, budget: cfg.charBudget },
                  sections: [{ name: "dsht-memory:expand-window", text: built.text }]
                }
              });
              injected = true;
              expandNote += `${expandNote ? "\uFF1B" : ""}\u7A97\u53E3\u6CE8\u56DE \u7B2C${built.effectiveFrom}-${built.effectiveTo} \u697C`;
            }
            windowKeepSeq = null;
          }
        }
      } catch (e) {
        windowKeepSeq = void 0;
        console.warn(`[dsht-memory] \u7A97\u53E3\u6838\u5BF9\u5931\u8D25\uFF08\u4E0D\u5F71\u54CD\u672C turn\uFF09\uFF1A${e.message}`);
      }
      if (book.entries.length > 0) {
        const text = [
          `\u3010\u5267\u60C5\u8BB0\u5FC6\uFF08\u7B2C 1-${maxFloor} \u697C\u6458\u8981\uFF1B\u66F4\u65E9\u539F\u6587\u5DF2\u6298\u53E0\u8FDB\u672C\u5FEB\u7167\uFF09\u3011`,
          ...book.entries.map((e) => `<memory_floor ${e.comment}>
${e.content}
</memory_floor>`)
        ].join("\n\n");
        if (retainedPlot.get(agent) !== text) {
          retainedPlot.set(agent, text);
          messages.push({
            id: `dsht-memory-plot-${randomUUID()}`,
            role: "user",
            content: [{ type: "text", text }],
            source: { kind: "plugin", plugin: name, form: "snapshot", sections: [{ name: "dsht-memory:plot", text }] }
          });
          injected = true;
        }
      }
      let shadowNote = "";
      try {
        const freshSigs = /* @__PURE__ */ new Set();
        for (const m of messages) {
          const src = m.source;
          if (src?.form === "snapshot") {
            freshSigs.add(JSON.stringify([src.plugin ?? "", (Array.isArray(src.sections) ? src.sections : []).map((x) => x?.name ?? "")]));
          }
        }
        shadowNote = await shadowSurface(session, sid, cfg, maxFloor, freshSigs, windowKeepSeq);
      } catch (e) {
        console.warn(`[dsht-memory] surface \u5F71\u5B50\u5316\u5931\u8D25\uFF08\u4E0D\u5F71\u54CD\u672C turn\uFF09\uFF1A${e.message}`);
      }
      if (injected || shadowNote) {
        console.log(`[dsht-memory] pre-step${injected ? ` \u6CE8\u5165\u5267\u60C5\u8BB0\u5FC6 ${book.entries.length} \u6761\uFF08\u8986\u76D6\u5230\u7B2C ${maxFloor} \u697C\uFF09${expandNote}` : ""}${expandNote && !injected ? expandNote : ""}${shadowNote}`);
      }
      return { ...decision, messages };
    } catch (e) {
      console.warn(`[dsht-memory] pre-step \u5931\u8D25\uFF08\u4E0D\u5F71\u54CD\u672C turn\uFF09\uFF1A${e.message}`);
      return decision;
    }
  });
  try {
    ctx.settings?.register?.(CONFIG_NS, CONFIG_SCHEMA, { base: { ...CONFIG_DEFAULTS } });
    console.log("[dsht-memory] settings namespace registered: dsht-plugin-memory");
  } catch (e) {
    console.warn(`[dsht-memory] settings namespace \u6CE8\u518C\u5931\u8D25\uFF08\u4E0D\u5F71\u54CD\u672C\u4F53\uFF09\uFF1A${e.message}`);
  }
  const readEffectiveConfig = () => {
    try {
      return readConfig(ctx.settings?.get?.(CONFIG_NS));
    } catch {
      return { ...CONFIG_DEFAULTS };
    }
  };
  const progressDir = join3(dshHome, "rp", "memory-progress");
  const TOKENS_PER_CHAR = 0.31;
  const SHADOW_TRIGGER_TOKENS = 8e4;
  const estimateCoreTokens = (content) => {
    const blocks = Array.isArray(content) ? content : [];
    let tokens = 0;
    for (const block of blocks) {
      if ((block.type === "text" || block.type === "reasoning") && typeof block.text === "string") {
        tokens += Math.ceil(block.text.length / 4) + 4;
      } else {
        tokens += 4 + Math.ceil(JSON.stringify(block).length / 4);
      }
    }
    return tokens;
  };
  const shadowSurface = async (session, sid, cfg, maxFloor, freshSigs, windowKeepSeq) => {
    const surface = session.surface;
    const events = session.events;
    const viewSeqs = surface?.nodes ?? [];
    if (viewSeqs.length === 0) return "";
    const nodes = [];
    for (const seq of viewSeqs) {
      const ev = events?.[seq];
      if (!ev || ev.type !== "user/message" && ev.type !== "assistant/message") continue;
      const m = ev.data ?? {};
      const blocks = Array.isArray(m.content) ? m.content : [];
      const chars = blocks.filter((b) => b && b.type === "text" && typeof b.text === "string").reduce((s, b) => s + b.text.length, 0);
      const src = m.source ?? {};
      const dm = ev.data ?? {};
      const turn = typeof dm.turn === "number" ? dm.turn : typeof dm.message?.turn === "number" ? dm.message.turn : null;
      nodes.push({
        seq,
        isFloor: m.role === "assistant" || m.role === "user" && src.kind === "user",
        turn: m.role === "assistant" ? turn : null,
        // 本插件自己的影子 marker 也归入"可折叠快照"——否则 marker 每轮新增一个、
        // 永远留在视图里（模型实测抱怨"很多重复的上下文折叠标记"）；归入后随连续段
        // 合并折叠，marker 数量有界（每个连续段一个）
        isSnapshot: src.form === "snapshot" || src.plugin === name && src.kind === "plugin",
        sig: JSON.stringify([src.plugin ?? "", (Array.isArray(src.sections) ? src.sections : []).map((x) => x?.name ?? "")]),
        chars,
        oneshot: src.form === "snapshot" && src.oneshot === true,
        windowCopy: src.form === "snapshot" && src.windowRange !== void 0
      });
    }
    const estTokens = Math.round(nodes.reduce((s, n) => s + n.chars, 0) * TOKENS_PER_CHAR);
    if (estTokens <= SHADOW_TRIGGER_TOKENS) return "";
    const cursor = extractFloorsFromEvents(Object.values(events ?? {})).cursor;
    const plan = planShadowOps(nodes, {
      keepNearFloors: cfg.keepNearFloors,
      charBudget: cfg.charBudget,
      memoryMaxFloor: maxFloor,
      foldFloors: cfg.foldOldFloors,
      cursor,
      freshSigs,
      windowKeepSeq
    });
    if (plan.ops.length === 0) return "";
    for (const op of plan.ops) {
      const inRange = viewSeqs.filter((seq) => seq >= op.start && seq <= op.end);
      if (inRange.length === 0) continue;
      const shadowedTokens = inRange.reduce((s, seq) => {
        const m = events?.[seq]?.data ?? {};
        return s + estimateCoreTokens(m.content) + 4;
      }, 0);
      session.append("compaction/prune", {
        shadowedRange: { start: op.start, end: op.end },
        shadowedSeqs: inRange,
        shadowedTokenCount: shadowedTokens
      });
      const markerText = op.kind === "history" ? `[\u4E0A\u4E0B\u6587\u7626\u8EAB] \u7B2C 1-${plan.flooredUpTo} \u697C\u539F\u6587\u5DF2\u6298\u53E0\uFF0C\u5267\u60C5\u8981\u70B9\u89C1\u300C\u5267\u60C5\u8BB0\u5FC6\u300D\u5FEB\u7167\uFF1B\u4EE5\u4E0B\u4E3A\u6700\u8FD1\u539F\u6587\u3002` : "[\u65E7\u5FEB\u7167\u526F\u672C\u5DF2\u6298\u53E0]";
      session.append("user/message", {
        id: `dsht-memory-shadow-${randomUUID()}`,
        role: "user",
        content: [{ type: "text", text: markerText }],
        source: op.kind === "history" ? { kind: "plugin", plugin: name, folded: { from: 1, to: plan.flooredUpTo }, sections: [{ name: "dsht-memory:foldmarker", text: markerText }] } : { kind: "plugin", plugin: name }
      }, { surfaceOp: { op: "replace", start: op.start, end: op.end }, sourceEventSeqs: inRange });
    }
    console.log(`[dsht-memory] surface shadow: est=${(estTokens / 1e3).toFixed(0)}k tokens, ops=${plan.ops.length}\uFF08history=${plan.ops.filter((o) => o.kind === "history").length} snapshot=${plan.ops.filter((o) => o.kind === "snapshot").length}\uFF09\uFF0C\u89C6\u56FE ${(plan.charsBefore / 1e4).toFixed(1)}\u4E07\u2192${(plan.charsAfter / 1e4).toFixed(1)}\u4E07\u5B57\u7B26\uFF0C\u6298\u53E0\u81F3\u7B2C ${plan.flooredUpTo} \u697C`);
    if (plan.flooredUpTo > 0) await saveFoldState(sid, plan.flooredUpTo);
    return `\uFF1Bsurface \u5F71\u5B50\u5316 ${plan.ops.length} op\uFF08\u89C6\u56FE ${(plan.charsBefore / 1e4).toFixed(1)}\u4E07\u2192${(plan.charsAfter / 1e4).toFixed(1)}\u4E07\u5B57\u7B26\uFF0C\u6298\u53E0\u81F3\u7B2C ${plan.flooredUpTo} \u697C\uFF09`;
  };
  const loadProgress = async (sid) => {
    try {
      const parsed = JSON.parse(await readFile(join3(progressDir, `${sid}.json`), "utf8"));
      const lastFloor = typeof parsed?.lastFloor === "number" && parsed.lastFloor >= 0 ? Math.floor(parsed.lastFloor) : 0;
      return { lastFloor };
    } catch {
      return { lastFloor: 0 };
    }
  };
  const saveProgress = async (sid, lastFloor) => {
    await mkdir(progressDir, { recursive: true });
    await writeFile(join3(progressDir, `${sid}.json`), JSON.stringify({ lastFloor, updatedAt: (/* @__PURE__ */ new Date()).toISOString() }, null, 1), "utf8");
  };
  const loadFoldState = async (sid) => {
    try {
      const parsed = JSON.parse(await readFile(join3(progressDir, `${sid}.fold.json`), "utf8"));
      return typeof parsed?.flooredUpTo === "number" && parsed.flooredUpTo >= 0 ? Math.floor(parsed.flooredUpTo) : 0;
    } catch {
      return 0;
    }
  };
  const saveFoldState = async (sid, flooredUpTo) => {
    await mkdir(progressDir, { recursive: true });
    await writeFile(join3(progressDir, `${sid}.fold.json`), JSON.stringify({ flooredUpTo, updatedAt: (/* @__PURE__ */ new Date()).toISOString() }, null, 1), "utf8");
  };
  const foldedUpToOf = async (sid, session) => {
    const persisted = await loadFoldState(sid);
    if (persisted > 0) return persisted;
    if (session !== void 0) {
      const events = session.events;
      const surface = session.surface;
      let max = 0;
      for (const seq of surface?.nodes ?? []) {
        const ev = events?.[seq];
        if (ev?.type !== "user/message") continue;
        const d = ev.data;
        if (d?.source?.plugin !== name || d.source.kind !== "plugin") continue;
        for (const b of Array.isArray(d.content) ? d.content : []) {
          if (b?.type === "text" && typeof b.text === "string") max = Math.max(max, parseFoldedFromMarker(b.text));
        }
      }
      if (max > 0) {
        void saveFoldState(sid, max).catch(() => {
        });
        return max;
      }
    }
    const fromLog = await scanFoldedFromLog(sid);
    if (fromLog > 0) void saveFoldState(sid, fromLog).catch(() => {
    });
    return fromLog;
  };
  const scanWindowCopies = (session) => {
    const out = [];
    const events = session.events;
    const surface = session.surface;
    for (const seq of surface?.nodes ?? []) {
      const ev = events?.[seq];
      if (ev?.type !== "user/message") continue;
      const src = ev.data?.source;
      if (src?.plugin !== name || src.form !== "snapshot" || src.windowRange === void 0) continue;
      const wr = src.windowRange;
      if (typeof wr.from !== "number" || typeof wr.to !== "number") continue;
      out.push({
        seq,
        range: {
          from: wr.from,
          to: wr.to,
          ...wr.capped === true ? { capped: true } : {},
          ...typeof wr.budget === "number" ? { budget: wr.budget } : {}
        }
      });
    }
    return out;
  };
  let headerCache = { at: 0, hits: [] };
  const refreshHeaders = async () => {
    if (Date.now() - headerCache.at > 6e4) {
      headerCache = { at: Date.now(), hits: await scanSessionHeaders(dshHome) };
    }
    return headerCache.hits;
  };
  const scanFoldedFromLog = async (sid) => {
    const header = (await refreshHeaders()).find((h) => h.sessionId === sid);
    if (!header) return 0;
    try {
      const content = await readFile(join3(dshHome, "sessions", header.project, header.sdir, "session.jsonl"), "utf8");
      let max = 0;
      for (const m of content.matchAll(/第 1-(\d+) 楼原文已折叠/g)) max = Math.max(max, Number(m[1]));
      return max;
    } catch {
      return 0;
    }
  };
  const foldedUpToRoute = async (sid) => {
    const persisted = await loadFoldState(sid);
    if (persisted > 0) return persisted;
    return scanFoldedFromLog(sid);
  };
  const slugFromCwd = async (cwd) => {
    if (!cwd) return null;
    const m = /(^|[\\/])rp[\\/]([^\\/]+)$/.exec(cwd.replace(/[\\/]+$/, ""));
    const slug = m?.[2] ?? null;
    if (!slug || slug === "_start") return null;
    try {
      await readFile(join3(dshHome, "rp", slug, "rp.json"), "utf8");
      return slug;
    } catch {
      return null;
    }
  };
  const memoryLorePath = (slug) => `skills/wb-memory-${slug}/references/lore.json`;
  const loadMemoryBook = async (slug) => {
    try {
      const parsed = JSON.parse(await readFile(join3(dshHome, memoryLorePath(slug)), "utf8"));
      return {
        name: typeof parsed?.name === "string" && parsed.name ? parsed.name : memoryBookName,
        entries: Array.isArray(parsed?.entries) ? parsed.entries : [],
        importWarnings: Array.isArray(parsed?.importWarnings) ? parsed.importWarnings : []
      };
    } catch {
      return { name: memoryBookName, entries: [], importWarnings: [] };
    }
  };
  const saveMemoryBook = async (slug, book) => {
    const abs = join3(dshHome, memoryLorePath(slug));
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, JSON.stringify({ name: book.name, entries: book.entries, importWarnings: book.importWarnings }, null, 1), "utf8");
  };
  const readSessionEvents = async (header) => {
    const sessionPath = join3(dshHome, "sessions", header.project, header.sdir, "session.jsonl");
    const content = await readFile(sessionPath, "utf8");
    const events = [];
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line));
      } catch {
      }
    }
    return events;
  };
  const floorStatCache = /* @__PURE__ */ new Map();
  const floorCountOf = async (header, sessionPath) => {
    let st;
    try {
      st = await stat(sessionPath).then((s) => ({ size: s.size, mtimeMs: s.mtimeMs }));
    } catch {
      return 0;
    }
    const cached = floorStatCache.get(sessionPath);
    if (cached !== void 0 && cached.size === st.size && cached.mtimeMs === st.mtimeMs) return cached.cursor;
    const cursor = extractFloorsFromEvents(await readSessionEvents(header)).cursor;
    floorStatCache.set(sessionPath, { ...st, cursor });
    return cursor;
  };
  const summarizeSession = async (sid, slug, header, from2, to) => {
    const sel = ctx.agentDefaultModel?.currentSelection?.();
    if (!sel?.provider || !sel?.model) throw new Error("no default model configured\uFF08\u5148\u5728\u5BFC\u5165\u4E2D\u5FC3/API \u8BBE\u7F6E\u914D\u7F6E\u6A21\u578B\uFF09");
    if (!ctx.llm) throw new Error("llm service unavailable");
    const { floors } = extractFloorsFromEvents(await readSessionEvents(header));
    const range = floors.filter((f) => f.floor >= from2 && f.floor <= to);
    if (range.length === 0) return 0;
    const prompt = buildSummarizePrompt(from2, to, range, readEffectiveConfig().summaryMaxChars);
    let text = "";
    for await (const chunk of ctx.llm.stream({
      provider: sel.provider,
      model: sel.model,
      system: prompt.system,
      messages: [{ role: "user", content: [{ type: "text", text: prompt.user }] }]
    })) {
      if (chunk.type === "text-delta" && typeof chunk.text === "string") text += chunk.text;
    }
    if (!text.trim()) throw new Error("empty summary\uFF08\u6A21\u578B\u8FD4\u56DE\u7A7A\uFF09");
    const book = await loadMemoryBook(slug);
    book.entries.push(buildMemoryEntry(memoryBookName, from2, to, text));
    await saveMemoryBook(slug, book);
    console.log(`[dsht-memory] summarized ${sid} (#${from2}-${to}) \u2192 ${text.length}ch\uFF08\u8BB0\u5FC6\u672C ${book.entries.length} \u6761\uFF0C\u5DE5\u4F5C\u533A ${slug}\uFF09`);
    return text.length;
  };
  let busy = false;
  const lastSeenCursor = /* @__PURE__ */ new Map();
  const tick = async (forceSids) => {
    if (busy) return;
    busy = true;
    try {
      const cfg = readEffectiveConfig();
      if (!cfg.enabled) return;
      let states = [];
      try {
        states = (await readdir2(join3(dshHome, "rp", "state"))).filter((f) => f.endsWith(".json") && f !== "global.json");
      } catch {
        return;
      }
      if (states.length === 0) return;
      const headers = await refreshHeaders();
      const byId = new Map(headers.map((h) => [h.sessionId, h]));
      let budget = 3;
      for (const file of states) {
        const sid = file.replace(/\.json$/, "");
        const st = JSON.parse(await readFile(join3(dshHome, "rp", "state", file), "utf8").catch(() => "{}"));
        const cursor = typeof st.cursor === "number" && st.cursor >= 0 ? Math.floor(st.cursor) : 0;
        if (cursor <= 0) continue;
        const header = byId.get(sid);
        if (!header) continue;
        const slug = await slugFromCwd(header.cwd);
        if (!slug) continue;
        if (!Array.isArray(forceSids) && lastSeenCursor.get(sid) === cursor) continue;
        lastSeenCursor.set(sid, cursor);
        const prog = await loadProgress(sid);
        let floorCount = 0;
        try {
          floorCount = await floorCountOf(header, join3(dshHome, "sessions", header.project, header.sdir, "session.jsonl"));
        } catch {
          continue;
        }
        if (floorCount < prog.lastFloor) {
          const book = await loadMemoryBook(slug);
          const rb = rollbackMemoryBook(book.entries, floorCount);
          if (rb.dropped > 0) {
            await saveMemoryBook(slug, { ...book, entries: rb.entries });
            console.log(`[dsht-memory] \u56DE\u9000\u88C1\u526A\uFF1A${sid} \u4E22\u5F03 ${rb.dropped} \u6761\u8BB0\u5FC6\uFF0ClastFloor=${rb.lastFloor}`);
          }
          if (rb.lastFloor !== prog.lastFloor) await saveProgress(sid, rb.lastFloor);
          continue;
        }
        const force = Array.isArray(forceSids) && forceSids.includes(sid);
        const chunk = force ? floorCount > prog.lastFloor ? { from: prog.lastFloor + 1, to: Math.min(floorCount, prog.lastFloor + cfg.everyN) } : null : nextChunk(prog.lastFloor, floorCount, cfg.everyN);
        if (!chunk) continue;
        try {
          const chars = await summarizeSession(sid, slug, header, chunk.from, chunk.to);
          if (chars > 0) {
            await saveProgress(sid, chunk.to);
            budget--;
          }
        } catch (e) {
          console.warn(`[dsht-memory] \u603B\u7ED3\u5931\u8D25\uFF08${sid} #${chunk.from}-${chunk.to}\uFF09\uFF1A${e.message}`);
        }
        if (budget <= 0) return;
      }
    } catch (e) {
      console.warn(`[dsht-memory] tick \u5931\u8D25\uFF08\u4E0B\u8F6E\u91CD\u8BD5\uFF09\uFF1A${e.message}`);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => {
    void tick(null);
  }, 2e4);
  try {
    ctx.effect?.(() => () => clearInterval(timer), "dsht-plugin-memory poll");
  } catch {
  }
  registerPrefix(ctx, "/dsht-memory", "dsht-memory", async (sub, req, res) => {
    const method = req.method ?? "GET";
    if (sub === "/health") return sendJson(res, 200, { ok: true, name, config: readEffectiveConfig() });
    if (sub === "/settings") {
      if (method === "GET") return sendJson(res, 200, { config: readEffectiveConfig() });
      if (method === "POST") {
        const body = await readJsonBody(req);
        if (!body) return sendJson(res, 400, { error: "bad json" });
        const patch = {};
        const src = body;
        const enabled = typeof src["\u603B\u5F00\u5173"] === "boolean" ? src["\u603B\u5F00\u5173"] : typeof src.enabled === "boolean" ? src.enabled : void 0;
        const everyN = typeof src["\u6BCFN\u697C\u603B\u7ED3"] === "number" ? src["\u6BCFN\u697C\u603B\u7ED3"] : typeof src.everyN === "number" ? src.everyN : void 0;
        const keep = typeof src["\u4FDD\u7559\u8FD1M\u697C\u539F\u6587"] === "number" ? src["\u4FDD\u7559\u8FD1M\u697C\u539F\u6587"] : typeof src.keepNearFloors === "number" ? src.keepNearFloors : void 0;
        const budget = typeof src["\u8FD1\u7A97\u5B57\u7B26\u9884\u7B97"] === "number" ? src["\u8FD1\u7A97\u5B57\u7B26\u9884\u7B97"] : typeof src.charBudget === "number" ? src.charBudget : void 0;
        const fold = typeof src["\u6298\u53E0\u8001\u697C\u5C42"] === "boolean" ? src["\u6298\u53E0\u8001\u697C\u5C42"] : typeof src.foldOldFloors === "boolean" ? src.foldOldFloors : void 0;
        const summaryCap = typeof src["\u6458\u8981\u5B57\u6570\u4E0A\u9650"] === "number" ? src["\u6458\u8981\u5B57\u6570\u4E0A\u9650"] : typeof src.summaryMaxChars === "number" ? src.summaryMaxChars : void 0;
        if (typeof enabled === "boolean") patch["\u603B\u5F00\u5173"] = enabled;
        if (typeof everyN === "number" && everyN >= 5) patch["\u6BCFN\u697C\u603B\u7ED3"] = Math.floor(everyN);
        if (typeof keep === "number" && keep >= 0) patch["\u4FDD\u7559\u8FD1M\u697C\u539F\u6587"] = Math.floor(keep);
        if (typeof budget === "number" && budget >= 5e3) patch["\u8FD1\u7A97\u5B57\u7B26\u9884\u7B97"] = Math.floor(budget);
        if (typeof fold === "boolean") patch["\u6298\u53E0\u8001\u697C\u5C42"] = fold;
        if (typeof summaryCap === "number" && summaryCap >= 100) patch["\u6458\u8981\u5B57\u6570\u4E0A\u9650"] = Math.floor(summaryCap);
        if (Object.keys(patch).length === 0) return sendJson(res, 400, { error: "no valid fields\uFF08\u603B\u5F00\u5173/\u6BCFN\u697C\u603B\u7ED3>=5/\u4FDD\u7559\u8FD1M\u697C\u539F\u6587>=0/\u8FD1\u7A97\u5B57\u7B26\u9884\u7B97>=5000/\u6298\u53E0\u8001\u697C\u5C42/\u6458\u8981\u5B57\u6570\u4E0A\u9650>=100\uFF09" });
        if (!ctx.settings || typeof ctx.settings.update !== "function") return sendJson(res, 503, { error: "settings service unavailable" });
        await ctx.settings.update(CONFIG_NS, patch);
        console.log(`[dsht-memory] settings updated: ${JSON.stringify(patch)}`);
        return sendJson(res, 200, { ok: true, config: readEffectiveConfig() });
      }
      return sendJson(res, 405, { error: "GET/POST only" });
    }
    if (sub === "/status") {
      const sid = String(queryOf(req.url).get("sessionId") ?? "");
      if (!sid) return sendJson(res, 400, { error: "sessionId required" });
      const cfg = readEffectiveConfig();
      const prog = await loadProgress(sid);
      const header = (await refreshHeaders()).find((h) => h.sessionId === sid);
      const slug = header ? await slugFromCwd(header.cwd) : null;
      const book = slug ? await loadMemoryBook(slug) : null;
      const st = JSON.parse(await readFile(join3(dshHome, "rp", "state", `${sid}.json`), "utf8").catch(() => "{}"));
      const cursor = typeof st.cursor === "number" ? st.cursor : 0;
      let floors = 0;
      if (header) {
        try {
          floors = await floorCountOf(header, join3(dshHome, "sessions", header.project, header.sdir, "session.jsonl"));
        } catch {
        }
      }
      return sendJson(res, 200, {
        sessionId: sid,
        floors,
        cursor,
        lastFloor: prog.lastFloor,
        foldedUpTo: await foldedUpToRoute(sid),
        nextAt: prog.lastFloor + cfg.everyN,
        enabled: cfg.enabled,
        everyN: cfg.everyN,
        keepNearFloors: cfg.keepNearFloors,
        charBudget: cfg.charBudget,
        foldOldFloors: cfg.foldOldFloors,
        slug,
        lorePath: slug ? memoryLorePath(slug) : null,
        entries: book ? book.entries.length : 0
      });
    }
    if (sub === "/expand") {
      if (method !== "POST") return sendJson(res, 405, { error: "POST only" });
      const body = await readJsonBody(req).catch(() => ({}));
      const sid = String(body?.sessionId ?? "");
      if (!sid) return sendJson(res, 400, { error: "sessionId required" });
      const folded = await foldedUpToRoute(sid);
      if (folded <= 0) return sendJson(res, 400, { error: "no folded range\uFF08\u8BE5\u4F1A\u8BDD\u6682\u65E0\u6298\u53E0\u533A\u95F4\uFF09" });
      const clamp = (v, def, min, max) => {
        const n = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : def;
        return Math.min(max, Math.max(min, n));
      };
      const from2 = clamp(body.from, 1, 1, folded);
      const to = clamp(body.to, folded, 1, folded);
      if (from2 > to) return sendJson(res, 400, { error: `bad range\uFF08\u6298\u53E0\u533A\u95F4 = 1-${folded}\uFF09` });
      const dir = join3(dshHome, "rp", "memory-expand");
      await mkdir(dir, { recursive: true });
      const pendingPath = join3(dir, `${sid}.json`);
      const prev = JSON.parse(await readFile(pendingPath, "utf8").catch(() => "null"));
      const requests = Array.isArray(prev?.requests) ? prev.requests.slice(-9) : [];
      requests.push({ from: from2, to, ts: (/* @__PURE__ */ new Date()).toISOString() });
      await writeFile(pendingPath, JSON.stringify({ requests }, null, 1), "utf8");
      console.log(`[dsht-memory] expand pending: ${sid} #${from2}-${to}\uFF08\u4E0B\u4E00\u8F6E\u6CE8\u5165\uFF0C\u5355\u6B21\u751F\u6548\uFF09`);
      return sendJson(res, 200, { ok: true, from: from2, to, note: "\u4E0B\u4E00\u8F6E\u8BF7\u6C42\u6CE8\u5165\uFF1B\u518D\u4E0B\u4E00\u8F6E\u81EA\u52A8\u6536\u56DE" });
    }
    if (sub === "/summarize") {
      if (method !== "POST") return sendJson(res, 405, { error: "POST only" });
      const body = await readJsonBody(req).catch(() => ({}));
      const force = typeof body?.sessionId === "string" && body.sessionId ? [body.sessionId] : null;
      void tick(force);
      return sendJson(res, 200, { ok: true, note: "summarize kicked\uFF08\u5F02\u6B65\uFF1B\u5931\u8D25\u4E0D\u63A8\u8FDB\u6E38\u6807\uFF09" });
    }
    if (sub === "/reset") {
      if (method !== "POST") return sendJson(res, 405, { error: "POST only" });
      const body = await readJsonBody(req);
      const sid = String(body?.sessionId ?? "");
      if (!sid) return sendJson(res, 400, { error: "sessionId required" });
      const header = (await refreshHeaders()).find((h) => h.sessionId === sid);
      const slug = header ? await slugFromCwd(header.cwd) : null;
      let dropped = 0;
      if (slug) {
        const book = await loadMemoryBook(slug);
        dropped = book.entries.length;
        await saveMemoryBook(slug, { ...book, entries: [] });
      }
      await saveProgress(sid, 0);
      console.log(`[dsht-memory] reset: ${sid}\uFF08\u6E05\u7A7A ${dropped} \u6761\u8BB0\u5FC6 + \u8FDB\u5EA6\u5F52\u96F6\uFF09`);
      return sendJson(res, 200, { ok: true, dropped });
    }
    return sendJson(res, 404, { error: "unknown endpoint" });
  });
}
export {
  CONFIG_NS,
  apply,
  buildExpandSnapshot,
  buildMemoryEntry,
  buildSummarizePrompt,
  configFromSchemaValue,
  desiredWindow,
  extractFloorsFromEvents,
  inject,
  name,
  neutralizeMacros,
  nextChunk,
  parseFoldedFromMarker,
  parseMemoryRange,
  planShadowOps,
  rangeCovers,
  readConfig,
  rollbackMemoryBook
};
