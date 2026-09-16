import subprocess, re, json
import sys, os
U=(sys.argv[1] if len(sys.argv)>1 else "pdfs").rstrip("/")+"/"
DOCS=[
 dict(id="markt",file="Schoten-marktreglement-2024.pdf",title="Bijzonder politiereglement voor de openbare markt",short="Marktreglement Schoten",authority="Gemeente Schoten (gemeenteraad)",level="gemeentelijk",municipality="Schoten",type="regelgeving",status="van kracht",date="28-03-2024 (in werking 01-04-2024)",
      url="https://www.schoten.be/sites/default/files/2024-03/GR%2028-03-2024_2000_Uittreksel%20in%20pdf_Marktreglement.pdf",
      note="Controleer of deze versie nog de geldende versie is. De bijlagen (marktplan, quotalijst) zitten niet in dit uittreksel."),
 dict(id="retrib",file="Schoten-markt-en-kermisretributies-2026-2031.pdf",title="Retributiereglement openbare markten en kermissen",short="Retributiereglement markten Schoten",authority="Gemeente Schoten (gemeenteraad)",level="gemeentelijk",municipality="Schoten",type="regelgeving",status="van kracht",date="24-11-2025 (geldig 01-01-2026 t/m 31-12-2031)",
      url="https://www.schoten.be/sites/default/files/public/documenten/Reglementen/Retributiereglementen%2026-31/Retributiereglement%20op%20de%20openbare%20markten%20en%20kermissen%202026-2031.pdf",note=""),
 dict(id="terras",file="Schoten-terrassen-en-uitstallingen-ongedateerd.pdf",title="Reglement voor terrassen en uitstallingen",short="Terrasreglement Schoten",authority="Gemeente Schoten",level="gemeentelijk",municipality="Schoten",type="regelgeving",status="ongedateerd",date="geen datum in document",url="",
      note="Ongedateerd: controleer of dit de geldende versie is voordat u hierop steunt. Let op: dit document heeft een eigen artikel 13 §3 (brandwerende materialen), niet te verwarren met art. 13 §3 van het marktreglement."),
 dict(id="vlaio",file="VLAIO-mijn-eigen-zaak-januari-2026.pdf",title="Mijn eigen zaak: starten met kennis van zaken",short="VLAIO-startersgids",authority="VLAIO",level="Vlaams",municipality="",type="richtlijn",status="richtlijn",date="januari 2026",url="",note="Richtlijn, geen regelgeving. Verwijst voor lokale regels naar de gemeente."),
 dict(id="favvhef",file="FAVV-heffingen-FAQ-juni-2026.pdf",title="Brochure heffingen 2026",short="FAVV-brochure heffingen",authority="FAVV",level="federaal",municipality="",type="richtlijn",status="richtlijn",date="juni 2026",url="",note="Richtlijn, geen regelgeving."),
 dict(id="innov",file="Antwerpen-innovatiefonds-reglement-2026.pdf",title="Subsidiereglement Innovatiefonds Provincie Antwerpen",short="Innovatiefonds provincie",authority="Provincie Antwerpen",level="provinciaal",municipality="",type="regelgeving",status="van kracht",date="2026 (van kracht vanaf 01-06-2026)",url="",note="Provincie Antwerpen, niet de stad Antwerpen. Indiendata staan op de provinciale website, niet in het document."),
 dict(id="favvgids",file="HISTORICAL-FAVV-controle-gids-cover-2022.pdf",title="De weg naar een feilloze FAVV-controle",short="FAVV-controlegids (historisch)",authority="FAVV",level="federaal",municipality="",type="richtlijn",status="historisch",date="cover 2022; colofon vermeldt november 2018",url="",note="Historisch achtergronddocument, geen bewijs van huidige regels. De datums in het document zelf zijn niet eenduidig (cover 2022, colofon 2018)."),
 dict(id="kb2006",file="HISTORICAL-FAVV-koninklijk-besluit-2006.pdf",title="Koninklijk besluit van 16 januari 2006 (erkenningen, toelatingen en registraties FAVV)",short="KB 16-01-2006 (historisch)",authority="Federale overheid (Belgisch Staatsblad 02-03-2006)",level="federaal",municipality="",type="regelgeving",status="historisch",date="16-01-2006, gepubliceerd 02-03-2006",url="",note="Historische versie: latere wijzigingen ontbreken. Alleen de Nederlandse kolom is geïndexeerd; de automatische kolomsplitsing kan fouten bevatten."),
 dict(id="kleinh",file="HISTORICAL-Omgevingsloket-kleinhandel-2019.pdf",title="Handleiding Omgevingsloket: kleinhandelsactiviteiten",short="Handleiding kleinhandel (historisch)",authority="Vlaamse overheid",level="Vlaams",municipality="",type="richtlijn",status="historisch",date="versie 01/2019",url="",note="Historisch: toont de uitleg zoals in 2019."),
]
ART=re.compile(r'^\s*(?:I\s*)?(Artikel\s+\d+(?:\.\d+)?|Art\.\s*\d+\.?)\s*[-–:.]?\s*(.*)$')
PAR=re.compile(r'^\s*(§\s?\d+)\.?\s*(.*)$')
SEC=re.compile(r'^\s*(\d{1,2}(?:\.\d+){1,2}\.?|\d{1,2}\.)\s+([A-ZÀ-Ý][^\n]{3,58}[^.,:;])$')
JUNK=re.compile(r'(BIJZONDER POLITIEREGLEMENT VOOR DE OPENBARE MARKT$|Gemeenteraad van 28 maart 2024\s+pagina|Subsidiereglement Innovatiefonds Provincie Antwerpen$|^Pagina\s*\d+\s*van\s*\d+|BELGISCH STAATSBLAD — 02\.03\.2006|Syntax Warning)')
def pages(d):
    n=int(re.search(r'Pages:\s+(\d+)',subprocess.run(['pdfinfo',U+d['file']],capture_output=True,text=True).stdout).group(1))
    out=[]
    for p in range(1,n+1):
        if d['id']=='kb2006':
            t=subprocess.run(['pdftotext','-layout','-f',str(p),'-l',str(p),U+d['file'],'-'],capture_output=True,text=True).stdout
            lines=[]
            for L in t.split('\n'):
                m=[x.start() for x in re.finditer(r'\s{2,}',L) if 50<x.start()<95]
                cut=m[-1] if m else 77
                lines.append(L[:cut].strip())
            t='\n'.join(lines)
        else:
            t=subprocess.run(['pdftotext','-f',str(p),'-l',str(p),U+d['file'],'-'],capture_output=True,text=True).stdout
        out.append(t)
    return out
