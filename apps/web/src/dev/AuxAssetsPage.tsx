const art = import.meta.glob<string>(
  '../../../../assets/{avatars,table,icons,states,brand}/*.svg',
  { query: '?raw', import: 'default', eager: true },
);
export default function AuxAssetsPage() {
  return (
    <main className="app-page" data-preview-source="W34_DEV_AUX_ASSETS_ONLY">
      <h1>辅助素材校对</h1>
      <a href="/">返回首页</a>
      <div className="component-catalog">
        {Object.entries(art).map(([path, svg]) => (
          <figure key={path}>
            <div style={{ width: 96, height: 96 }} dangerouslySetInnerHTML={{ __html: svg }} />
            <figcaption>{path.split('/').at(-1)}</figcaption>
          </figure>
        ))}
      </div>
      <p>图标另需在24/32/44像素检查；音效通过设置开启后由用户手势播放。</p>
    </main>
  );
}
