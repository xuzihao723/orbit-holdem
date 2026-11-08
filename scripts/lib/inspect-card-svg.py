import sys,json,re,xml.etree.ElementTree as ET
d=json.load(sys.stdin);s=d['svg'];expected=d['id']
assert not re.search(r'<!|<\?|url\s*\(|@font|@import',s,re.I),'active or external resource'
root=ET.fromstring(s);ns='{http://www.w3.org/2000/svg}'
assert root.tag==ns+'svg' and root.get('viewBox')=='0 0 240 336'
assert root.get('data-card-id')==expected,'wrong card identity'
allowed={'svg','title','rect','g','path','text','circle','ellipse'}
for e in root.iter():
 assert e.tag.startswith(ns) and e.tag[len(ns):] in allowed,'unknown element'
 for key,value in e.attrib.items():
  assert not key.lower().startswith('on') and 'href' not in key.lower() and '://' not in value,'external or active attribute'
  assert key not in ['style','class','id'],'unscoped or active style'
corners=[e for e in root.iter() if e.get('data-corner')=='safe']
if expected!='orbit-back':
 assert len(corners)==2 and root.get('data-rank')==expected[:-1] and root.get('data-suit')==expected[-1]
 assert all(len(list(c))==2 and list(c)[0].text==expected[:-1] and list(c)[0].get('x')=='34' for c in corners)
else:
 halves=[e for e in root.iter() if e.get('data-back-half')]
 assert len(halves)==2 and halves[1].get('transform')=='rotate(180 120 168)'
 assert ''.join(ET.tostring(e,encoding='unicode') for e in halves[0])==''.join(ET.tostring(e,encoding='unicode') for e in halves[1])
pips=[e for e in root.iter() if e.get('data-pip')=='heart']
if expected=='7H': assert len(pips)==7 and all(e.text=='♥' for e in pips),'wrong seven pips'
print(json.dumps({'viewBox':root.get('viewBox'),'pipCount':len(pips),'externalReferences':[]}))
