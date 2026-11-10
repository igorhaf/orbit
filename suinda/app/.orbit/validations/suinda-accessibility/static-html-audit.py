from html.parser import HTMLParser
from urllib.request import urlopen
from urllib.error import HTTPError, URLError
from pathlib import Path
import os
import re
import sys

BASE=os.environ.get('SUINDA_A11Y_BASE_URL','http://localhost:3003').rstrip('/')
source=(Path(__file__).resolve().parent/'accessibility.mjs').read_text()
block=re.search(r'const routes = \[(.*?)\];',source,re.S)
if not block: raise SystemExit('Route list not found')
routes=re.findall(r'"([^"\n]+)"',block.group(1))
VOID={'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}
class Node:
 def __init__(self,tag,attrs): self.tag=tag; self.attrs=dict(attrs); self.children=[]; self.parts=[]
 def text(self): return ' '.join([*self.parts,*(child.text() for child in self.children)]).strip()
class Parser(HTMLParser):
 def __init__(self): super().__init__(convert_charrefs=True); self.root=Node('document',[]); self.stack=[self.root]
 def handle_starttag(self,tag,attrs):
  node=Node(tag,attrs); self.stack[-1].children.append(node)
  if tag not in VOID: self.stack.append(node)
 def handle_startendtag(self,tag,attrs): self.handle_starttag(tag,attrs); self.handle_endtag(tag)
 def handle_endtag(self,tag):
  for i in range(len(self.stack)-1,0,-1):
   if self.stack[i].tag==tag: self.stack=self.stack[:i]; return
 def handle_data(self,data): self.stack[-1].parts.append(data)
def walk(node):
 yield node
 for child in node.children: yield from walk(child)
def named(node,ids,labels,all_nodes):
 a=node.attrs
 if a.get('aria-label','').strip(): return True
 if any(ids.get(ref,'').strip() for ref in a.get('aria-labelledby','').split()): return True
 if a.get('title','').strip(): return True
 if node.tag in {'button','a'}:
  if node.text().strip(): return True
  if any(child.tag=='img' and child.attrs.get('alt','').strip() for child in walk(node)): return True
  if any(child.tag=='svg' and (child.attrs.get('aria-label','').strip() or child.attrs.get('title','').strip()) for child in walk(node)): return True
 if node.tag=='input' and a.get('type','').lower() in {'submit','button','reset'} and a.get('value','').strip(): return True
 if node.tag in {'input','select','textarea'}:
  if a.get('id') in labels and a.get('id'): return True
  if any(parent.tag=='label' and parent.text().strip() and any(child is node for child in walk(parent)) for parent in all_nodes): return True
  if node.tag in {'input','textarea'} and a.get('placeholder','').strip(): return True
 return False
problems=[]; totals={'routes':0,'controls':0,'buttons':0,'links':0,'images':0,'mains':0,'html_lang':0,'aria_refs':0,'headings':0}
for route in routes:
 try:
  with urlopen(BASE+route,timeout=12) as response:
   html=response.read().decode('utf-8','replace'); status=response.status
  p=Parser(); p.feed(html); all_nodes=list(walk(p.root)); totals['routes']+=1
  if status!=200: problems.append((route,'http-status',status))
  html_node=next((n for n in all_nodes if n.tag=='html'),None)
  if html_node and html_node.attrs.get('lang','').strip(): totals['html_lang']+=1
  else: problems.append((route,'html-lang-missing'))
  id_nodes={}; ids={}
  for n in all_nodes:
   if n.attrs.get('id'):
    ident=n.attrs['id']; id_nodes.setdefault(ident,[]).append(n); ids[ident]=n.text()
  for ident,nodes in id_nodes.items():
   if len(nodes)>1: problems.append((route,'duplicate-id',ident))
  labels={n.attrs['for'] for n in all_nodes if n.tag=='label' and n.attrs.get('for') and n.text().strip()}
  for n in all_nodes:
   for attr in ('aria-labelledby','aria-describedby','aria-controls','aria-owns','aria-activedescendant'):
    for ref in n.attrs.get(attr,'').split():
     totals['aria_refs']+=1
     if ref not in id_nodes: problems.append((route,'broken-'+attr,ref))
   if n.tag=='main': totals['mains']+=1
   if n.tag in {'h1','h2','h3','h4','h5','h6'}: totals['headings']+=1
   a=n.attrs
   if n.tag in {'input','select','textarea'} and not (n.tag=='input' and a.get('type','').lower() in {'hidden','submit','button','reset','image'}):
    totals['controls']+=1
    if not named(n,ids,labels,all_nodes): problems.append((route,'unnamed-control',a.get('type',n.tag),a.get('id'),a.get('name')))
   elif n.tag=='button':
    totals['buttons']+=1
    if not named(n,ids,labels,all_nodes): problems.append((route,'unnamed-button',n.text()[:50],a.get('id')))
   elif n.tag=='a' and a.get('href'):
    totals['links']+=1
    if not named(n,ids,labels,all_nodes): problems.append((route,'unnamed-link',a.get('href')))
   elif n.tag=='img':
    totals['images']+=1
    if 'alt' not in a: problems.append((route,'image-missing-alt',a.get('src')))
  mains=sum(n.tag=='main' for n in all_nodes)
  if mains!=1: problems.append((route,'main-count',mains))
 except (HTTPError,URLError,TimeoutError) as e: problems.append((route,'http-error',str(e)))
print('Totals:',totals)
print('Issues:',len(problems))
for item in problems[:100]: print(item)
if problems: sys.exit(1)
