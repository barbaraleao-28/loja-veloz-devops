"""Gera a versão acadêmica em Word e PDF a partir dos dois relatórios em docs."""
from pathlib import Path
from io import BytesIO
from html import escape
import re, os
from PIL import Image, ImageChops
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH as Align
from docx.enum.table import WD_TABLE_ALIGNMENT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Paragraph,Table,TableStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.utils import ImageReader
from pypdf import PdfReader,PdfWriter
root=Path(__file__).resolve().parent.parent
docs=root/'docs'
fontdir=Path(os.environ.get('WINDIR','C:/Windows'))/'Fonts'
fonts=('Arial','ArialBold') if (fontdir/'arial.ttf').exists() else ('Helvetica','Helvetica-Bold')
if fonts[0]=='Arial':
    for name,file in zip(fonts,['arial.ttf','arialbd.ttf']):pdfmetrics.registerFont(TTFont(name,str(fontdir/file)))
video=(docs/'video-url.txt').read_text(encoding='utf-8-sig').strip()
video=video if re.match(r'https?://(?:www\.)?(?:youtube\.com/|youtu\.be/)',video) else ''
word=Document(); sec=word.sections[0]; sec.page_width=Cm(21);sec.page_height=Cm(29.7)
sec.top_margin=sec.bottom_margin=sec.left_margin=sec.right_margin=Pt(72)
normal=word.styles['Normal'];normal.font.name='Arial';normal.font.size=Pt(12)
normal.paragraph_format.space_after=Pt(7);normal.paragraph_format.line_spacing=Pt(16)
word.core_properties.author='Bárbara Maria Rodrigues Leão'
title='ENTREGA CONTÍNUA DA PLATAFORMA DE PEDIDOS DA LOJA VELOZ'
word.core_properties.title=title
pdf=root/'Relatorio_Completo_Loja_Veloz.pdf'
c=Canvas(str(pdf),pagesize=A4);c.setAuthor(word.core_properties.author);c.setTitle(title)
W,H=A4;area=W-144
def wp(txt,size=12,bold=False,before=0,after=7,space=16,center=False,justify=False,style=None):
    p=word.add_paragraph(style=style);p.alignment=Align.CENTER if center else Align.JUSTIFY if justify else Align.LEFT
    fmt=p.paragraph_format;fmt.space_before=Pt(before);fmt.space_after=Pt(after);fmt.line_spacing=Pt(space);fmt.widow_control=False
    r=p.add_run(txt);r.font.name='Arial';r.font.size=Pt(size);r.font.color.rgb=RGBColor(0,0,0);r.bold=bold
    return p
cover=[('Centro Universitário UniFECAF',16,0,110),('Bárbara Maria Rodrigues Leão',14,0,153),('ENTREGA CONTÍNUA DA PLATAFORMA DE PEDIDOS',14,0,0),('DA LOJA VELOZ',14,0,292),('São Paulo – SP',12,0,1),('2026',12,0,0)]
y=H-72
for i,(txt,size,b,a) in enumerate(cover):
    step=21 if i<4 else 16
    wp(txt,size,True,b,a,step,True,style='Title' if i==2 else None)
    c.setFont(fonts[1],size);c.drawCentredString(W/2,y-size,txt);y-=step+a
c.showPage()
names=['01-relatorio-teorico','02-relatorio-pratico'];counts=[]
def paragraph(t,size=12,bold=False,leading=16,align=4):
    code=escape(t)
    code=re.sub(r'(https?://[^\s]+)',r'<link href="\1">\1</link>',code)
    return Paragraph(code,ParagraphStyle('texto',fontName=fonts[int(bold)],fontSize=size,leading=leading,alignment=align))
