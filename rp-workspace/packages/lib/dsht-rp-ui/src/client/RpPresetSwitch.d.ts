import type { JSX } from 'react';
/** header action 席位收到的标准件（framework 注入；owner 无 props） */
interface HeaderActionProps {
    useSession: <T>(selector: (snapshot: {
        sessionId?: unknown;
    }) => T) => T;
    sessionId: string;
}
export declare function RpPresetSwitch({ useSession, sessionId }: HeaderActionProps): JSX.Element | null;
export {};
