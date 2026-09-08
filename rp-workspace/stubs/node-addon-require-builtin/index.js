// DSHTavern Android stub：node-addon-require-builtin
// 原生 loader（glibc 二进制）在 Android bionic 上无法加载；
// requireBuiltin 的语义本就是"取 Node 内置模块"，普通 require 即等价实现。
"use strict";
function requireBuiltin(moduleId) {
  return require(moduleId);
}
function isAllowedInternalId(moduleId) {
  try {
    require(moduleId);
    return true;
  } catch {
    return false;
  }
}
function getBindingInfo() {
  return null;
}
exports.requireBuiltin = requireBuiltin;
exports.isAllowedInternalId = isAllowedInternalId;
exports.getBindingInfo = getBindingInfo;
exports.default = { requireBuiltin, isAllowedInternalId, getBindingInfo };
