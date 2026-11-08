import sys,json,re,xml.etree.ElementTree as ET
for key,svg in json.load(sys.stdin).items():
 assert not re.search(r'<!|<\?|url\s*\(|@font|@import',svg,re.I)
 root=ET.fromstring(svg)
 assert root.get('data-asset-id')==key
 for e in root.iter():
  assert e.tag.rsplit('}',1)[-1] in {'svg','title','rect','path','circle','g','text'}
  for k,v in e.attrib.items():assert not k.lower().startswith('on') and 'href' not in k.lower() and k not in ['id','style','class'] and '://' not in v
print('safe auxiliary SVGs')
