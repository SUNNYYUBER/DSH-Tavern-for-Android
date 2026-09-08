import { RP_OPEN_EVENT } from './RpOverlay.tsx';
export function RpImportDockEntry(_props) {
    return (<button type="button" className="dsht-rp-import-dock" title="导入角色卡 / 世界书 / SillyTavern 数据包" aria-label="导入" onClick={() => { window.dispatchEvent(new CustomEvent(RP_OPEN_EVENT, { detail: { tab: 'import' } })); }}>
      📥 导入
    </button>);
}
