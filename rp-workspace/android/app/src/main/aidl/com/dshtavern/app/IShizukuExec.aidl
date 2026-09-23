/*
 * Shizuku UserService 的 AIDL 契约（W-3 执行层）
 *
 * 【为什么接口要极简】本接口是跨进程且以 shell(uid 2000) 身份执行的面：
 * 每多一个方法就多一个可被滥用的入口。故只留三个必需能力：
 *   exec       - 执行已由 App 侧构造并校验过的 argv（本层不做任何判断）
 *   readBase64 - 读产物文件字节（PNG 等二进制不能经 UTF-8）
 *   uid        - 自报身份，用于实证「回 uid=2000」（W-2 验收口径）
 *
 * 【铁律】永远不要在这里加 shell(String) 这类收任意命令串的方法——
 * 那会把「App 侧唯一命令构造点」这条纪律整个作废（设计 §1.1）。
 *
 * 【destroy 的 transaction code】官方规定 UserService 必须实现 destroy
 * （aidl 里写 16777114，binder 侧是 16777115）——因为 unbindUserService
 * 不会杀进程，不自己退就会残留一个 shell 身份的服务进程。
 */

package com.dshtavern.app;

interface IShizukuExec {
    /// 执行已构造好的 argv（数组形态，不经 shell）。
    String exec(in List<String> argv) = 1;

    /// 读文件并返回 base64；失败返回 ERR:<reason>。
    String readBase64(String path) = 2;

    /// 本服务进程的 uid（应以 2000 实证）。
    int uid() = 3;

    /// 官方要求的清理钩子：unbind 后被调到，实现里应自行退出进程。
    void destroy() = 16777114;
}
