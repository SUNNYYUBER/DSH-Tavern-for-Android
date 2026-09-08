import type { JSX } from 'react';
/** RPPreset 最小面（对照 packages/src/preset/schema.ts） */
interface PresetSlotUi {
    id: string;
    type: string;
    content?: string;
    skill?: string;
    enabled: boolean;
    depth?: number;
    role?: string;
}
interface ToggleGroupUi {
    group: string;
    label: string;
    /** 多选组（ST 迁移预设：selected = ST enabled，可任意勾选；缺省 false = 选一） */
    multi?: boolean;
    options: Array<{
        id: string;
        label: string;
        content: string;
        selected?: boolean;
    }>;
}
export interface RPPresetUi {
    schemaVersion: 1;
    id: string;
    displayName: string;
    description?: string;
    path: string;
    toggles: ToggleGroupUi[];
    slots: PresetSlotUi[];
}
export declare function PresetPanel(): JSX.Element;
export {};
