/**
 * E1-E8/E11 剧情表格系统（ST st-memory-enhancement 表格机制的机制级移植，纯逻辑 + 薄 IO）。
 *
 * 存储形状（rp/state/<sid>.json 新键，与 MVU variables/presetId/cursor 共存）：
 *   sheets: [{ uid, name, headers: string[], rows: string[][], enabled }]   // E1
 *   sheetHistory: [{ at, sheets 快照 JSON }]                                // E1（栈深 20，撤销用）
 * 旧键迁移：tableData/tables（ST 1.0 形态 {名称: {content:[[]], enable}}）→
 *   loadSheets 发现即一次性转 Sheet[] 写回并标 tablesMigrated（E11）。
 *
 * tableEdit 指令（E2，ST index.js handleTableEditTag/classifyParams 同语义换格式）：
 *   <tableEdit>
 *   表名; 操作; 参数...
 *   </tableEdit>
 *   操作：insertRow / updateRow / deleteRow / insertCol / deleteCol / setName / rename
 *   容错：半角/全角分号、多余空格、行号越界跳过（不中断后续指令）。
 *   行号/列号一律 1 起（数据行，表头不占行号；insertRow 省略行号 = 追加表尾）。
 *
 *   【实机审计修复 2026-09-05】函数调用式（ST st-memory-enhancement pluginSetting.js
 *   提示词模板实证的主格式，旧分号式保留为兼容回退，同一块内两式逐行共存）：
 *   <tableEdit>
 *   insertRow(0,{"0":"值","2":"值"})
 *   updateRow(0,2,{"1":"值"})
 *   deleteRow(0,3)
 *   </tableEdit>
 *   基数对齐 ST 源码 executeAction/classifyParams：表索引 = 启用表数组的 0 起下标
 *   （sheets[enable 过滤后][tableIndex]）；行号 = 0 起数据行（内部转 1 起）；列键 = headers
 *   下标（0 起，内部转 1 起列号）；insertRow 一律追加表尾（ST 忽略行参）；数据字典仅收
 *   数字键（ST formatParams 同款丢弃非数字键）；容忍单引号/全角括号/全角逗号。
 *
 * 与 ST 的对应：Sheet ≈ st-memory-enhancement core/table/sheet.js（uid/name/headers/rows/enable）；
 * renderTablePrompt ≈ getTablePromptByPiece（title/headers/rows/editRules）；
 * renderTableData ≈ isPureData=true 口径；{{tableData}}/{{tablePrompt}}/{{GET::表:行:列}} ≈
 * ST 表格宏（本移植只在 pre-step 注入点求值，不改全局宏引擎，E8）。
 *
 * 拆分原因：路由 handler 与 pre-step 接线分属两个插件，核心逻辑全部收拢为纯函数
 * （dsh-plugin/memory.ts 同款拆法），本文件只含 tables 相关，不碰剧情记忆。
 *
 * 打包：esbuild 内联（dsh-plugin bundle 时编入）。
 */
export interface Sheet {
    /** 稳定 id（迁移/重整理保留原 uid） */
    uid: string;
    /** 表名（tableEdit 指令按 name 寻址） */
    name: string;
    /** 表头（列名，1 起） */
    headers: string[];
    /** 数据行（每行 cells 与 headers 对齐；稀疏位 = ''） */
    rows: string[][];
    /** 是否启用（未启用不渲染不注入，ST sheet.enable 同语义） */
    enabled: boolean;
}
/** 历史栈条目：写入前的 sheets 深快照（撤销 = 弹栈恢复） */
export interface SheetHistoryEntry {
    at: number;
    sheets: Sheet[];
}
/** 历史栈深（E1：超出丢最旧） */
export declare const SHEET_HISTORY_MAX = 20;
/** sessionId 安全校验（路由 payload 直落文件名，防路径越界；memory.ts 同款规则） */
export declare function isValidTablesSessionId(sessionId: string): boolean;
/** 宽容归一单张表（坏形状返回 null；headers/rows 全部字符串化对齐） */
export declare function normalizeSheet(raw: unknown, index?: number): Sheet | null;
/**
 * 识别旧键 tableData / tables（ST 1.0：{表名: {name?, content: string[][], enable?}}，
 * 也容忍数组形态）。content 首行为表头、其余为数据行（ST 三件套惯例）。
 */
export declare function migrateLegacyTables(raw: Record<string, unknown>): {
    sheets: Sheet[];
    found: boolean;
};
/** tablesFilePath：状态文件即 rp/state/<sid>.json（与 MVU/cursor 共用） */
export declare function sheetsStatePath(dshHome: string, sessionId: string): string;
export interface LoadedSheets {
    /** 状态文件整树（写回时原样带上，保护 variables/presetId/cursor 等键） */
    whole: Record<string, unknown>;
    sheets: Sheet[];
    history: SheetHistoryEntry[];
    /** 本载入是否发生了 E11 旧键迁移（已写回） */
    migrated: boolean;
}
/**
 * 读会话表格（薄 IO）。文件缺失/损坏 → 空表集；
 * 无 sheets 键但发现旧键 tableData/tables → E11 一次性转换并写回（标 tablesMigrated）。
 */
