/**
 * B17 轻量代码编辑器（世界书条目内容用；EJS 设置 codeEditor=true 时替换裸 textarea）。
 *
 * 不引 Monaco——移动端性能优先（Monaco 首包 >2MB + 每 textarea 一套 worker，
 * RP 世界书面板同屏多编辑器必卡）；这里只做等宽编辑的四件补差：
 * - 行号列：与 textarea 同步行号 + 同步滚动（transform 随 scrollTop 平移）；
 * - Tab 键：插入两空格（不抢焦点——世界书内容里写 EJS/缩进文本是常态）；
 * - EJS 标签提示行：含 <% 或 %> 的行在行号列高亮 + 玻璃条提示（textarea 原生
 *   不支持逐行着色，行号列做提示面是零成本方案）；
 * - 深浅主题只消费 --dsw-alias-* 语义 token（与宿主同肤）。
 *
 * UI 标注「轻量编辑器（Monaco 在移动端不适用）」——用户可感知的取舍说明。
 */
import { type JSX } from 'react';
export interface CodeTextareaProps {
    value: string;
    onChange: (next: string) => void;
    rows?: number;
    placeholder?: string;
    ariaLabel?: string;
}
export declare function CodeTextarea(props: CodeTextareaProps): JSX.Element;
