import sys,json,re,xml.etree.ElementTree as ET
d=json.load(sys.stdin); s=d['svg']; card=d['id']
assert not re.search(r'<!|<\?|url\s*\(|@font|@import',s,re.I),'active SVG'
root=ET.fromstring('<svg xmlns="http://www.w3.org/2000/svg">'+s+'</svg>')
allowed={'svg','g','path','circle'}
for e in root.iter():
 assert e.tag.rsplit('}',1)[-1] in allowed,'unknown element'
 for k,v in e.attrib.items():
  assert not k.lower().startswith('on') and 'href' not in k.lower() and k not in ['id','style','class'],'active attribute'
  assert '://' not in v,'external reference'
  if k in ['d','transform']: assert all(abs(float(n))<=400 for n in re.findall(r'-?\d+(?:\.\d+)?',v)),'coordinate outside artboard'
centers=[e for e in root.iter() if e.get('data-center-suit')]
assert centers and all(e.get('data-center-suit')==card[-1] for e in centers),'wrong suit'
rank=card[:-1]
if rank.isdigit(): assert len([e for e in root.iter() if e.get('data-pip-index') is not None])==int(rank),'wrong pips'
elif rank=='A': assert any(e.get('data-ace')==card[-1] for e in root.iter()),'wrong ace'
else: assert any(e.get('data-court')==card for e in root.iter()),'wrong court'
print(json.dumps({'id':card,'safe':True}))