export declare function loadSheets(dshHome: string, sessionId: string): Promise<LoadedSheets>;
/** 写会话表格（薄 IO，建目录；调用方负责历史栈） */
export declare function saveSheets(dshHome: string, sessionId: string, whole: Record<string, unknown>): Promise<void>;
/** 历史栈入栈（纯函数）：深快照 sheets，栈深 20（超出丢最旧） */
export declare function pushSheetHistory(history: SheetHistoryEntry[], sheets: Sheet[], now?: number): SheetHistoryEntry[];
export type TableEditOp = 'insertRow' | 'updateRow' | 'deleteRow' | 'insertCol' | 'deleteCol' | 'setName' | 'rename';
export interface TableEdit {
    sheet: string;
    /**
     * 【实机审计修复 2026-09-05】函数调用式的数字表索引（0 起，按启用表数组下标寻址，
     * ST executeAction 同款）。与 sheet 名字寻址二选一：存在时优先按下标解析。
     */
    sheetIndex?: number;
    op: TableEditOp;
    /** 1 起行号（insertRow 缺省 = 追加表尾） */
    row?: number;
    /** 1 起列号（insertCol 缺省 = 追加表尾列） */
    col?: number;
    /** 单元格值序列 / 表头名 / 新表名（按 op 语义取用） */
    values: string[];
}
/**
 * 解析消息文本里的全部 <tableEdit> 块 → 指令数组（E2）。
 * 【实机审计修复 2026-09-05】块内优先提取函数调用式（insertRow(...)/updateRow(...)/
 * deleteRow(...)/insertCol(...)/deleteCol(...)，跨行字典容忍，ST handleTableEditTag 同款
 * 全块扫描），函数调用区间之外的文本再走旧分号式逐行解析（兼容回退）。
 * 坏指令（表索引缺失/操作不识别/参数缺失）计入 skipped 并跳过，不中断后续指令。
 */
export declare function parseTableEdits(text: string): {
    edits: TableEdit[];
    skipped: number;
};
/**
 * 执行指令（纯函数，不改入参）：按表名或表索引寻址，行号越界/表缺失跳过（E2 容错）。
 * 【实机审计修复 2026-09-05】函数调用式指令带 sheetIndex（0 起）时按 ST executeAction
 * 同款寻址：sheets[enable 过滤后][tableIndex]；无 sheetIndex 的旧分号式指令按表名寻址。
 * 应用顺序 = 指令顺序（ST sortActions 的 update→insert→delete 排序是行号位移补偿，
 * 本格式行号即时寻址且文档声明逐行执行，不做重排——语义可预期）。
 */
export declare function executeTableEdits(sheets: Sheet[], edits: TableEdit[]): {
    sheets: Sheet[];
    applied: number;
    skipped: number;
};
/** 渲染启用的表（数据面：title + headers + rows；ST isPureData 口径，E8 {{tableData}} 用） */
export declare function renderTableData(sheets: Sheet[]): string;
/**
 * 渲染「当前表格 + 可用操作规则」（E3 pre-step 注入文本；ST getTablePromptByPiece
 * 含 editRules 的完整口径）。无启用表返回空串（调用方不注入）。
 */
export declare function renderTablePrompt(sheets: Sheet[]): string;
/** {{GET::表名:行:列}} 取单元格（1 起行列；越界/表缺失 → null，宏替换为空串） */
export declare function getTableCell(sheets: Sheet[], name: string, row: number, col: number): string | null;
/**
 * 【实机审计修复 2026-09-05】A1 式单元格地址解析（ST {{GET::表:A1}} 宏同款形态，
 * resolveTableMacros 的 [A-Z]+\d+ 第三段）：字母 = 列（base26，A = 第 1 列），
 * 数字 = 行（1 = 第 1 数据行，与三段数字形态同口径，即 A1 ≡ 1:1）。
 * ST 源码 getCellFromAddress 的网格含行头列/表头行偏移（A→行号列、1→表头行），
 * 本移植数据网格无行号列，按 Excel 式直读。非法地址 → null。
 */
export declare function parseA1Address(addr: string): {
    row: number;
    col: number;
} | null;
/**
 * E8：表格宏展开（纯函数）——{{tableData}}/{{tablePrompt}}/{{GET::表名:行:列}} →
 * 当前 sheets 渲染值。只在 pre-step 注入点调用（不改全局宏引擎）。
 * 【实机审计修复 2026-09-05】GET 第三段兼容 A1 式单元格地址（{{GET::表名:B2}}，
 * 字母列+数字行，ST resolveTableMacros 同款）与现有 行:列 两段数字两种形态。
 */
export declare function expandTableMacros(text: string, sheets: Sheet[]): string;
