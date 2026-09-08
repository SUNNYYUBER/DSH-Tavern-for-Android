// DSHTavern Android stub（ESM 入口）：koffi
// 原生 FFI 核心（glibc）在 Android bionic 上无法加载。
// DSH 的 koffi 使用点全部是 Windows 专属（kernel32/advapi32/windows-acl），
// 但 dsh-subprocess-local 在模块顶层执行 koffi.pointer/struct/load 做类型注册
// ——所以本 stub 采用「哑值模式」：
//   类型注册类 API（pointer/struct/array/proto/load）返回 marker / 哑库对象，
//   让顶层注册无害通过；真正调用 Win32 函数时才抛受控错误（linux 路径永不调用）。
"use strict";

function unavailable(op) {
  throw new Error(`koffi.${String(op)} is not available in the DSHTavern Android build (win32-only FFI)`);
}

/** 类型 marker：可被 pointer()/array() 再次包装，无行为 */
function marker(kind) {
  return { __dshtKoffiStub: kind };
}

/** 哑库对象：koffi.load() 的返回值；属性访问得到哑函数（调用即抛错） */
function dummyLib(name) {
  return new Proxy(function stubLib() {}, {
    get(_t, prop) {
      if (prop === 'then') return undefined; // 保持非 thenable
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
      // 类型注册类（顶层会被调用）：返回 marker，绝不抛错
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
      // 数值查询类：给安全假值
      case 'sizeof': return () => 8;
      case 'alignof': return () => 8;
      case 'offsetof': return () => 0;
      // 其他：调用即抛错
      default: return (..._args) => unavailable(prop);
    }
  },
  apply() {
    return unavailable('call');
  },
});

export default stub;
export const koffi = stub;
export const load = (libName) => dummyLib(String(libName));
export const pointer = (_t) => marker('pointer');
export const struct = (_n, _d) => marker('struct');
export const array = (_t, _n) => marker('array');
export const proto = (..._a) => marker('proto');
export const sizeof = () => 8;
export const alignof = () => 8;
