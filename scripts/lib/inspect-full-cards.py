import sys,json,re,xml.etree.ElementTree as ET
d=json.load(sys.stdin); m=d['manifest']; files=d['files']
allowed={'svg','title','rect','g','path','text','circle','ellipse'}
for path,s in files.items():
 assert not re.search(r'<!|<\?|url\s*\(|@font|@import',s,re.I),'active resource'
 root=ET.fromstring(s)
 assert root.tag=='{http://www.w3.org/2000/svg}svg' and root.get('viewBox')=='0 0 240 336','invalid artboard'
 for e in root.iter():
  assert e.tag.rsplit('}',1)[-1] in allowed,'unknown element'
  for k,v in e.attrib.items():
   assert not k.lower().startswith('on') and 'href' not in k.lower() and k not in ['id','style','class'] and '://' not in v,'active attribute'
 if path.startswith('cards/faces/'):
  card=path.rsplit('/',1)[1][:-4];rank=card[:-1];suit=card[-1]
  assert root.get('data-card-id')==card and root.get('data-rank')==rank and root.get('data-suit')==suit,'wrong identity'
  corners=[e for e in root.iter() if e.get('data-corner')=='safe']
  assert len(corners)==2 and all(list(e)[0].text==rank and list(e)[0].get('x')=='34' for e in corners),'wrong corner'
  centers=[e for e in root.iter() if e.get('data-center-suit')]
  assert centers and all(e.get('data-center-suit')==suit for e in centers),'wrong center suit'
  if rank.isdigit(): assert len([e for e in root.iter() if e.get('data-pip-index') is not None])==int(rank),'wrong pip count'
  elif rank=='A': assert any(e.get('data-ace')==suit for e in root.iter()),'wrong ace'
  else: assert any(e.get('data-court')==card for e in root.iter()),'wrong court'
 elif path.startswith('cards/backs/'):
  halves=[e for e in root.iter() if e.get('data-back-half')]
  assert len(halves)==2 and halves[1].get('transform')=='rotate(180 120 168)','asymmetric back'
  assert ''.join(ET.tostring(e,encoding='unicode') for e in halves[0])==''.join(ET.tostring(e,encoding='unicode') for e in halves[1]),'unequal halves'
 else: assert root.get('data-card-id')=='slot' and root.get('data-rank') is None,'invalid slot'
print(json.dumps({'xmlFiles':len(files),'valid':True}))
