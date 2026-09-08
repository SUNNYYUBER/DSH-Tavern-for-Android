import type { JSX } from 'react';
import { type RpWorkspaceInfo } from './rpc.ts';
/** RegexScript 最小面（对照 packages/src/regex/engine.ts；序列化兼容 ST 字段名） */
export interface RegexScriptUi {
    id: string;
    scriptName: string;
    findRegex: string;
    replaceString: string;
    trimStrings: string[];
    placement: number[];
    disabled: boolean;
    markdownOnly: boolean;
    promptOnly: boolean;
    runOnEdit: boolean;
    substituteRegex: number;
    minDepth: number | null;
    maxDepth: number | null;
}
export declare function RegexPanel({ workspaces }: {
    workspaces: RpWorkspaceInfo[];
}): JSX.Element;
