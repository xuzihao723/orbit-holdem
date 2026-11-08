import copy from './zh-CN.json';
export function t(key: string, params: Record<string, string | number> = {}) {
  const text = copy.actions[key as keyof typeof copy.actions];
  if (!text) return copy.genericFailure;
  const expected = [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
  if (
    expected.length !== Object.keys(params).length ||
    expected.some((k) => !Object.hasOwn(params, k))
  )
    throw Error('COPY_PARAMETER');
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name]));
}