for segment,name in enumerate(names):
    txt=(docs/(name+'.md')).read_text(encoding='utf8').replace('{{VIDEO_URL}}',video or 'aguardando publicação no YouTube.')
    pages=re.split(r'^---\s*$',txt,flags=re.M);counts.append(len(pages))
    for i,pg in enumerate(pages):
        word.add_page_break();y=H-72
        lines=pg.strip().splitlines();j=0
        while j<len(lines):
            t=lines[j].strip();j+=1
            if not t:continue
            if t.startswith('|'):
                rows=[]
                while True:
                    rows.append([x.strip() for x in t.strip('|').split('|')])
                    if j==len(lines) or not lines[j].startswith('|'):break
                    t=lines[j];j+=1
                widths=[area*.24,area*.39,area*.37]
                table=word.add_table(rows=0,cols=3);table.style='Table Grid';table.alignment=WD_TABLE_ALIGNMENT.CENTER;table.autofit=False
                for col,width in zip(table.columns,widths):col.width=Pt(width)
                for k,row in enumerate(rows):
                    for cell,s,width in zip(table.add_row().cells,row,widths):
                        cell.width=Pt(width);p=cell.paragraphs[0];p.paragraph_format.line_spacing=Pt(13);p.paragraph_format.space_after=Pt(3)
                        r=p.add_run(s);r.bold=k==0;r.font.size=Pt(10)
                tab=Table([[paragraph(s,10,k==0,13,0) for s in row] for k,row in enumerate(rows)],colWidths=widths)
                tab.setStyle(TableStyle([('GRID',(0,0),(-1,-1),.5,colors.black),('VALIGN',(0,0),(-1,-1),'TOP')]))
                _,h=tab.wrap(area,1000);y-=h;tab.drawOn(c,72,y);y-=7;continue
            if t.startswith('!['):
                cap,img=re.fullmatch(r'!\[(.+?)\]\((.+?)\)',t).groups()
                im=Image.open(docs/img).convert('RGB')
                # Remove apenas o espaço vazio abaixo da interface. O PNG original permanece no projeto.
                bg=Image.new('RGB',im.size,im.getpixel((0,im.height-1)));box=ImageChops.difference(im,bg).point(lambda v:255 if v>30 else 0).getbbox()
                if box:im=im.crop((0,0,im.width,min(im.height,box[3]+18)))
                w=area;h=w*im.height/im.width
                if h>236:w*=236/h;h=236
                mem=BytesIO();im.save(mem,format='PNG');mem.seek(0)
                p=word.add_paragraph();p.alignment=Align.CENTER;p.paragraph_format.line_spacing=1;p.paragraph_format.space_after=Pt(3);p.add_run().add_picture(mem,width=Pt(w))
                y-=h;c.drawImage(ImageReader(im),(W-w)/2,y,w,h);y-=4
                t=cap;size=9;bold=False;lead=12;align=0;after=8
            elif t.startswith('# '):
                t=t[2:].upper();size=13;bold=True;lead=17;align=0;after=8
            elif t.startswith('## '):
                t=t[3:];size=12;bold=True;lead=16;align=0;after=6
            elif t.startswith('> '):
                t=t[2:];size=11;bold=False;lead=14;align=0;after=2
            else:
                small=t.startswith(('Google Cloud.','Docker.','Kubernetes.','OpenTelemetry.','GitHub.','HashiCorp.','Vídeo da apresentação'))
                size=10 if small else 12;bold=False;lead=13 if small else 16;align=0 if small else 4;after=3 if small else 8
            wp(t,size,bold,after=after,space=lead,justify=align==4)
            obj=paragraph(t,size,bold,lead,align);_,h=obj.wrap(area,1000);y-=h;obj.drawOn(c,72,y);y-=after
        assert y>=54,(name,i,y)
        c.showPage()
c.save();word.save(root/'Relatorio_Loja_Veloz_UniFECAF.docx')
reader=PdfReader(pdf);idx=1
for name,n in zip(names,counts):
    wr=PdfWriter()
    for pg in reader.pages[idx:idx+n]:wr.add_page(pg)
    wr.write(docs/(name+'.pdf'));idx+=n
rd=root/'README.md';s=rd.read_text(encoding='utf8')
new='**Vídeo pitch (YouTube):** '+(video or '_aguardando publicação._')
rd.write_text(re.sub(r'<!-- VIDEO -->.*?<!-- /VIDEO -->','<!-- VIDEO -->\n'+new+'\n<!-- /VIDEO -->',s,flags=re.S),encoding='utf8')
print('Páginas por parte:',counts)
