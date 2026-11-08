export interface CardManifest {
  schemaVersion: 1;
  themeId: 'orbit';
  faces: Record<string, string>;
  backs: string[];
  slot: string;
}
export interface CardSet {
  manifest: CardManifest;
  files: Record<string, string>;
}
