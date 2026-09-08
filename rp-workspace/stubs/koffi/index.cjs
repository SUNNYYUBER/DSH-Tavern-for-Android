// DSHTavern Android stub（CJS 入口）：koffi —— 哑值模式（同 index.js，详见其注释）
"use strict";

function unavailable(op) {
  throw new Error(`koffi.${String(op)} is not available in the DSHTavern Android build (win32-only FFI)`);
}

function marker(kind) {
  return { __dshtKoffiStub: kind };
}

function dummyLib(name) {
  return new Proxy(function stubLib() {}, {
    get(_t, prop) {
      if (prop === 'then') return undefined;
      if (prop === Symbol.toPrimitive) return () => `[stub lib ${name}]`;
      return (..._args) => unavailable(`${name}.${String(prop)}`);
    },
    apply() {
      return unavailable(`${name}()`);
    },
  });
}

const stub = new Proxy(function koffiStub() {}, {
  get(_t, prop) {
    if (prop === 'then') return undefined;
    switch (prop) {
      case 'pointer': return (_t2) => marker('pointer');
      case 'struct': return (_name, _def) => marker('struct');
      case 'array': return (_t2, _n) => marker('array');
      case 'primitive': return (_t2) => marker('primitive');
      case 'enum': return (..._a) => marker('enum');
      case 'union': return (_name, _def) => marker('union');
      case 'opaque': return (_t2) => marker('opaque');
      case 'proto': return (..._a) => marker('proto');
      case 'extend': return (..._a) => marker('extend');
      case 'resolve': return (_t2) => marker('resolve');
      case 'load': return (libName) => dummyLib(String(libName));
      case 'registerType': return (..._a) => marker('registerType');
      case 'callback': return (..._a) => marker('callback');
      case 'sizeof': return () => 8;
      case 'alignof': return () => 8;
      case 'offsetof': return () => 0;
      default: return (..._args) => unavailable(prop);
    }
  },
  apply() {
    return unavailable('call');
  },
});

module.exports = stub;
module.exports.default = stub;
module.exports.koffi = stub;
module.exports.load = (libName) => dummyLib(String(libName));
module.exports.pointer = (_t) => marker('pointer');
module.exports.struct = (_n, _d) => marker('struct');
module.exports.array = (_t, _n) => marker('array');
module.exports.proto = (..._a) => marker('proto');
