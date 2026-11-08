import { useState } from 'react';
import HomePage from '../pages/HomePage';
import LobbyPage from '../pages/LobbyPage';
import TablePage from '../pages/TablePage';
import { fixtures } from './graybox-fixtures';
import CardSamplePage from './CardSamplePage';
import CardComponentPage from './CardComponentPage';
import CardCatalogPage from './CardCatalogPage';
import AuxAssetsPage from './AuxAssetsPage';
import ComponentPreviewPage from './ComponentPreviewPage';
export default function DevPreviewApp() {
  const [expanded, setExpanded] = useState(false);
  const query = new URLSearchParams(window.location.search);
  const page = query.get('preview');
  if (page === 'cards') return <CardSamplePage />;
  if (page === 'components') return <CardComponentPage />;
  if (page === 'catalog') return <CardCatalogPage />;
  if (page === 'aux') return <AuxAssetsPage />;
  if (page === 'states') return <ComponentPreviewPage />;
  const scenario = query.get('scenario') ?? (page === 'lobby' ? 'lobby-two-of-four' : 'table-four');
  const fixture = fixtures.find((fixture) => fixture.id === scenario && fixture.page === page);
  return (
    <div className="dev-shell" data-preview-source="W04_DEV_FIXTURE_ONLY">
      <div className="preview-content">
        {page === 'home' ? (
          <HomePage />
        ) : fixture?.page === 'lobby' ? (
          <LobbyPage room={fixture.room} viewerSeatId={fixture.viewerSeatId} />
        ) : fixture?.page === 'table' ? (
          <TablePage table={fixture.table} />
        ) : (
          <main className="missing-preview">
            <h1>场景不存在</h1>
            <a href="/">返回首页</a>
          </main>
        )}
      </div>
      <aside className="preview-toolbar" aria-label="开发预览控制">
        <div className="preview-toolbar-summary">
          <span>开发灰盒 · 固定数据</span>
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls="preview-controls"
            onClick={() => setExpanded((value) => !value)}
          >
            切换灰盒场景
          </button>
        </div>
        {expanded && (
          <div id="preview-controls" className="preview-controls">
            <nav aria-label="灰盒页面">
              <a href="/?preview=home">首页</a>
              <a href="/?preview=lobby">等待房间</a>
              <a href="/?preview=table">牌桌</a>
              <a href="/?preview=states">组件状态</a>
              <a href="/">退出预览</a>
            </nav>
            {page !== 'home' && (
              <label>
                固定场景
                <select
                  aria-label="固定场景"
                  value={fixture?.id ?? ''}
                  onChange={(event) => {
                    window.location.assign(`/?preview=${page}&scenario=${event.target.value}`);
                  }}
                >
                  <option value="" disabled>
                    请选择场景
                  </option>
                  {fixtures
                    .filter((f) => f.page === page)
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <p>仅用于检查布局。计时、筹码与座位均为固定示意。</p>
          </div>
        )}
      </aside>
    </div>
  );
}