chunks=[]
def norm(s):
    s=s.replace('\x08','').replace('\f','')
    s=re.sub(r'[ \t]+',' ',s); s=re.sub(r'\n{3,}','\n\n',s); return s.strip()
for d in DOCS:
    pg=pages(d); d['pages']=len(pg)
    regl = d['type']=='regelgeving'
    cur=dict(art='',atitle='',par='',sec='',lines=[])
    def flush():
        L=cur['lines']; cur['lines']=[]
        body=[x for x in L if x[0].strip()]
        if not body: return
        txt=norm('\n'.join(x[0] for x in body))
        if len(txt)<25: return
        hdr=ART.match(body[0][0]) if regl else None
        if hdr and len(body)==1: return  # header only
        parts=[]; buf=[]; n=0
        for x in body:
            if n+len(x[0])>1400 and buf: parts.append(buf); buf=[]; n=0
            buf.append(x); n+=len(x[0])+1
        if buf: parts.append(buf)
        for pt in parts:
            label=' '.join(y for y in [cur['art'],cur['par']] if y) or cur['sec']
            ps=sorted(set(y[1] for y in pt))
            chunks.append(dict(id=f"{d['id']}-{len(chunks)}",doc=d['id'],label=label,title=cur['atitle'] if cur['art'] else '',pages=ps,page=ps[0],text=norm('\n'.join(y[0] for y in pt))))
    for pi,t in enumerate(pg,1):
        for L in t.split('\n'):
            L=L.replace('\x08','')
            if JUNK.search(L.strip()) or re.search(r'\.{6,}',L): continue
            m=ART.match(L) if regl else None
            pm=PAR.match(L) if regl else None
            sm=SEC.match(L) if not regl else None
            if m:
                flush(); cur['art']=re.sub(r'\s+',' ',m.group(1)).rstrip('.').replace('Artikel','art.').replace('Art.','art.').replace('art.','art. ').replace('  ',' ')
                cur['par']=''; cur['atitle']=m.group(2).strip(' -–:.')
                pm2=PAR.match(m.group(2))
                if pm2: cur['par']=pm2.group(1).replace(' ',''); cur['atitle']=''
                cur['want']= not cur['atitle'] and not pm2
            elif cur.get('want') and L.strip():
                cur['want']=False
                if len(L.strip())<60 and not PAR.match(L): cur['atitle']=L.strip()
            if m: pass
            elif pm and cur['art']:
                flush(); cur['par']=pm.group(1).replace(' ','')
            elif sm and sum(len(x[0]) for x in cur['lines'])>300:
                flush(); cur['sec']=sm.group(1).rstrip('.')+' '+sm.group(2).strip()
            elif sm and not cur['lines']:
                cur['sec']=sm.group(1).rstrip('.')+' '+sm.group(2).strip()
            cur['lines'].append((L,pi))
            if not regl and sum(len(x[0]) for x in cur['lines'])>1300: flush()
        if not regl: flush()
    flush()
for c in chunks:
    c['page']=c['pages'][0] if c['pages'] else 1
for d in DOCS: d.pop('file_path',None)
out=dict(generated=__import__('datetime').date.today().isoformat(),docs=DOCS,chunks=chunks)
for d in DOCS: d.setdefault('rev',0); d.setdefault('active',True)
with open('corpus.js','w') as f:
    f.write('// Gegenereerd door extract_corpus.py. Niet met de hand bewerken.' + chr(10) + 'window.CORPUS = ' + json.dumps(out,ensure_ascii=False,indent=0) + ';' + chr(10))
from collections import Counter
print('corpus.js geschreven:', len(chunks), 'passages', dict(Counter(c['doc'] for c in chunks)))
